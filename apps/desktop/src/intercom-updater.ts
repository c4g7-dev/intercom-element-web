/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * InterCom updates itself from the releases of its GitHub repository.
 *
 * A check asks the GitHub API for the releases, picks the newest desktop one (tags
 * `v<Element version>-intercom.<n>`; the Android releases of the same repository are passed over),
 * downloads this platform's file and checks it against the release's SHA256SUMS. Then the window
 * is told, and the user decides when to restart:
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
 * A build that is not a packaged release (no `intercomVersion` in package.json) never updates.
 * Every step is written to the diagnostics log as an `updater` record.
 */

import { app, ipcMain, net, shell } from "electron";
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
    canReplaceDir,
    compareIntercomVersions,
    type GithubRelease,
    isReleaseUrl,
    looksLikeInstall,
    parseIntercomVersion,
    relaunchCommand,
    selectUpdate,
    stagingDirFor,
    swapInstallDir,
    type UpdateCandidate,
    UPDATE_REPO,
    verifyDownload,
    WINDOWS_INSTALLER_ARGS,
} from "./intercom-updater-core.js";

const INITIAL_CHECK_DELAY_MS = 30 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RELEASES_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=30`;
const RELEASES_PAGE = `https://github.com/${UPDATE_REPO}/releases`;
/** The IPC channel of the updater: requests from the window, and state pushed to it. */
const CHANNEL = "intercomUpdater";

/** What the window shows of the updater. */
export interface UpdaterState {
    /** False where the app cannot look for updates at all; `reason` then says why */
    supported: boolean;
    reason?: "unpackaged" | "no-version" | "disabled-by-flag" | "platform";
    /** The InterCom release that is running */
    currentVersion?: string;
    autoCheck: boolean;
    channel: "stable";
    /**
     * idle: nothing newer is known. ready: downloaded and checked, a restart installs it.
     * manual: there is a newer release but this install cannot replace itself.
     */
    phase: "idle" | "checking" | "downloading" | "ready" | "manual" | "error";
    latestVersion?: string;
    releaseUrl?: string;
    /** 0 to 1 while downloading */
    progress?: number;
    error?: string;
    /** When the last check ended, in ms since the epoch */
    lastChecked?: number;
}

const state: UpdaterState = { supported: false, autoCheck: true, channel: "stable", phase: "idle" };
let prepared: { version: string; file: string } | undefined;
let busy = false;
let timer: NodeJS.Timeout | undefined;

function log(step: string, fields: Record<string, string | number | boolean | null | undefined> = {}): void {
    console.log(`[updater] ${step}`, JSON.stringify(fields));
    logDiagnostics("updater", { step, ...fields });
}

function settingsFile(): string {
    return path.join(app.getPath("userData"), "intercom-updater.json");
}

function readAutoCheck(): boolean {
    try {
        return JSON.parse(fs.readFileSync(settingsFile(), "utf8")).autoCheck !== false;
    } catch {
        return true;
    }
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

function publish(change: Partial<UpdaterState>): void {
    Object.assign(state, change);
    const window = global.mainWindow;
    if (window && !window.isDestroyed()) window.webContents.send(CHANNEL, state);
}

async function download(url: string, file: string, onProgress?: (fraction: number) => void): Promise<void> {
    if (!isReleaseUrl(url)) throw new Error("Not a release URL");
    const response = await net.fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
    const total = Number(response.headers.get("content-length")) || 0;
    let done = 0;
    let lastTold = 0;
    // The stream types of the DOM and of Node differ in name only
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion -- needed by tsc, see above
    const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    body.on("data", (chunk: Buffer) => {
        done += chunk.length;
        const now = Date.now();
        if (total && onProgress && now - lastTold > 500) {
            lastTold = now;
            onProgress(done / total);
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
    const sumsResponse = await net.fetch(candidate.sumsUrl!, { redirect: "follow" });
    if (!sumsResponse.ok) throw new Error(`SHA256SUMS: HTTP ${sumsResponse.status}`);
    const sums = await sumsResponse.text();
    const file = path.join(dir, asset.name);

    try {
        await verifyDownload(file, asset.name, sums);
        log("download_reused", { version: candidate.version });
        return file;
    } catch {
        // Not there, or not whole: fetch it
    }
    log("download_start", { version: candidate.version, bytes: asset.size });
    const started = Date.now();
    await download(asset.url, file, (progress) => publish({ progress }));
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
    await fsp.rm(staging, { recursive: true, force: true });
    await fsp.mkdir(staging);
    try {
        // The archive holds one directory (intercom-<version>/), whose contents are the install
        await promisify(execFile)("tar", ["-xzf", archive, "-C", staging, "--strip-components=1"]);
        if (!(await looksLikeInstall(staging, path.basename(process.execPath)))) {
            throw new Error("The archive does not hold an InterCom install");
        }
    } catch (e) {
        await fsp.rm(staging, { recursive: true, force: true });
        throw e;
    }
    log("staged", { beside: true });
}

async function fetchReleases(): Promise<GithubRelease[]> {
    const response = await net.fetch(RELEASES_URL, { headers: { Accept: "application/vnd.github+json" } });
    if (!response.ok) throw new Error(`GitHub: HTTP ${response.status}`);
    return (await response.json()) as GithubRelease[];
}

/**
 * Looks for a newer release and, where this install can replace itself, downloads it.
 * @param manual - whether the user asked for it (logged only)
 */
export async function checkForUpdate(manual = false): Promise<UpdaterState> {
    if (!state.supported || busy) return state;
    // What is downloaded already is offered again rather than fetched again
    if (state.phase === "ready" && prepared) {
        publish({});
        return state;
    }
    busy = true;
    publish({ phase: "checking", error: undefined, progress: undefined });
    log("check", { manual, current: state.currentVersion });
    try {
        const candidate = selectUpdate(await fetchReleases(), state.currentVersion!, process.platform, process.arch);
        if (!candidate) {
            log("up_to_date");
            publish({ phase: "idle", latestVersion: undefined, releaseUrl: undefined, lastChecked: Date.now() });
            return state;
        }
        const found = { latestVersion: candidate.version, releaseUrl: candidate.releaseUrl, lastChecked: Date.now() };
        log("update_found", { version: candidate.version, asset: Boolean(candidate.asset) });

        const replaceable =
            process.platform === "win32" || (!process.env.APPIMAGE && (await canReplaceDir(installDir())));
        if (!candidate.asset || !candidate.sumsUrl || !replaceable) {
            // A release without this platform's file (yet), or an install that is not ours to replace
            log("manual", { asset: Boolean(candidate.asset), sums: Boolean(candidate.sumsUrl), replaceable });
            publish({ phase: "manual", ...found });
            return state;
        }

        publish({ phase: "downloading", progress: 0, ...found });
        const file = await fetchVerified(candidate);
        if (process.platform === "linux") await stage(file);
        prepared = { version: candidate.version, file };
        log("ready", { version: candidate.version });
        publish({ phase: "ready", progress: undefined });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log("error", { message });
        publish({ phase: "error", error: message, progress: undefined, lastChecked: Date.now() });
    } finally {
        busy = false;
    }
    return state;
}

/** Installs what {@link checkForUpdate} prepared and starts the app again. */
export async function installUpdate(): Promise<void> {
    if (state.phase !== "ready" || !prepared) return;
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
        publish({ phase: "error", error: message });
        return;
    }
    global.appQuitting = true;
    app.quit();
}

function schedule(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (!state.supported || !state.autoCheck) return;
    timer = setInterval(() => void checkForUpdate(), CHECK_INTERVAL_MS);
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
 * Starts the updater: a first check after half a minute, then every six hours, unless the user
 * turned automatic checks off. Call once the app is ready and the diagnostics log is open.
 * @param allowed - false when the app was started with `--no-update`
 */
export function initUpdater(allowed: boolean): void {
    const currentVersion = getIntercomVersion();
    let reason: UpdaterState["reason"];
    if (!app.isPackaged) reason = "unpackaged";
    else if (!parseIntercomVersion(currentVersion)) reason = "no-version";
    else if (!allowed) reason = "disabled-by-flag";
    else if (process.platform !== "linux" && process.platform !== "win32") reason = "platform";

    Object.assign(state, { supported: !reason, reason, currentVersion, autoCheck: readAutoCheck() });
    log("init", { supported: state.supported, reason, current: currentVersion, autoCheck: state.autoCheck });

    ipcMain.handle(CHANNEL, async (_ev, action: string, arg?: unknown): Promise<UpdaterState> => {
        switch (action) {
            case "check":
                // Not awaited: the window follows the state that is pushed to it
                void checkForUpdate(true);
                break;
            case "install":
                await installUpdate();
                break;
            case "setAutoCheck":
                state.autoCheck = Boolean(arg);
                await fsp.writeFile(settingsFile(), JSON.stringify({ autoCheck: state.autoCheck })).catch(() => {});
                log("auto_check", { on: state.autoCheck });
                schedule();
                publish({});
                break;
            case "openReleasePage":
                await shell.openExternal(isReleaseUrl(state.releaseUrl) ? state.releaseUrl! : RELEASES_PAGE);
                break;
        }
        return state;
    });

    if (!state.supported) return;
    void tidyCache();
    if (state.autoCheck) setTimeout(() => void checkForUpdate(), INITIAL_CHECK_DELAY_MS);
    schedule();
}
