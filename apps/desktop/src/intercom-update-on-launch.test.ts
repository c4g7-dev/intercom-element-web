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
    version: "1.12.35-intercom.6" as string | undefined,
    records: [] as Array<Record<string, unknown>>,
    /** The small windows that were opened, with what they were told to show */
    windows: [] as Array<{ options: Record<string, unknown>; url: string; scripts: string[]; destroyed: boolean }>,
}));

vi.mock("electron", () => {
    class BrowserWindow {
        private readonly record: (typeof electron.windows)[number];
        public webContents = {
            on: vi.fn(),
            setWindowOpenHandler: vi.fn(),
            executeJavaScript: (script: string): Promise<void> => {
                this.record.scripts.push(script);
                return Promise.resolve();
            },
        };
        public constructor(options: Record<string, unknown>) {
            this.record = { options, url: "", scripts: [], destroyed: false };
            electron.windows.push(this.record);
        }
        public setMenuBarVisibility = vi.fn();
        public once = vi.fn();
        public on = vi.fn();
        public show = vi.fn();
        public loadURL = (url: string): Promise<void> => {
            this.record.url = url;
            return Promise.resolve();
        };
        public isDestroyed = (): boolean => this.record.destroyed;
        public destroy = (): void => {
            this.record.destroyed = true;
        };
    }
    return {
        app: {
            get isPackaged(): boolean {
                return electron.isPackaged;
            },
            getPath: (): string => electron.userData,
            relaunch: electron.relaunch,
            quit: electron.quit,
            on: vi.fn(),
        },
        powerMonitor: { on: vi.fn() },
        BrowserWindow,
        ipcMain: { handle: electron.handle },
        net: { fetch: electron.fetch },
        shell: { openExternal: vi.fn() },
    };
});
vi.mock("./build-config.js", () => ({
    getIntercomVersion: (): string | undefined => electron.version,
    getBrand: (): string => "Lattice",
}));
vi.mock("./intercom-diagnostics.js", () => ({
    logDiagnostics: (type: string, fields: Record<string, unknown>): void => {
        electron.records.push({ type, ...fields });
    },
}));
// The key and its numbers stand for the line, which is the translations' business
vi.mock("./language-helper.js", () => ({
    _t: (key: string, variables?: { percent?: string }): string =>
        variables?.percent === undefined ? key : `${key} ${variables.percent}`,
}));

const RELEASES = "https://github.com/c4g7-dev/InterCom/releases";
const CURRENT = "1.12.35-intercom.6";
const NEW = "1.12.35-intercom.7";
const ASSET = `InterCom-${NEW}-linux-x64.tar.gz`;

// What a start does on Linux: the directory swap is the real one, in a directory of the test's own
describe.runIf(process.platform === "linux")("updating when the app starts", () => {
    let tmp: string;
    let installDir: string;
    let archive: Buffer;
    let releases: unknown[];
    const realExecPath = process.execPath;
    const realArgv = process.argv;
    const realEnv = { ...process.env };

    async function load(): Promise<{
        launch: typeof import("./intercom-update-on-launch.js");
        updater: typeof import("./intercom-updater.js");
    }> {
        vi.resetModules();
        const updater = await import("./intercom-updater.js");
        const launch = await import("./intercom-update-on-launch.js");
        return { launch, updater };
    }

    const guardFile = (): string => path.join(electron.userData, "intercom-update-on-launch.json");
    const guard = (): unknown => JSON.parse(fs.readFileSync(guardFile(), "utf8"));
    const record = (): Record<string, unknown> | undefined =>
        electron.records.find((r) => r.type === "update_on_launch");
    const read = (dir: string): string => fs.readFileSync(path.join(dir, "intercom"), "utf8");

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "intercom-launch-"));
        electron.userData = path.join(tmp, "profile");
        fs.mkdirSync(electron.userData);
        electron.isPackaged = true;
        electron.version = CURRENT;
        electron.records.length = 0;
        electron.windows.length = 0;
        for (const mock of [electron.relaunch, electron.quit, electron.handle]) mock.mockReset();

        installDir = path.join(tmp, "opt", "intercom");
        fs.mkdirSync(path.join(installDir, "resources"), { recursive: true });
        fs.writeFileSync(path.join(installDir, "intercom"), "old", { mode: 0o755 });
        fs.writeFileSync(path.join(installDir, "resources", "app.asar"), "old");
        Object.defineProperty(process, "execPath", { value: path.join(installDir, "intercom"), configurable: true });
        process.argv = [process.execPath, "--hidden"];
        process.env.XDG_CACHE_HOME = path.join(tmp, "cache");
        delete process.env.APPIMAGE;
        delete process.env.INTERCOM_LAUNCHER;
        delete process.env.INTERCOM_LAUNCHER_ARGS;

        const staging = path.join(tmp, "build", "intercom-1.12.35");
        fs.mkdirSync(path.join(staging, "resources"), { recursive: true });
        fs.writeFileSync(path.join(staging, "intercom"), "new", { mode: 0o755 });
        fs.writeFileSync(path.join(staging, "resources", "app.asar"), "new");
        const archivePath = path.join(tmp, "build", ASSET);
        execFileSync("tar", ["-czf", archivePath, "-C", path.join(tmp, "build"), "intercom-1.12.35"]);
        archive = fs.readFileSync(archivePath);
        const sums = `${crypto.createHash("sha256").update(archive).digest("hex")}  ${ASSET}\n`;
        releases = [
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
            if (url.startsWith("https://api.github.com/")) return new Response(JSON.stringify(releases));
            if (url.endsWith("/SHA256SUMS")) return new Response(sums);
            if (url.endsWith(`/${ASSET}`)) {
                return new Response(new Uint8Array(archive), { headers: { "content-length": String(archive.length) } });
            }
            return new Response("not found", { status: 404 });
        });
        (global as unknown as { mainWindow: unknown }).mainWindow = undefined;
    });

    afterEach(() => {
        Object.defineProperty(process, "execPath", { value: realExecPath, configurable: true });
        process.argv = realArgv;
        process.env = { ...realEnv };
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("installs a newer release before any window of the app opens, and starts again", async () => {
        const { launch, updater } = await load();
        updater.initUpdater(true);

        expect(await launch.updateOnLaunch({ allowed: true, hidden: false })).toBe(true);

        // The new release is in place, the old one kept beside it, and the app starts again as it was started
        expect(read(installDir)).toBe("new");
        expect(read(`${installDir}.old`)).toBe("old");
        expect(electron.relaunch).toHaveBeenCalledWith({ execPath: process.execPath, args: ["--hidden"] });
        expect(electron.quit).toHaveBeenCalledTimes(1);
        // What the next start judges the install by
        expect(guard()).toMatchObject({ attempt: { from: CURRENT, to: NEW } });
        expect(record()).toMatchObject({
            decision: "install",
            reason: "ready",
            current: CURRENT,
            target: NEW,
            hidden: false,
            lastAttempt: "none",
        });
        expect(typeof record()!.ms).toBe("number");

        // The small window: a page of the app's own, told what goes on, and left open for the quit
        expect(electron.windows).toHaveLength(1);
        const [window] = electron.windows;
        expect(window.options).toMatchObject({ frame: false, transparent: true, show: false });
        expect(window.options.webPreferences).toMatchObject({
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
        });
        expect(window.url.startsWith("data:text/html;charset=utf-8,")).toBe(true);
        expect(decodeURIComponent(window.url)).toContain("update_on_launch|checking");
        expect(window.scripts.some((s) => s.includes("update_on_launch|installing"))).toBe(true);
        expect(window.destroyed).toBe(false);
    });

    it("does the same without a window when started hidden", async () => {
        const { launch, updater } = await load();
        updater.initUpdater(true);
        expect(await launch.updateOnLaunch({ allowed: true, hidden: true })).toBe(true);
        expect(read(installDir)).toBe("new");
        expect(electron.windows).toHaveLength(0);
        expect(record()).toMatchObject({ decision: "install", hidden: true });
    });

    it("starts the app as it is when there is nothing newer, and keeps the small window for the main one", async () => {
        releases = [];
        const { launch, updater } = await load();
        updater.initUpdater(true);
        const started = Date.now();
        expect(await launch.updateOnLaunch({ allowed: true, hidden: false })).toBe(false);
        expect(Date.now() - started).toBeLessThan(3000);
        expect(read(installDir)).toBe("old");
        expect(electron.quit).not.toHaveBeenCalled();
        expect(record()).toMatchObject({ decision: "start", reason: "up-to-date", target: null });
        expect(fs.existsSync(guardFile())).toBe(false);

        const [window] = electron.windows;
        expect(window.scripts.at(-1)).toContain("update_on_launch|starting");
        // Closing it before the main window is there would end the app
        expect(window.destroyed).toBe(false);
        launch.closeLaunchSplash();
        expect(window.destroyed).toBe(true);
        launch.closeLaunchSplash();
    });

    it("starts the app as it is when GitHub does not answer", async () => {
        electron.fetch.mockRejectedValue(new Error("net::ERR_INTERNET_DISCONNECTED"));
        const { launch, updater } = await load();
        updater.initUpdater(true);
        expect(await launch.updateOnLaunch({ allowed: true, hidden: true })).toBe(false);
        expect(record()).toMatchObject({ decision: "start", reason: "check-failed" });
    });

    it("starts the app as it is when the download does not match its checksum", async () => {
        archive = Buffer.concat([archive, Buffer.from("x")]);
        const { launch, updater } = await load();
        updater.initUpdater(true);
        expect(await launch.updateOnLaunch({ allowed: true, hidden: true })).toBe(false);
        expect(read(installDir)).toBe("old");
        expect(record()).toMatchObject({ decision: "start", reason: "error", target: NEW });
        expect(electron.quit).not.toHaveBeenCalled();
    });

    it.each([
        ["the setting is off", { updateOnLaunch: false }, true, "setting-off"],
        ["the automatic check is off", { autoCheck: false }, true, "auto-check-off"],
        ["it was started with --no-update", {}, false, "disabled-by-flag"],
    ])("asks nothing of GitHub when %s", async (_what, settings, allowed, reason) => {
        fs.writeFileSync(path.join(electron.userData, "intercom-updater.json"), JSON.stringify(settings));
        const { launch, updater } = await load();
        updater.initUpdater(allowed);
        expect(await launch.updateOnLaunch({ allowed, hidden: false })).toBe(false);
        expect(electron.fetch).not.toHaveBeenCalled();
        expect(electron.windows).toHaveLength(0);
        expect(record()).toMatchObject({ decision: "skip", reason });
    });

    it("asks nothing of GitHub for a build that is not a release, or an install it cannot replace", async () => {
        electron.version = undefined;
        let loaded = await load();
        loaded.updater.initUpdater(true);
        expect(await loaded.launch.updateOnLaunch({ allowed: true, hidden: false })).toBe(false);
        expect(record()).toMatchObject({ decision: "skip", reason: "no-version" });

        electron.version = CURRENT;
        electron.records.length = 0;
        process.env.APPIMAGE = "/tmp/InterCom.AppImage";
        loaded = await load();
        loaded.updater.initUpdater(true);
        expect(await loaded.launch.updateOnLaunch({ allowed: true, hidden: false })).toBe(false);
        expect(record()).toMatchObject({ decision: "skip", reason: "not-writable" });
        expect(electron.fetch).not.toHaveBeenCalled();
    });

    it("does not try a release again that did not take the last time, and leaves it to the app", async () => {
        // The last start began to install the release, and the old one is what runs again
        fs.writeFileSync(guardFile(), JSON.stringify({ attempt: { from: CURRENT, to: NEW, at: 1 } }));
        const { launch, updater } = await load();
        updater.initUpdater(true);
        expect(await launch.updateOnLaunch({ allowed: true, hidden: true })).toBe(false);
        expect(read(installDir)).toBe("old");
        expect(electron.quit).not.toHaveBeenCalled();
        expect(guard()).toEqual({ failed: NEW });
        expect(record()).toMatchObject({
            decision: "start",
            reason: "failed-before",
            target: NEW,
            lastAttempt: "failed",
            blocked: NEW,
        });
        // The updater goes on: the release is offered in the app, behind a click
        await vi.waitFor(() => expect(updater.getUpdaterState().phase).toBe("ready"));
    });

    it("forgets the attempt once the release runs", async () => {
        fs.writeFileSync(guardFile(), JSON.stringify({ attempt: { from: CURRENT, to: NEW, at: 1 } }));
        electron.version = NEW;
        releases = [];
        const { launch, updater } = await load();
        updater.initUpdater(true);
        expect(await launch.updateOnLaunch({ allowed: true, hidden: true })).toBe(false);
        expect(guard()).toEqual({});
        expect(record()).toMatchObject({ decision: "start", reason: "up-to-date", lastAttempt: "installed" });
    });

    it("starts the app as it is when the release cannot be put in place, and does not try it again", async () => {
        const { launch, updater } = await load();
        updater.initUpdater(true);
        // The parent directory turns read-only once the release is unpacked: the swap then fails
        const stop = updater.onUpdaterState((state) => {
            if (state.phase === "ready") fs.chmodSync(path.dirname(installDir), 0o555);
        });
        try {
            expect(await launch.updateOnLaunch({ allowed: true, hidden: true })).toBe(false);
        } finally {
            stop();
            fs.chmodSync(path.dirname(installDir), 0o755);
        }
        expect(read(installDir)).toBe("old");
        expect(electron.quit).not.toHaveBeenCalled();
        expect(guard()).toEqual({ failed: NEW });
        expect(record()).toMatchObject({ decision: "start", reason: "install-failed", target: NEW });
    });
});
