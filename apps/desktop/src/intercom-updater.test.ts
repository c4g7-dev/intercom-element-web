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
    },
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
const NEW = "1.12.35-intercom.6";
const ASSET = `InterCom-${NEW}-linux-x64.tar.gz`;

// The updater is for Linux and Windows; what is tested here is the Linux half
describe.runIf(process.platform === "linux")("the updater, from the check to the restart", () => {
    let tmp: string;
    let installDir: string;
    let archive: Buffer;
    let sums: string;
    let releases: unknown;
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
        vi.useFakeTimers({ toFake: ["setTimeout", "setInterval", "clearInterval"] });
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "intercom-updater-e2e-"));
        electron.userData = path.join(tmp, "profile");
        fs.mkdirSync(electron.userData);
        electron.isPackaged = true;
        electron.version = "1.12.35-intercom.5";
        electron.records.length = 0;
        for (const mock of [electron.relaunch, electron.quit, electron.handle, electron.openExternal, electron.send]) {
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
        electron.fetch.mockReset();
        electron.fetch.mockImplementation(async (url: string) => {
            if (url.startsWith("https://api.github.com/repos/c4g7-dev/InterCom/releases")) {
                return new Response(JSON.stringify(releases));
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

        electron.fetch.mockResolvedValue(new Response("rate limited", { status: 403 }));
        updater = await load();
        updater.initUpdater(true);
        expect(await updater.checkForUpdate()).toMatchObject({ phase: "error", error: "GitHub: HTTP 403" });
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

    it("checks half a minute after the start and every six hours, unless turned off", async () => {
        electron.version = NEW; // nothing to find: only the asking is counted
        const updater = await load();
        updater.initUpdater(true);
        expect(electron.fetch).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(electron.fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000);
        expect(electron.fetch).toHaveBeenCalledTimes(2);

        // Turned off: remembered for the next start, and no more checks
        expect((await ipc()({}, "setAutoCheck", false)).autoCheck).toBe(false);
        await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
        expect(electron.fetch).toHaveBeenCalledTimes(2);
        expect(JSON.parse(fs.readFileSync(path.join(electron.userData, "intercom-updater.json"), "utf8"))).toEqual({
            autoCheck: false,
        });

        const next = await load();
        next.initUpdater(true);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(electron.fetch).toHaveBeenCalledTimes(2);
        // Asked for by hand it still checks
        await ipc()({}, "check");
        await vi.advanceTimersByTimeAsync(0);
        expect(electron.fetch).toHaveBeenCalledTimes(3);
    });
});
