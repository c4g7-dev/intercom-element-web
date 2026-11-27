/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const electron = vi.hoisted(() => ({
    isPackaged: true,
    userData: "",
    fetch: vi.fn(),
    relaunch: vi.fn(),
    quit: vi.fn(),
    handle: vi.fn(),
    openExternal: vi.fn(),
    send: vi.fn(),
    appOn: vi.fn(),
    powerOn: vi.fn(),
    version: "1.12.35-intercom.5" as string | undefined,
    records: [] as Array<Record<string, unknown>>,
}));

vi.mock("electron", () => ({
    app: {
        get isPackaged(): boolean {
            return electron.isPackaged;
        },
        getPath: (): string => electron.userData,
        relaunch: electron.relaunch,
        quit: electron.quit,
        on: electron.appOn,
    },
    powerMonitor: { on: electron.powerOn },
    ipcMain: { handle: electron.handle },
    net: { fetch: electron.fetch },
    shell: { openExternal: electron.openExternal },
}));
vi.mock("./build-config.js", () => ({ getIntercomVersion: (): string | undefined => electron.version }));
vi.mock("./intercom-diagnostics.js", () => ({
    logDiagnostics: (type: string, fields: Record<string, unknown>): void => {
        electron.records.push({ type, ...fields });
    },
}));

const RELEASES = "https://github.com/c4g7-dev/InterCom/releases";
const FEED = `${RELEASES}.atom`;
const API = "https://api.github.com/repos/c4g7-dev/InterCom/releases";
const NEW = "1.12.35-intercom.6";
const ASSET = `InterCom-${NEW}-linux-x64.tar.gz`;

// The updater is for Linux and Windows; what is tested here is the Linux half
describe.runIf(process.platform === "linux")("the updater, from the check to the restart", () => {
    let tmp: string;
    let installDir: string;
    let archive: Buffer;
    let sums: string;
    let releases: unknown;
    /** The ETag of the releases feed, as GitHub has it */
    let feedEtag: string;
    const asked = (prefix: string): number =>
        electron.fetch.mock.calls.filter(([url]) => String(url).startsWith(prefix)).length;
    const realExecPath = process.execPath;
    const realArgv = process.argv;
    const realEnv = { ...process.env };

    async function load(): Promise<typeof import("./intercom-updater.js")> {
        vi.resetModules();
        return import("./intercom-updater.js");
    }

    /** The handler the updater registered for the window's requests. */
    function ipc(): (ev: unknown, action: string, arg?: unknown) => Promise<{ phase: string; autoCheck: boolean }> {
        return electron.handle.mock.lastCall![1];
    }

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "intercom-updater-e2e-"));
        electron.userData = path.join(tmp, "profile");
        fs.mkdirSync(electron.userData);
        electron.isPackaged = true;
        electron.version = "1.12.35-intercom.5";
        electron.records.length = 0;
        for (const mock of [
            electron.relaunch,
            electron.quit,
            electron.handle,
            electron.openExternal,
            electron.send,
            electron.appOn,
            electron.powerOn,
        ]) {
            mock.mockReset();
        }

        // The install that is running
        installDir = path.join(tmp, "opt", "intercom");
        fs.mkdirSync(path.join(installDir, "resources"), { recursive: true });
        fs.writeFileSync(path.join(installDir, "intercom"), "old", { mode: 0o755 });
        fs.writeFileSync(path.join(installDir, "resources", "app.asar"), "old");
        Object.defineProperty(process, "execPath", { value: path.join(installDir, "intercom"), configurable: true });
        process.argv = [process.execPath, "--ozone-platform-hint=auto", "--disable-quic", "intercom://vector/webapp/"];
        process.env.XDG_CACHE_HOME = path.join(tmp, "cache");
        delete process.env.APPIMAGE;
        delete process.env.INTERCOM_LAUNCHER;
        delete process.env.INTERCOM_LAUNCHER_ARGS;

        // The release it finds: an archive with one directory, as electron-builder makes it
        const staging = path.join(tmp, "build", "intercom-1.12.35");
        fs.mkdirSync(path.join(staging, "resources"), { recursive: true });
        fs.writeFileSync(path.join(staging, "intercom"), "new", { mode: 0o755 });
        fs.writeFileSync(path.join(staging, "resources", "app.asar"), "new");
        const archivePath = path.join(tmp, "build", ASSET);
        execFileSync("tar", ["-czf", archivePath, "-C", path.join(tmp, "build"), "intercom-1.12.35"]);
        archive = fs.readFileSync(archivePath);
        sums = `${crypto.createHash("sha256").update(archive).digest("hex")}  ${ASSET}\n`;
        releases = [
            {
                tag_name: "android-v26.11.1-intercom.9",
                html_url: `${RELEASES}/tag/android-v26.11.1-intercom.9`,
                assets: [],
            },
            {
                tag_name: `v${NEW}`,
                html_url: `${RELEASES}/tag/v${NEW}`,
                assets: [ASSET, "SHA256SUMS"].map((name) => ({
                    name,
                    browser_download_url: `${RELEASES}/download/v${NEW}/${name}`,
                    size: archive.length,
                })),
            },
        ];
        feedEtag = 'W/"feed-1"';
        electron.fetch.mockReset();
        electron.fetch.mockImplementation(async (url: string, init?: { headers?: Record<string, string> }) => {
            if (url.startsWith("https://api.github.com/repos/c4g7-dev/InterCom/releases")) {
                return new Response(JSON.stringify(releases));
            }
            if (url === FEED) {
                return init?.headers?.["If-None-Match"] === feedEtag
                    ? new Response(null, { status: 304 })
                    : new Response("<feed/>", { headers: { etag: feedEtag } });
            }
            if (url.endsWith("/SHA256SUMS")) return new Response(sums);
            if (url.endsWith(`/${ASSET}`)) {
                return new Response(new Uint8Array(archive), { headers: { "content-length": String(archive.length) } });
            }
            return new Response("not found", { status: 404 });
        });
        (global as unknown as { mainWindow: unknown }).mainWindow = {
            isDestroyed: () => false,
            webContents: { send: electron.send },
        };
    });

    afterEach(() => {
        vi.useRealTimers();
        Object.defineProperty(process, "execPath", { value: realExecPath, configurable: true });
        process.argv = realArgv;
        process.env = { ...realEnv };
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    const read = (dir: string): string => fs.readFileSync(path.join(dir, "intercom"), "utf8");
    const steps = (): unknown[] => electron.records.filter((r) => r.type === "updater").map((r) => r.step);

    it("finds the release, downloads and checks it, unpacks it beside the install and swaps on restart", async () => {
        const updater = await load();
        updater.initUpdater(true);
        // The state is one object that changes: what the window was sent is noted as it is sent
        const phases: string[] = [];
        electron.send.mockImplementation((_channel: string, sent: { phase: string }) => phases.push(sent.phase));

        const state = await updater.checkForUpdate(true);
        expect(state).toMatchObject({
            supported: true,
            currentVersion: "1.12.35-intercom.5",
            phase: "ready",
            latestVersion: NEW,
            releaseUrl: `${RELEASES}/tag/v${NEW}`,
        });
        // Nothing is replaced before the user says so
        expect(read(installDir)).toBe("old");
        expect(read(`${installDir}.new`)).toBe("new");
        expect(fs.existsSync(path.join(tmp, "cache", "intercom-updates", ASSET))).toBe(true);
        // The window was told along the way
        expect(phases[0]).toBe("checking");
        expect(phases).toContain("downloading");
        expect(electron.send).toHaveBeenLastCalledWith("intercomUpdater", expect.objectContaining({ phase: "ready" }));

        await ipc()({}, "install");
        expect(read(installDir)).toBe("new");
        expect(read(`${installDir}.old`)).toBe("old");
        expect(fs.existsSync(`${installDir}.new`)).toBe(false);
        // Started again with its switches, without the link it was opened with
        expect(electron.relaunch).toHaveBeenCalledWith({
            execPath: path.join(installDir, "intercom"),
            args: ["--ozone-platform-hint=auto", "--disable-quic"],
        });
        expect(electron.quit).toHaveBeenCalledTimes(1);
        expect(steps()).toEqual([
            "init",
            "check",
            "update_found",
            "download_start",
            "download_verified",
            "staged",
            "ready",
            "install_linux",
        ]);
        // Neither a path of the machine nor a URL is written to the log
        expect(JSON.stringify(electron.records)).not.toContain(tmp);
    });

    it("starts the launcher again where there is one", async () => {
        const launcher = path.join(tmp, "launcher.sh");
        fs.writeFileSync(launcher, "#!/bin/sh\n", { mode: 0o755 });
        process.env.INTERCOM_LAUNCHER = launcher;
        process.env.INTERCOM_LAUNCHER_ARGS = "--profile\nwork\n";
        const updater = await load();
        updater.initUpdater(true);
        await updater.checkForUpdate();
        await updater.installUpdate();
        expect(electron.relaunch).toHaveBeenCalledWith({ execPath: launcher, args: ["--profile", "work"] });
    });

    it("refuses a download that does not match its checksum, and leaves the install alone", async () => {
        sums = `${"0".repeat(64)}  ${ASSET}\n`;
        const updater = await load();
        updater.initUpdater(true);
        const state = await updater.checkForUpdate();
        expect(state.phase).toBe("error");
        expect(state.error).toMatch(/Checksum mismatch/);
        expect(fs.existsSync(`${installDir}.new`)).toBe(false);
        expect(fs.existsSync(path.join(tmp, "cache", "intercom-updates", ASSET))).toBe(false);
        await updater.installUpdate();
        expect(read(installDir)).toBe("old");
        expect(electron.quit).not.toHaveBeenCalled();
    });

    it("refuses an archive that does not hold an install", async () => {
        const junk = path.join(tmp, "build", "junk");
        fs.mkdirSync(path.join(junk, "intercom-1.12.35"), { recursive: true });
        fs.writeFileSync(path.join(junk, "intercom-1.12.35", "readme"), "nothing here");
        execFileSync("tar", ["-czf", path.join(tmp, "build", "junk.tar.gz"), "-C", junk, "intercom-1.12.35"]);
        archive = fs.readFileSync(path.join(tmp, "build", "junk.tar.gz"));
        sums = `${crypto.createHash("sha256").update(archive).digest("hex")}  ${ASSET}\n`;
        const updater = await load();
        updater.initUpdater(true);
        expect((await updater.checkForUpdate()).phase).toBe("error");
        expect(fs.existsSync(`${installDir}.new`)).toBe(false);
        expect(read(installDir)).toBe("old");
    });

    it("only points at the release page where the install cannot be replaced", async () => {
        fs.chmodSync(path.dirname(installDir), 0o555);
        try {
            const updater = await load();
            updater.initUpdater(true);
            const state = await updater.checkForUpdate();
            if (process.getuid?.() === 0) return; // root may write anywhere
            expect(state).toMatchObject({ phase: "manual", latestVersion: NEW });
            // Nothing was downloaded
            expect(electron.fetch.mock.calls.every(([url]) => String(url).startsWith("https://api.github.com/"))).toBe(
                true,
            );
            await ipc()({}, "openReleasePage");
            expect(electron.openExternal).toHaveBeenCalledWith(`${RELEASES}/tag/v${NEW}`);
        } finally {
            fs.chmodSync(path.dirname(installDir), 0o755);
        }
    });

    it("says so when there is nothing newer, and when GitHub does not answer", async () => {
        electron.version = NEW;
        let updater = await load();
        updater.initUpdater(true);
        expect(await updater.checkForUpdate()).toMatchObject({ phase: "idle", latestVersion: undefined });
        expect(steps()).toContain("up_to_date");

        electron.fetch.mockImplementation(async () => new Response("rate limited", { status: 403 }));
        updater = await load();
        updater.initUpdater(true);
        // A check nobody asked for is logged, with how long it took, and otherwise not shown
        const quiet = await updater.checkForUpdate();
        expect(quiet).toMatchObject({ phase: "idle", error: undefined });
        expect(quiet.log.at(-1)!.text).toBe("Check failed: GitHub: HTTP 403");
        expect(electron.records.at(-2)).toMatchObject({ type: "update_check", ok: false, status: 403, manual: false });
        // One the user asked for says what went wrong
        expect(await updater.checkForUpdate(true)).toMatchObject({ phase: "error", error: "GitHub: HTTP 403" });
    });

    it("asks GitHub once with the ETag when nothing changed, and writes how long the check took", async () => {
        electron.version = NEW;
        electron.fetch.mockImplementation(async (_url: string, init?: { headers?: Record<string, string> }) =>
            init?.headers?.["If-None-Match"] === 'W/"etag"'
                ? new Response(null, { status: 304 })
                : new Response(JSON.stringify(releases), { headers: { etag: 'W/"etag"' } }),
        );
        const updater = await load();
        updater.initUpdater(true);
        const phases: string[] = [];
        electron.send.mockImplementation((_channel: string, sent: { phase: string }) => phases.push(sent.phase));

        await updater.checkForUpdate(true);
        // "Checking…" is shown before GitHub is asked, and the check ends where it began
        expect(phases).toEqual(["checking", "idle"]);
        const checks = (): Array<Record<string, unknown>> => electron.records.filter((r) => r.type === "update_check");
        expect(checks()).toEqual([
            expect.objectContaining({ ok: true, manual: true, status: 200, cached: false, requests: 1, releases: 2 }),
        ]);
        expect(checks()[0].bytes).toBeGreaterThan(0);
        expect(typeof checks()[0].ms).toBe("number");
        const kept = JSON.parse(
            fs.readFileSync(path.join(electron.userData, "intercom-updater-releases.json"), "utf8"),
        );
        expect(kept.etag).toBe('W/"etag"');

        // The next check, also after a restart, is answered with "nothing changed"
        const next = await load();
        next.initUpdater(true);
        expect(await next.checkForUpdate()).toMatchObject({ phase: "idle" });
        expect(checks()[1]).toMatchObject({ ok: true, status: 304, cached: true, bytes: 0 });
        expect(electron.fetch).toHaveBeenCalledTimes(2);
    });

    it("tells the tray when an update is ready, and shows the steps on the way", async () => {
        const updater = await load();
        updater.initUpdater(true);
        const seen: string[] = [];
        const stop = updater.onUpdaterState((state) => {
            if (seen.at(-1) !== state.phase) seen.push(state.phase);
        });
        await updater.checkForUpdate();
        expect(seen).toEqual(["checking", "downloading", "verifying", "unpacking", "ready"]);
        expect(updater.getUpdaterState()).toMatchObject({ phase: "ready", latestVersion: NEW });
        expect(updater.getUpdaterState().log.map((line) => line.text)).toEqual([
            "Checking for updates…",
            `Found ${NEW}`,
            expect.stringMatching(/^Downloading 1\.12\.35-intercom\.6/),
            "Verifying checksum…",
            "Unpacking…",
            `${NEW} is ready: restart to update`,
        ]);

        // A second check does not fetch what is there
        const calls = electron.fetch.mock.calls.length;
        await updater.checkForUpdate(true);
        expect(electron.fetch).toHaveBeenCalledTimes(calls);

        await updater.installUpdate();
        expect(seen.at(-1)).toBe("installing");
        stop();
    });

    it("uses a download that is there already", async () => {
        const dir = path.join(tmp, "cache", "intercom-updates");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, ASSET), archive);
        const updater = await load();
        updater.initUpdater(true);
        expect((await updater.checkForUpdate()).phase).toBe("ready");
        expect(steps()).toContain("download_reused");
        expect(electron.fetch.mock.calls.some(([url]) => String(url).endsWith(`/${ASSET}`))).toBe(false);

        // One that is not whole is fetched again
        fs.rmSync(`${installDir}.new`, { recursive: true });
        fs.writeFileSync(path.join(dir, ASSET), archive.subarray(0, 10));
        const again = await load();
        again.initUpdater(true);
        expect((await again.checkForUpdate()).phase).toBe("ready");
        expect(electron.fetch.mock.calls.some(([url]) => String(url).endsWith(`/${ASSET}`))).toBe(true);
        expect(read(`${installDir}.new`)).toBe("new");
    });

    it.each([
        {
            why: "a build that is not packaged",
            set: (): void => void (electron.isPackaged = false),
            reason: "unpackaged",
        },
        {
            why: "a build without an InterCom version",
            set: (): void => void (electron.version = undefined),
            reason: "no-version",
        },
        { why: "--no-update", set: (): void => {}, allowed: false, reason: "disabled-by-flag" },
    ])("does nothing for $why", async ({ set, allowed = true, reason }) => {
        set();
        const updater = await load();
        updater.initUpdater(allowed);
        const state = await updater.checkForUpdate();
        expect(state).toMatchObject({ supported: false, reason });
        vi.advanceTimersByTime(24 * 60 * 60 * 1000);
        expect(electron.fetch).not.toHaveBeenCalled();
    });

    it("checks half a minute after the start and, with the frequent look off, every six hours, unless turned off", async () => {
        electron.version = NEW; // nothing to find: only the asking is counted
        const updater = await load();
        updater.initUpdater(true);
        expect((await ipc()({}, "setFastCheck", false)) as unknown).toMatchObject({ fastCheck: false });
        expect(electron.fetch).not.toHaveBeenCalled();
        // A check reads what it kept of the last one before it asks, which takes a moment
        const asked = (times: number): Promise<void> =>
            vi.waitFor(() => expect(electron.fetch).toHaveBeenCalledTimes(times));
        const idle = (): Promise<void> => vi.waitFor(() => expect(updater.getUpdaterState().phase).toBe("idle"));
        await vi.advanceTimersByTimeAsync(30_000);
        await asked(1);
        await idle();
        await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
        await asked(2);
        await idle();

        // Turned off: remembered for the next start, and no more checks
        expect((await ipc()({}, "setAutoCheck", false)).autoCheck).toBe(false);
        await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
        expect(electron.fetch).toHaveBeenCalledTimes(2);
        expect(JSON.parse(fs.readFileSync(path.join(electron.userData, "intercom-updater.json"), "utf8"))).toEqual({
            autoCheck: false,
            updateOnLaunch: true,
            fastCheck: false,
            showWhatsNew: true,
        });
        expect(electron.fetch.mock.calls.some(([url]) => url === FEED)).toBe(false);

        const next = await load();
        next.initUpdater(true);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(electron.fetch).toHaveBeenCalledTimes(2);
        // Asked for by hand it still checks
        await ipc()({}, "check");
        await asked(3);
    });
    it("keeps both switches in the profile, each as it was left", async () => {
        const updater = await load();
        updater.initUpdater(true);
        expect(updater.getUpdaterState()).toMatchObject({ autoCheck: true, updateOnLaunch: true });
        const settings = (): unknown =>
            JSON.parse(fs.readFileSync(path.join(electron.userData, "intercom-updater.json"), "utf8"));

        const handler = ipc() as unknown as (ev: unknown, action: string, arg?: unknown) => Promise<unknown>;
        expect(await handler({}, "setUpdateOnLaunch", false)).toMatchObject({ updateOnLaunch: false, autoCheck: true });
        const others = { fastCheck: true, showWhatsNew: true };
        expect(settings()).toEqual({ autoCheck: true, updateOnLaunch: false, ...others });
        await handler({}, "setAutoCheck", false);
        expect(settings()).toEqual({ autoCheck: false, updateOnLaunch: false, ...others });
        expect(await handler({}, "setShowWhatsNew", false)).toMatchObject({ showWhatsNew: false });
        expect(settings()).toEqual({ autoCheck: false, updateOnLaunch: false, fastCheck: true, showWhatsNew: false });

        const next = await load();
        next.initUpdater(true);
        expect(next.getUpdaterState()).toMatchObject({ autoCheck: false, updateOnLaunch: false });
        // A file from 1.12.35-intercom.6, which knew one switch
        fs.writeFileSync(path.join(electron.userData, "intercom-updater.json"), JSON.stringify({ autoCheck: true }));
        const later = await load();
        later.initUpdater(true);
        expect(later.getUpdaterState()).toMatchObject({ autoCheck: true, updateOnLaunch: true });
    });

    describe("looking every few minutes", () => {
        const MINUTE = 60_000;
        const checks = (): Array<Record<string, unknown>> => electron.records.filter((r) => r.type === "update_check");

        beforeEach(() => {
            // The clock too: what the focus asks for is counted in minutes since the last look
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
            electron.version = NEW; // nothing to find: only the asking is counted
        });

        it("asks the feed every five minutes and the API only when the feed changed", async () => {
            const updater = await load();
            updater.initUpdater(true);
            expect(updater.getUpdaterState()).toMatchObject({ fastCheck: true });
            await vi.advanceTimersByTimeAsync(30_000);
            await vi.waitFor(() => expect(asked(API)).toBe(1));
            expect(checks().at(-1)).toMatchObject({ reason: "startup", ok: true, status: 200 });

            // The first look takes up the feed's state and asks the API once more; then an hour of feed only
            await vi.advanceTimersByTimeAsync(65 * MINUTE);
            expect(asked(FEED)).toBe(13);
            expect(asked(API)).toBe(2);
            expect(checks().at(-1)).toEqual({
                type: "update_check",
                probe: true,
                reason: "interval",
                ok: true,
                ms: expect.any(Number),
                status: 304,
                changed: false,
            });

            // A release is published: the next look asks the API
            feedEtag = 'W/"feed-2"';
            await vi.advanceTimersByTimeAsync(5 * MINUTE);
            await vi.waitFor(() => expect(asked(API)).toBe(3));
            expect(checks().at(-2)).toMatchObject({ probe: true, status: 200, changed: true });
            expect(checks().at(-1)).toMatchObject({ reason: "interval", ok: true, manual: false });
        });

        it("looks when the window gets the focus, the computer wakes up or the network is back, once a minute at most", async () => {
            const updater = await load();
            updater.initUpdater(true);
            await vi.advanceTimersByTimeAsync(30_000);
            await vi.waitFor(() => expect(asked(API)).toBe(1));
            await vi.waitFor(() => expect(updater.getUpdaterState().phase).toBe("idle"));
            const focus = electron.appOn.mock.calls.find(([event]) => event === "browser-window-focus")![1];
            const resume = electron.powerOn.mock.calls.find(([event]) => event === "resume")![1];
            expect(electron.powerOn.mock.calls.map(([event]) => event)).toEqual(["resume", "unlock-screen"]);

            // Right after a check: nothing
            focus();
            await vi.advanceTimersByTimeAsync(10_000);
            expect(asked(FEED)).toBe(0);

            await vi.advanceTimersByTimeAsync(MINUTE);
            focus();
            resume();
            await ipc()({}, "online");
            await vi.advanceTimersByTimeAsync(3000);
            expect(asked(FEED)).toBe(1);
            expect(checks().find((r) => r.probe)).toMatchObject({ reason: "focus" });
            expect(steps().filter((step) => step === "check_triggered")).toHaveLength(1);

            // With the frequent look off, none of them asks
            await ipc()({}, "setFastCheck", false);
            await vi.advanceTimersByTimeAsync(2 * MINUTE);
            focus();
            resume();
            await vi.advanceTimersByTimeAsync(3000);
            expect(asked(FEED)).toBe(1);
        });

        it("leaves GitHub alone until the limit is lifted when it refuses for too many requests", async () => {
            const updater = await load();
            updater.initUpdater(true);
            const reset = Math.floor(Date.now() / 1000) + 40 * 60;
            electron.fetch.mockImplementation(async (url: string) =>
                url.startsWith(API)
                    ? new Response("limit", {
                          status: 403,
                          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) },
                      })
                    : new Response("<feed/>", { headers: { etag: feedEtag } }),
            );
            await vi.advanceTimersByTimeAsync(30_000);
            await vi.waitFor(() => expect(asked(API)).toBe(1));
            // Nobody asked for the check: no error is shown
            await vi.waitFor(() => expect(updater.getUpdaterState().phase).toBe("idle"));
            expect(checks().at(-1)).toMatchObject({ ok: false, status: 403, rateLimitedForMs: expect.any(Number) });

            await vi.advanceTimersByTimeAsync(39 * MINUTE);
            expect(electron.fetch).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(2 * MINUTE);
            await vi.waitFor(() => expect(asked(API)).toBe(2));

            // Asked for by hand, the refusal is said, with when to come back
            electron.fetch.mockImplementation(
                async () => new Response("limit", { status: 429, headers: { "retry-after": "600" } }),
            );
            await updater.checkForUpdate(true);
            expect(updater.getUpdaterState()).toMatchObject({
                phase: "error",
                error: "GitHub: HTTP 429 (too many requests, try again in 10 min)",
            });
        });
    });

    describe("the update button", () => {
        it("installs and restarts at once when the update is ready", async () => {
            const updater = await load();
            updater.initUpdater(true);
            await updater.checkForUpdate();
            expect(updater.getUpdaterState()).toMatchObject({ phase: "ready", installWhenReady: false });
            expect(electron.quit).not.toHaveBeenCalled();

            await ipc()({}, "update");
            expect(read(installDir)).toBe("new");
            expect(electron.relaunch).toHaveBeenCalledTimes(1);
            expect(electron.quit).toHaveBeenCalledTimes(1);
        });

        it("installs and restarts by itself once a download that is under way is checked", async () => {
            const updater = await load();
            updater.initUpdater(true);
            // The download waits until it is let go
            let release!: () => void;
            const held = new Promise<void>((resolve) => (release = resolve));
            const respond = electron.fetch.getMockImplementation()!;
            electron.fetch.mockImplementation(async (url: string, init: unknown) => {
                if (url.endsWith(`/${ASSET}`)) await held;
                return respond(url, init);
            });
            const check = updater.checkForUpdate();
            await vi.waitFor(() => expect(updater.getUpdaterState().phase).toBe("downloading"));

            expect(await ipc()({}, "update")).toMatchObject({ phase: "downloading", installWhenReady: true });
            expect(electron.send).toHaveBeenLastCalledWith(
                "intercomUpdater",
                expect.objectContaining({ installWhenReady: true }),
            );
            // A second click changes nothing, and nothing is installed before the file is checked
            await ipc()({}, "update");
            expect(electron.quit).not.toHaveBeenCalled();
            expect(read(installDir)).toBe("old");

            release();
            await check;
            expect(read(installDir)).toBe("new");
            expect(electron.relaunch).toHaveBeenCalledTimes(1);
            expect(electron.quit).toHaveBeenCalledTimes(1);
            expect(steps()).toEqual([
                "init",
                "check",
                "update_found",
                "download_start",
                "install_when_ready",
                "install_when_ready",
                "download_verified",
                "staged",
                "ready",
                "install_linux",
            ]);
        });

        it("starts the download when there is none, and installs when it is there", async () => {
            const updater = await load();
            updater.initUpdater(true);
            expect(updater.getUpdaterState().phase).toBe("idle");
            await ipc()({}, "update");
            await vi.waitFor(() => expect(electron.quit).toHaveBeenCalledTimes(1));
            expect(read(installDir)).toBe("new");
            expect(electron.records.find((r) => r.type === "update_check")).toMatchObject({ reason: "click" });
        });

        it("does not install later what failed to download, and opens the page of a release it cannot install", async () => {
            const updater = await load();
            updater.initUpdater(true);
            sums = `${"0".repeat(64)}  ${ASSET}\n`;
            await ipc()({}, "update");
            await vi.waitFor(() => expect(updater.getUpdaterState().phase).toBe("error"));
            expect(updater.getUpdaterState().installWhenReady).toBe(false);
            expect(electron.quit).not.toHaveBeenCalled();

            // An install that is not the user's to replace
            process.env.APPIMAGE = "/somewhere/InterCom.AppImage";
            await updater.checkForUpdate(true);
            expect(updater.getUpdaterState().phase).toBe("manual");
            await ipc()({}, "update");
            expect(electron.openExternal).toHaveBeenCalledWith(`${RELEASES}/tag/v${NEW}`);
            expect(updater.getUpdaterState()).toMatchObject({ phase: "manual", installWhenReady: false });
            expect(electron.quit).not.toHaveBeenCalled();
        });
    });

    describe("release notes", () => {
        type Notes = { pending: Array<{ version: string; body: string }>; whatsNew: Array<{ version: string }> };
        const notes = async (): Promise<Notes> => (await ipc()({}, "getNotes")) as unknown as Notes;
        const settings = (): Record<string, unknown> =>
            JSON.parse(fs.readFileSync(path.join(electron.userData, "intercom-updater.json"), "utf8"));
        const note = (n: number): Record<string, unknown> => ({
            tag_name: `v1.12.35-intercom.${n}`,
            html_url: `${RELEASES}/tag/v1.12.35-intercom.${n}`,
            body: `- Notes of .${n}`,
            assets: [],
        });

        it("gives the notes of every release between the running one and the offered one", async () => {
            const offered = { ...(releases as Array<Record<string, unknown>>)[1], body: "- Notes of .6" };
            releases = [offered, note(5), note(4)];
            const updater = await load();
            updater.initUpdater(true);
            expect((await notes()).pending).toEqual([]);
            await updater.checkForUpdate();
            expect((await notes()).pending).toEqual([
                { version: NEW, body: "- Notes of .6", url: `${RELEASES}/tag/v${NEW}` },
            ]);
        });

        it("shows what is new once after an update, from what the last check kept", async () => {
            // The profile of an older InterCom, and the answer its check kept, with the notes
            fs.writeFileSync(
                path.join(electron.userData, "intercom-updater.json"),
                JSON.stringify({ lastSeenVersion: "1.12.35-intercom.3" }),
            );
            fs.writeFileSync(
                path.join(electron.userData, "intercom-updater-releases.json"),
                JSON.stringify({
                    url: `${API}?per_page=5`,
                    etag: 'W/"x"',
                    notes: true,
                    releases: [note(5), note(4), note(3)],
                }),
            );
            electron.fetch.mockRejectedValue(new Error("offline"));
            const updater = await load();
            updater.initUpdater(true);
            expect((await notes()).whatsNew.map((n) => n.version)).toEqual([
                "1.12.35-intercom.5",
                "1.12.35-intercom.4",
            ]);
            // Not seen yet: asked again, shown again
            expect((await notes()).whatsNew).toHaveLength(2);

            await ipc()({}, "whatsNewSeen");
            expect(settings().lastSeenVersion).toBe("1.12.35-intercom.5");
            expect((await notes()).whatsNew).toEqual([]);
            const next = await load();
            next.initUpdater(true);
            expect((await notes()).whatsNew).toEqual([]);
        });

        it("shows nothing on a first install or with the setting off, and remembers the release", async () => {
            releases = [note(5)];
            const updater = await load();
            updater.initUpdater(true);
            await updater.checkForUpdate();
            expect((await notes()).whatsNew).toEqual([]);
            expect(settings().lastSeenVersion).toBe("1.12.35-intercom.5");

            // Updated later, with the setting off
            await ipc()({}, "setShowWhatsNew", false);
            electron.version = NEW;
            releases = [note(6), note(5)];
            const next = await load();
            next.initUpdater(true);
            await next.checkForUpdate();
            expect((await notes()).whatsNew).toEqual([]);
            expect(settings()).toMatchObject({ lastSeenVersion: NEW, showWhatsNew: false });
        });
    });

    it("gives a check as little time as it is told to, and says that it ran out", async () => {
        vi.useRealTimers();
        const updater = await load();
        updater.initUpdater(true);
        // GitHub answers when the request is given up, not before
        electron.fetch.mockImplementation(
            (_url: string, init: { signal?: AbortSignal }) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
                }),
        );
        const started = Date.now();
        await updater.checkForUpdate(false, 50);
        expect(Date.now() - started).toBeLessThan(2000);
        expect(updater.getUpdaterState().phase).toBe("idle");
        expect(updater.getLastCheckFailure()).toBe("timeout");

        // A check that fails otherwise, and one that gets its answer
        electron.fetch.mockResolvedValue(new Response("no", { status: 500 }));
        await updater.checkForUpdate(false, 50);
        expect(updater.getLastCheckFailure()).toBe("failed");
        electron.fetch.mockResolvedValue(new Response("[]"));
        await updater.checkForUpdate(false, 50);
        expect(updater.getLastCheckFailure()).toBeUndefined();
    });
});
