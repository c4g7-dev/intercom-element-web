/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Updating when the app starts: before the window opens, the updater (intercom-updater.ts) is
 * asked to look for a newer release, with little time for GitHub to answer. If there is one, it
 * is downloaded, checked and put in place as "Restart to update" would, and the app starts again
 * as the new release, with no click. A small window says what is going on; a start with
 * `--hidden` does the same without it.
 *
 * A start that finds nothing is held for a moment only, and one that cannot get the release
 * (offline, slow, a failed check) goes on as the release it is: the updater is left to carry on
 * in the background and offers what it gets in the app. What decides is in
 * intercom-update-on-launch-core.ts; every start writes one `update_on_launch` record to the
 * diagnostics log.
 */

import { app, BrowserWindow } from "electron";
import fsp from "node:fs/promises";
import path from "node:path";

import { getBrand } from "./build-config.js";
import { logDiagnostics } from "./intercom-diagnostics.js";
import {
    type LaunchGuard,
    type LaunchProgress,
    type LaunchStep,
    launchSkipReason,
    nextLaunchStep,
    parseLaunchGuard,
    settleLaunchGuard,
    splashHtml,
    type SplashStatus,
    splashStatusFor,
    splashUpdateScript,
    LAUNCH_CHECK_TIMEOUT_MS,
} from "./intercom-update-on-launch-core.js";
import {
    canInstallItself,
    checkForUpdate,
    getLastCheckFailure,
    getUpdaterState,
    installUpdate,
    onUpdaterState,
} from "./intercom-updater.js";
import { _t } from "./language-helper.js";

/** How often the start looks at the clock while it waits for the updater. */
const TICK_MS = 100;
/** How long the small window may outlive the decision to start, should the main window never say it is ready. */
const SPLASH_FAILSAFE_MS = 20 * 1000;

let splash: BrowserWindow | undefined;

function guardFile(): string {
    return path.join(app.getPath("userData"), "intercom-update-on-launch.json");
}

async function readGuard(): Promise<LaunchGuard> {
    try {
        return parseLaunchGuard(JSON.parse(await fsp.readFile(guardFile(), "utf8")));
    } catch {
        return {};
    }
}

async function writeGuard(guard: LaunchGuard): Promise<void> {
    // A profile that cannot be written to costs the guard its memory, not the start
    await fsp.writeFile(guardFile(), JSON.stringify(guard)).catch(() => {});
}

function statusText(status: SplashStatus): string {
    switch (status.kind) {
        case "checking":
            return _t("update_on_launch|checking");
        case "downloading":
            return status.percent === undefined
                ? _t("update_on_launch|downloading")
                : // The sign goes in with the number: the string format has no way to write a bare "%"
                  _t("update_on_launch|downloading_percent", { percent: `${status.percent} %` });
        case "installing":
            return _t("update_on_launch|installing");
        case "starting":
            return _t("update_on_launch|starting");
    }
}

function showSplash(): void {
    const window = new BrowserWindow({
        width: 300,
        height: 190,
        center: true,
        frame: false,
        transparent: true,
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        show: false,
        title: getBrand(),
        backgroundColor: "#00000000",
        webPreferences: {
            // The page is a string of this app's own: it loads nothing and is given nothing
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            javascript: true,
            webSecurity: true,
            spellcheck: false,
        },
    });
    splash = window;
    window.setMenuBarVisibility(false);
    window.webContents.on("will-navigate", (ev) => ev.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => {
        if (splash === window) splash = undefined;
    });
    const html = splashHtml(getBrand(), statusText({ kind: "checking" }));
    void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function setSplash(status: SplashStatus): void {
    const window = splash;
    if (!window || window.isDestroyed()) return;
    const percent = status.kind === "downloading" ? status.percent : undefined;
    window.webContents.executeJavaScript(splashUpdateScript(statusText(status), percent)).catch(() => {});
}

/**
 * Closes the small window of the start. For the main window to call once it is ready to be
 * shown: closing it earlier would leave the app without any window, which ends it.
 */
export function closeLaunchSplash(): void {
    const window = splash;
    splash = undefined;
    if (window && !window.isDestroyed()) window.destroy();
}

/**
 * Waits for the updater until the start knows what to do.
 * @param seenWork - whether the updater has taken the check up: an updater that is idle has then ended it
 */
async function waitForStep(guard: LaunchGuard, started: number, seenWork: boolean): Promise<LaunchStep> {
    let lastChange = Date.now();
    let lastStatus = "";
    return new Promise((resolve) => {
        const look = (): void => {
            const state = getUpdaterState();
            if (state.phase !== "idle") seenWork = true;
            const progress: LaunchProgress = {
                phase: state.phase,
                latestVersion: state.latestVersion,
                progress: state.progress,
                checkFailure: getLastCheckFailure(),
            };
            const status = splashStatusFor(progress);
            const key = JSON.stringify(status);
            if (key !== lastStatus) {
                lastStatus = key;
                setSplash(status);
            }
            const step = nextLaunchStep(progress, { now: Date.now(), started, lastChange }, guard, seenWork);
            if (step.action === "wait") return;
            clearInterval(timer);
            stop();
            resolve(step);
        };
        const stop = onUpdaterState(() => {
            lastChange = Date.now();
            look();
        });
        const timer = setInterval(look, TICK_MS);
        look();
    });
}

/**
 * Looks for a newer release before the window opens and, if there is one, installs it and
 * starts the app again. Call once the app is ready, the diagnostics log is open and the updater
 * is started, and before the main window is made.
 * @param options.allowed - false when the app was started with `--no-update`
 * @param options.hidden - whether the app was started with `--hidden`: nothing is shown then
 * @returns true if the app is about to quit for the new release: the caller then opens no window
 */
export async function updateOnLaunch(options: { allowed: boolean; hidden: boolean }): Promise<boolean> {
    const started = Date.now();
    const state = getUpdaterState();
    const current = state.currentVersion;

    // First what became of the install the last start began, if it began one
    const settled = settleLaunchGuard(await readGuard(), current);
    const guard = settled.guard;
    if (settled.outcome !== "none") await writeGuard(guard);

    const record = (decision: "skip" | "start" | "install", reason: string, target?: string): void => {
        const fields = {
            decision,
            reason,
            current: current ?? null,
            target: target ?? null,
            ms: Date.now() - started,
            hidden: options.hidden,
            lastAttempt: settled.outcome,
            blocked: guard.failed ?? null,
        };
        console.log("[update-on-launch]", JSON.stringify(fields));
        logDiagnostics("update_on_launch", fields);
    };

    const packaged = app.isPackaged;
    const skip = launchSkipReason({
        packaged,
        currentVersion: current,
        allowedByFlag: options.allowed,
        platform: process.platform,
        updateOnLaunch: state.updateOnLaunch,
        autoCheck: state.autoCheck,
        // Only asked of the file system where everything else says yes
        replaceable: packaged && state.supported && state.updateOnLaunch ? await canInstallItself() : true,
    });
    if (skip || !state.supported) {
        record("skip", skip ?? state.reason ?? "unsupported");
        return false;
    }

    if (!options.hidden) showSplash();
    void checkForUpdate(false, LAUNCH_CHECK_TIMEOUT_MS, "launch");
    // The updater says "checking" before it asks anything, so a check that ends at once is not missed
    const step = await waitForStep(guard, started, getUpdaterState().phase !== "idle");

    if (step.action === "install") {
        setSplash({ kind: "installing" });
        // Written before the install: the next start judges by it whether the release took
        await writeGuard({ ...guard, attempt: { from: current!, to: step.version, at: Date.now() } });
        await installUpdate();
        if (getUpdaterState().phase !== "error") {
            record("install", "ready", step.version);
            return true;
        }
        // Nothing was replaced: this release is left to the updater in the app from here on
        guard.failed = step.version;
        await writeGuard(guard);
        record("start", "install-failed", step.version);
    } else if (step.action === "start") {
        record("start", step.reason, step.version);
    }

    setSplash({ kind: "starting" });
    setTimeout(() => {
        // Without a main window the small one is the app's only one, and is kept
        if (global.mainWindow) closeLaunchSplash();
    }, SPLASH_FAILSAFE_MS).unref();
    return false;
}
