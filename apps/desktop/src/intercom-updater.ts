/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * InterCom updates itself from the releases of its GitHub repository.
 *
 * A check asks the GitHub API for the newest releases (a short list, with the ETag of the last
 * answer, so that "nothing new" is one small request; see intercom-updater-check.ts), picks the
 * newest desktop one (tags `v<Element version>-intercom.<n>`; the Android releases of the same
 * repository are passed over), downloads this platform's file and checks it against the release's
 * SHA256SUMS. Then the window is told, and the user decides when to restart:
 *
 *  - Linux (unpacked tar.gz): the archive is unpacked beside the install directory; on restart
 *    the two directories are swapped (the old one is kept as `<dir>.old`) and the app is started
 *    again with the switches it had. An install the user cannot write to (a package, an AppImage)
 *    is not touched: the release page is offered instead.
 *  - Windows (NSIS, per user): on restart the downloaded installer is run silently, which
 *    replaces the app and starts it again.
 *
 * Squirrel and electron-updater are not used: the builds are not code signed, so neither could
 * check more than this does, and both take the package version for the app's version, which here
 * is Element's. SHA256SUMS comes from the same release as the file: it catches a broken or
 * truncated download, not a release that was tampered with.
 *
 * While the app runs it looks for a new release every few minutes and when the window gets the
 * focus back, the computer wakes up or the network returns; what that asks of GitHub, and how a
 * refusal for too many requests is waited out, is in intercom-updater-poll.ts. The notes of the
 * releases are kept with the answer, for "What's new" (intercom-updater-notes.ts).
 *
 * A build that is not a packaged release (no `intercomVersion` in package.json) never updates.
 * Every step is written to the diagnostics log as an `updater` record, and how long each check
 * took as an `update_check` record. Where the update stands (intercom-updater-state.ts) is pushed
 * to the window with every change, with the last steps as lines to show.
 */

import { app, ipcMain, net, powerMonitor, shell } from "electron";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import { getIntercomVersion } from "./build-config.js";
import { logDiagnostics } from "./intercom-diagnostics.js";
import {
    fetchReleasesCached,
    probeReleasesFeed,
    type ReleaseCache,
    ReleaseCheckError,
} from "./intercom-updater-check.js";
import {
    canReplaceDir,
    compareIntercomVersions,
    type GithubRelease,
    isReleaseUrl,
    looksLikeInstall,
    parseIntercomVersion,
    relaunchCommand,
    removeTree,
    selectUpdate,
    stagingDirFor,
    swapInstallDir,
    type UpdateCandidate,
    UPDATE_REPO,
    verifyDownload,
    WINDOWS_INSTALLER_ARGS,
} from "./intercom-updater-core.js";
import { type ReleaseNotes, selectNotes, whatsNew } from "./intercom-updater-notes.js";
import { type PollCheck, type PollReason, UpdatePoller } from "./intercom-updater-poll.js";
import {
    initialUpdaterMachine,
    isWorking,
    SpeedMeter,
    type UpdaterEvent,
    type UpdaterMachine,
    updaterTransition,
} from "./intercom-updater-state.js";

const INITIAL_CHECK_DELAY_MS = 30 * 1000;
/** How long the release's SHA256SUMS, a few hundred bytes, may take. */
const SUMS_TIMEOUT_MS = 15 * 1000;
/** How often the window is told how far a download is. */
const PROGRESS_INTERVAL_MS = 250;
const RELEASES_PAGE = `https://github.com/${UPDATE_REPO}/releases`;
/** The IPC channel of the updater: requests from the window, and state pushed to it. */
const CHANNEL = "intercomUpdater";

/** What the window shows of the updater: what this install can do, and where an update stands. */
export interface UpdaterState extends UpdaterMachine {
    /** False where the app cannot look for updates at all; `reason` then says why */
    supported: boolean;
    reason?: "unpackaged" | "no-version" | "disabled-by-flag" | "platform";
    /** The InterCom release that is running */
    currentVersion?: string;
    autoCheck: boolean;
    /** Whether a start looks for an update before the window opens and installs it at once, see intercom-update-on-launch.ts */
    updateOnLaunch: boolean;
    /** Whether the app looks every few minutes, and when the window is focused or the network returns, rather than every six hours */
    fastCheck: boolean;
    /** Whether the notes of a release are shown once after it was installed */
    showWhatsNew: boolean;
    /** Whether the update that is on its way is installed, and the app started again, as soon as it is ready: the user asked for it */
    installWhenReady: boolean;
    channel: "stable";
}

/** The notes the window shows. */
export interface UpdaterNotes {
    /** Of the releases newer than the running one, up to the one that is offered; newest first */
    pending: ReleaseNotes[];
    /** Of the releases that came with the last update, to be shown once; empty where there is nothing to show */
    whatsNew: ReleaseNotes[];
    currentVersion?: string;
}

/** Why the releases are asked for; written to the diagnostics log. */
export type CheckReason = PollReason | "manual" | "click" | "launch" | "startup" | "auto";

const state: UpdaterState = {
    supported: false,
    autoCheck: true,
    updateOnLaunch: true,
    fastCheck: true,
    showWhatsNew: true,
    installWhenReady: false,
    channel: "stable",
    ...initialUpdaterMachine(),
};
/** The release whose notes were last shown or passed over */
let lastSeenVersion: string | undefined;
/** Whether an InterCom has used this profile before this start */
let profileUsedBefore = false;
/** The releases the last check got, or the ones kept from an earlier run */
let knownReleases: GithubRelease[] | undefined;
/** How the last check went, for the schedule */
let lastOutcome: PollCheck = { ok: true, found: false };
let poller: UpdatePoller | undefined;
/** How the last check failed, if it did; undefined after one that got its answer */
let lastCheckFailure: "timeout" | "failed" | undefined;
let prepared: { version: string; file: string } | undefined;
const listeners = new Set<(state: UpdaterState) => void>();

/** Where the updater stands. The object is the updater's own: it changes, and is not to be changed. */
export function getUpdaterState(): Readonly<UpdaterState> {
    return state;
}

/**
 * Tells `listener` whenever the updater's state changes (the tray menu, for its "Restart to update").
 * @returns what stops the telling
 */
export function onUpdaterState(listener: (state: UpdaterState) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function log(step: string, fields: Record<string, string | number | boolean | null | undefined> = {}): void {
    console.log(`[updater] ${step}`, JSON.stringify(fields));
    logDiagnostics("updater", { step, ...fields });
}

function settingsFile(): string {
    return path.join(app.getPath("userData"), "intercom-updater.json");
}

type Switches = Pick<UpdaterState, "autoCheck" | "updateOnLaunch" | "fastCheck" | "showWhatsNew">;

/** The updater's switches, as the profile holds them (all are on until turned off), and the release whose notes were seen. */
function readSettings(): Switches & { lastSeenVersion?: string } {
    try {
        const stored = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
        return {
            autoCheck: stored.autoCheck !== false,
            updateOnLaunch: stored.updateOnLaunch !== false,
            fastCheck: stored.fastCheck !== false,
            showWhatsNew: stored.showWhatsNew !== false,
            lastSeenVersion: typeof stored.lastSeenVersion === "string" ? stored.lastSeenVersion : undefined,
        };
    } catch {
        return { autoCheck: true, updateOnLaunch: true, fastCheck: true, showWhatsNew: true };
    }
}

async function writeSettings(): Promise<void> {
    const settings = {
        autoCheck: state.autoCheck,
        updateOnLaunch: state.updateOnLaunch,
        fastCheck: state.fastCheck,
        showWhatsNew: state.showWhatsNew,
        lastSeenVersion,
    };
    await fsp.writeFile(settingsFile(), JSON.stringify(settings)).catch(() => {});
}

/** How the last check failed, if it did: by running out of time, or otherwise. */
export function getLastCheckFailure(): "timeout" | "failed" | undefined {
    return lastCheckFailure;
}

/** Whether this install can put a release in its own place: always on Windows, on Linux where its directory is the user's. */
export async function canInstallItself(): Promise<boolean> {
    return process.platform === "win32" || (!process.env.APPIMAGE && (await canReplaceDir(installDir())));
}

/** Where downloads are kept until they are installed. */
function cacheDir(): string {
    if (process.platform === "linux") {
        const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
        return path.join(base, "intercom-updates");
    }
    return path.join(app.getPath("userData"), "updates");
}

/** The directory the app runs from: the one that an update replaces on Linux. */
function installDir(): string {
    return path.dirname(process.execPath);
}

function publish(change: Partial<UpdaterState> = {}): void {
    Object.assign(state, change);
    const window = global.mainWindow;
    if (window && !window.isDestroyed()) window.webContents.send(CHANNEL, state);
    for (const listener of listeners) {
        try {
            listener(state);
        } catch (e) {
            console.error("[updater] listener failed", e);
        }
    }
}

/**
 * Takes the update a step further and tells the window.
 * @returns false if the step does not follow from where the update stands, and nothing changed
 */
function dispatch(event: UpdaterEvent): boolean {
    const next = updaterTransition(state, event, Date.now());
    if (next === state) return false;
    publish(next);
    return true;
}

function cacheFile(): string {
    return path.join(app.getPath("userData"), "intercom-updater-releases.json");
}

async function readReleaseCache(): Promise<ReleaseCache | undefined> {
    return JSON.parse(await fsp.readFile(cacheFile(), "utf8")) as ReleaseCache;
}

async function writeReleaseCache(cache: ReleaseCache): Promise<void> {
    await fsp.writeFile(cacheFile(), JSON.stringify(cache));
}

async function download(
    url: string,
    file: string,
    onProgress?: (done: number, total: number, bytesPerSecond: number) => void,
): Promise<void> {
    if (!isReleaseUrl(url)) throw new Error("Not a release URL");
    const response = await net.fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
    const total = Number(response.headers.get("content-length")) || 0;
    let done = 0;
    let lastTold = 0;
    const speed = new SpeedMeter();
    // The stream types of the DOM and of Node differ in name only
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- needed by tsc, see above
    const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    body.on("data", (chunk: Buffer) => {
        done += chunk.length;
        const now = Date.now();
        if (onProgress && now - lastTold >= PROGRESS_INTERVAL_MS) {
            lastTold = now;
            onProgress(done, total, speed.note(done, now));
        }
    });
    const part = `${file}.part`;
    await pipeline(body, fs.createWriteStream(part));
    await fsp.rename(part, file);
}

/** Downloads the release's file and checks it; a file that is there and passes is used as it is. */
async function fetchVerified(candidate: UpdateCandidate): Promise<string> {
    const asset = candidate.asset!;
    const dir = cacheDir();
    await fsp.mkdir(dir, { recursive: true });
    const sumsResponse = await net.fetch(candidate.sumsUrl!, {
        redirect: "follow",
        signal: AbortSignal.timeout(SUMS_TIMEOUT_MS),
    });
    if (!sumsResponse.ok) throw new Error(`SHA256SUMS: HTTP ${sumsResponse.status}`);
    const sums = await sumsResponse.text();
    const file = path.join(dir, asset.name);

    if (
        await fsp.access(file).then(
            () => true,
            () => false,
        )
    ) {
        dispatch({ type: "verify" });
        try {
            await verifyDownload(file, asset.name, sums);
            log("download_reused", { version: candidate.version });
            return file;
        } catch {
            // Not whole: fetch it again
            dispatch({
                type: "download",
                version: candidate.version,
                releaseUrl: candidate.releaseUrl,
                total: asset.size,
            });
        }
    }
    log("download_start", { version: candidate.version, bytes: asset.size });
    const started = Date.now();
    await download(asset.url, file, (done, total, bytesPerSecond) =>
        dispatch({ type: "progress", done, total: total || asset.size || 0, bytesPerSecond }),
    );
    dispatch({ type: "verify" });
    const sha256 = await verifyDownload(file, asset.name, sums).catch(async (e) => {
        await fsp.rm(file, { force: true });
        throw e;
    });
    log("download_verified", { version: candidate.version, sha256, ms: Date.now() - started });
    return file;
}

/** Linux: unpacks the archive beside the install directory, ready to be swapped in. */
async function stage(archive: string): Promise<void> {
    const staging = stagingDirFor(installDir());
    await removeTree(staging);
    await fsp.mkdir(staging);
    try {
        // The archive holds one directory (intercom-<version>/), whose contents are the install
        await promisify(execFile)("tar", ["-xzf", archive, "-C", staging, "--strip-components=1"]);
        if (!(await looksLikeInstall(staging, path.basename(process.execPath)))) {
            throw new Error("The archive does not hold an InterCom install");
        }
    } catch (e) {
        await removeTree(staging);
        throw e;
    }
    log("staged", { beside: true });
}

/** The releases that are known: of the last check, or else the ones an earlier run kept. */
async function releasesKnown(): Promise<GithubRelease[] | undefined> {
    if (!knownReleases) {
        const kept = await readReleaseCache().catch(() => undefined);
        // Not kept in memory: a check may be writing a newer answer
        if (Array.isArray(kept?.releases)) return kept.releases;
    }
    return knownReleases;
}

/** The notes of the update that is offered and, once after an update, of what it brought. */
async function getNotes(): Promise<UpdaterNotes> {
    const releases = await releasesKnown();
    const current = state.currentVersion;
    const decision = whatsNew({
        current,
        lastSeen: lastSeenVersion,
        enabled: state.showWhatsNew,
        profileUsedBefore,
        releases,
    });
    if (decision.markSeen && decision.markSeen !== lastSeenVersion) {
        lastSeenVersion = decision.markSeen;
        await writeSettings();
    }
    return {
        pending: state.latestVersion && current ? selectNotes(releases, current, state.latestVersion) : [],
        whatsNew: decision.notes,
        currentVersion: current,
    };
}

/** Asks GitHub for the releases and writes how long that took to the diagnostics log. */
async function fetchReleases(
    manual: boolean,
    reason: CheckReason,
    timeoutMs?: number,
): Promise<ReturnType<typeof selectUpdate>> {
    try {
        const check = await fetchReleasesCached({
            fetch: (url, init) => net.fetch(url, init),
            readCache: readReleaseCache,
            writeCache: writeReleaseCache,
            timeoutMs,
        });
        knownReleases = check.releases;
        logDiagnostics("update_check", {
            manual,
            reason,
            ok: true,
            ms: check.ms,
            headersMs: check.headersMs,
            status: check.status,
            cached: check.cached,
            bytes: check.bytes,
            requests: check.requests,
            releases: check.releases.length,
        });
        return selectUpdate(check.releases, state.currentVersion!, process.platform, process.arch);
    } catch (e) {
        if (e instanceof ReleaseCheckError) {
            logDiagnostics("update_check", {
                manual,
                reason,
                ok: false,
                ms: e.ms,
                status: e.status ?? null,
                timedOut: e.timedOut,
                rateLimitedForMs: e.retryAt === undefined ? undefined : Math.max(0, e.retryAt - Date.now()),
            });
        }
        throw e;
    }
}

/**
 * Looks for a newer release and, where this install can replace itself, downloads it.
 * @param manual - whether the user asked for it. A check nobody asked for that fails (no network,
 *     GitHub not answering) is logged and not shown as an error.
 * @param checkTimeoutMs - how long GitHub has to answer, where that is not the usual time: the
 *     check at the start of the app has less
 * @param reason - what asked for the check, for the diagnostics log
 */
export async function checkForUpdate(
    manual = false,
    checkTimeoutMs?: number,
    reason: CheckReason = manual ? "manual" : "auto",
): Promise<UpdaterState> {
    lastOutcome = { ok: true, found: true };
    if (!state.supported || isWorking(state.phase)) return state;
    // What is downloaded already is offered again rather than fetched again
    if (state.phase === "ready" && prepared) {
        publish();
        return state;
    }
    // "Checking…" is shown before anything is asked
    if (!dispatch({ type: "check" })) return state;
    log("check", { manual, reason, current: state.currentVersion });
    let checking = true;
    lastCheckFailure = undefined;
    try {
        const candidate = await fetchReleases(manual, reason, checkTimeoutMs);
        checking = false;
        lastOutcome = { ok: true, found: Boolean(candidate) };
        poller?.noteCheck(lastOutcome);
        if (!candidate) {
            log("up_to_date");
            state.installWhenReady = false;
            dispatch({ type: "up_to_date" });
            return state;
        }
        const found = { version: candidate.version, releaseUrl: candidate.releaseUrl };
        log("update_found", { version: candidate.version, asset: Boolean(candidate.asset) });

        const replaceable = await canInstallItself();
        if (!candidate.asset || !candidate.sumsUrl || !replaceable) {
            // A release without this platform's file (yet), or an install that is not ours to replace
            log("manual", { asset: Boolean(candidate.asset), sums: Boolean(candidate.sumsUrl), replaceable });
            state.installWhenReady = false;
            dispatch({ type: "manual", ...found });
            return state;
        }

        dispatch({ type: "download", ...found, total: candidate.asset.size });
        const file = await fetchVerified(candidate);
        if (process.platform === "linux") {
            dispatch({ type: "unpack" });
            await stage(file);
        }
        prepared = { version: candidate.version, file };
        log("ready", { version: candidate.version });
        const installNow = state.installWhenReady;
        state.installWhenReady = false;
        dispatch({ type: "ready" });
        // The user asked for it while it was on its way: no second click
        if (installNow) await installUpdate();
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log("error", { message });
        state.installWhenReady = false;
        if (checking) {
            lastCheckFailure = e instanceof ReleaseCheckError && e.timedOut ? "timeout" : "failed";
            lastOutcome = { ok: false, found: false, retryAt: e instanceof ReleaseCheckError ? e.retryAt : undefined };
            poller?.noteCheck(lastOutcome);
        }
        dispatch({ type: "error", message, quiet: checking && !manual });
    }
    return state;
}

/** Installs what {@link checkForUpdate} prepared and starts the app again. */
export async function installUpdate(): Promise<void> {
    if (state.phase !== "ready" || !prepared) return;
    dispatch({ type: "install" });
    try {
        if (process.platform === "win32") {
            // The installer closes what is left of the app, replaces it and starts it again
            log("install_windows", { version: prepared.version });
            spawn(prepared.file, WINDOWS_INSTALLER_ARGS, { detached: true, stdio: "ignore" }).unref();
        } else {
            const dir = installDir();
            const { backupDir } = await swapInstallDir(dir, stagingDirFor(dir));
            const command = relaunchCommand(process.execPath, process.argv, process.env);
            log("install_linux", {
                version: prepared.version,
                backup: path.basename(backupDir),
                viaLauncher: command.execPath !== process.execPath,
            });
            app.relaunch(command);
        }
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log("install_error", { message });
        // What was staged is of no use any more: the next check prepares it again
        prepared = undefined;
        dispatch({ type: "error", message });
        return;
    }
    global.appQuitting = true;
    app.quit();
}

/**
 * The click on the update button: the update is installed and the app started again, now if it
 * is ready, and otherwise as soon as it is, with the download started or carried on meanwhile.
 * A release this install cannot put in place is shown on its page instead.
 */
export async function updateNow(): Promise<void> {
    if (!state.supported || state.phase === "installing") return;
    if (state.phase === "ready" && prepared) {
        await installUpdate();
        return;
    }
    if (state.phase === "manual") {
        await shell.openExternal(isReleaseUrl(state.releaseUrl) ? state.releaseUrl! : RELEASES_PAGE);
        return;
    }
    log("install_when_ready", { phase: state.phase });
    publish({ installWhenReady: true });
    if (!isWorking(state.phase)) void checkForUpdate(true, undefined, "click");
}

/** Sets the schedule of the looks for a new release as the switches say. */
function schedule(): void {
    poller?.configure({ enabled: state.supported && state.autoCheck, fast: state.fastCheck });
}

/** The window got the focus, the computer woke up or the network is back: a reason to look now. */
function trigger(reason: "focus" | "online" | "resume"): void {
    if (poller?.trigger(reason)) log("check_triggered", { reason });
}

function createPoller(): UpdatePoller {
    return new UpdatePoller({
        now: Date.now,
        setTimer: (callback, ms) => setTimeout(callback, ms),
        clearTimer: (timer) => clearTimeout(timer as NodeJS.Timeout),
        probe: async (etag, reason) => {
            try {
                const probe = await probeReleasesFeed({ fetch: (url, init) => net.fetch(url, init), etag });
                logDiagnostics("update_check", {
                    probe: true,
                    reason,
                    ok: true,
                    ms: probe.ms,
                    status: probe.status,
                    changed: probe.changed,
                });
                return probe;
            } catch (e) {
                if (e instanceof ReleaseCheckError) {
                    logDiagnostics("update_check", {
                        probe: true,
                        reason,
                        ok: false,
                        ms: e.ms,
                        status: e.status ?? null,
                        timedOut: e.timedOut,
                        rateLimitedForMs: e.retryAt === undefined ? undefined : Math.max(0, e.retryAt - Date.now()),
                    });
                }
                throw e;
            }
        },
        check: async (reason) => {
            await checkForUpdate(false, undefined, reason);
            return lastOutcome;
        },
        onPoll: (record) => {
            if (record.did === "skip" || record.blockedUntil !== undefined) {
                log("check_rate_limited", {
                    reason: record.reason,
                    forMs: Math.max(0, (record.blockedUntil ?? 0) - Date.now()),
                });
            }
        },
    });
}

/** What is left of earlier updates: downloads of releases that are not newer than this one. */
async function tidyCache(): Promise<void> {
    const current = parseIntercomVersion(state.currentVersion);
    if (!current) return;
    for (const name of await fsp.readdir(cacheDir()).catch(() => [] as string[])) {
        const version = /^InterCom-(?:Setup-)?(.+?)-(?:linux-)?x64\.(?:tar\.gz|exe)(?:\.part)?$/.exec(name)?.[1];
        const parsed = parseIntercomVersion(version);
        if (name.endsWith(".part") || (parsed && compareIntercomVersions(parsed, current) <= 0)) {
            await fsp.rm(path.join(cacheDir(), name), { force: true });
        }
    }
}

/**
 * Starts the updater: a first check after half a minute, then the schedule of
 * intercom-updater-poll.ts, unless the user turned automatic checks off. Call once the app is ready and the diagnostics log is open.
 * @param allowed - false when the app was started with `--no-update`
 */
export function initUpdater(allowed: boolean): void {
    const currentVersion = getIntercomVersion();
    let reason: UpdaterState["reason"];
    if (!app.isPackaged) reason = "unpackaged";
    else if (!parseIntercomVersion(currentVersion)) reason = "no-version";
    else if (!allowed) reason = "disabled-by-flag";
    else if (process.platform !== "linux" && process.platform !== "win32") reason = "platform";

    // Asked before anything is written: a profile without either file never ran an updater
    profileUsedBefore = fs.existsSync(settingsFile()) || fs.existsSync(cacheFile());
    const { lastSeenVersion: seen, ...switches } = readSettings();
    lastSeenVersion = seen;
    Object.assign(state, { supported: !reason, reason, currentVersion, ...switches });
    log("init", {
        supported: state.supported,
        reason,
        current: currentVersion,
        autoCheck: state.autoCheck,
        updateOnLaunch: state.updateOnLaunch,
        fastCheck: state.fastCheck,
        showWhatsNew: state.showWhatsNew,
    });

    ipcMain.handle(CHANNEL, async (_ev, action: string, arg?: unknown): Promise<UpdaterState | UpdaterNotes> => {
        switch (action) {
            case "update":
                await updateNow();
                break;
            case "getNotes":
                return getNotes();
            case "whatsNewSeen":
                if (state.currentVersion && lastSeenVersion !== state.currentVersion) {
                    lastSeenVersion = state.currentVersion;
                    await writeSettings();
                    log("whats_new_seen", { version: lastSeenVersion });
                }
                break;
            case "setFastCheck":
                state.fastCheck = Boolean(arg);
                await writeSettings();
                log("fast_check", { on: state.fastCheck });
                schedule();
                publish();
                break;
            case "setShowWhatsNew":
                state.showWhatsNew = Boolean(arg);
                await writeSettings();
                log("show_whats_new", { on: state.showWhatsNew });
                publish();
                break;
            case "online":
                trigger("online");
                break;
            case "check":
                // Not awaited: the window follows the state that is pushed to it
                void checkForUpdate(true);
                break;
            case "install":
                await installUpdate();
                break;
            case "setAutoCheck":
                state.autoCheck = Boolean(arg);
                await writeSettings();
                log("auto_check", { on: state.autoCheck });
                schedule();
                publish();
                break;
            case "setUpdateOnLaunch":
                state.updateOnLaunch = Boolean(arg);
                await writeSettings();
                log("update_on_launch_setting", { on: state.updateOnLaunch });
                publish();
                break;
            case "openReleasePage":
                await shell.openExternal(isReleaseUrl(state.releaseUrl) ? state.releaseUrl! : RELEASES_PAGE);
                break;
        }
        return state;
    });

    if (!state.supported) return;
    void tidyCache();
    if (state.autoCheck) setTimeout(() => void checkForUpdate(false, undefined, "startup"), INITIAL_CHECK_DELAY_MS);
    poller = createPoller();
    schedule();
    app.on("browser-window-focus", () => trigger("focus"));
    powerMonitor.on("resume", () => trigger("resume"));
    powerMonitor.on("unlock-screen", () => trigger("resume"));
}
