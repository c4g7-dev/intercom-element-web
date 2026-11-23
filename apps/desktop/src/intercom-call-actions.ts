/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Call actions from outside the window: mute, deafen, camera, leave.
 *
 * Wayland compositors give an application no global shortcuts of its own, so the actions are
 * command line switches. `intercom --toggle-mute` started while InterCom runs is a second
 * instance: it hands its command line to the running one (Electron's `second-instance`) and exits
 * without ever opening a window. The running instance passes the action to the web app, which
 * passes it to the call. Bind the commands in the compositor, e.g. in Hyprland:
 *   bind = SUPER, M, exec, /path/to/run-intercom.sh --toggle-mute
 *
 * On Windows the two usual shortcuts are registered globally while a call is on. On Linux the
 * same can be asked of the XDG GlobalShortcuts portal with --global-shortcuts-portal.
 */

import { app, globalShortcut, ipcMain } from "electron";

import { logDiagnostics } from "./intercom-diagnostics.js";

/** The actions and the switch each is asked for with. */
const ACTION_SWITCHES = {
    "--toggle-mute": "toggle-mute",
    "--toggle-deafen": "toggle-deafen",
    "--toggle-camera": "toggle-camera",
    "--mute": "mute",
    "--unmute": "unmute",
    "--leave-call": "leave-call",
} as const;

export type CallAction = (typeof ACTION_SWITCHES)[keyof typeof ACTION_SWITCHES];

/** The IPC channel on which the web app is sent an action. */
export const CALL_ACTION_CHANNEL = "intercomCallAction";

/** The global shortcuts (Windows; Linux through the portal on request) and what each does. */
export const GLOBAL_SHORTCUTS: Record<string, CallAction> = {
    "CommandOrControl+Shift+M": "toggle-mute",
    "CommandOrControl+Shift+D": "toggle-deafen",
};

/**
 * The call action a command line asks for, if it asks for one: the first argument that is exactly
 * one of the switches. Anything else on the command line (other switches, paths, URLs, things that
 * merely contain a switch) is not looked at.
 */
export function parseCallAction(argv: readonly unknown[]): CallAction | undefined {
    if (!Array.isArray(argv)) return undefined;
    for (const arg of argv) {
        if (typeof arg === "string" && Object.hasOwn(ACTION_SWITCHES, arg)) {
            return ACTION_SWITCHES[arg as keyof typeof ACTION_SWITCHES];
        }
    }
    return undefined;
}

/** Pass an action on to the web app, which knows the call. */
export function sendCallAction(action: CallAction, source: string): boolean {
    const webContents = global.mainWindow?.webContents;
    const delivered = !!webContents && !webContents.isDestroyed();
    // The source goes along: the web app's diagnostics say where a change of mute or deafen came from
    if (delivered) webContents.send(CALL_ACTION_CHANNEL, action, source);
    logDiagnostics("call_action", { action, source, delivered });
    return delivered;
}

/**
 * Handle the command line of a second instance.
 * @returns whether it was a call action, in which case the window is left as it is
 */
export function handleSecondInstanceCallAction(commandLine: readonly unknown[]): boolean {
    const action = parseCallAction(commandLine);
    if (action === undefined) return false;
    sendCallAction(action, "command-line");
    return true;
}

/** Whether global shortcuts were turned off: --no-global-shortcuts or INTERCOM_NO_GLOBAL_SHORTCUTS=1. */
export function areGlobalShortcutsDisabled(
    argv: readonly string[] = process.argv,
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    return argv.includes("--no-global-shortcuts") || ["1", "true"].includes(env.INTERCOM_NO_GLOBAL_SHORTCUTS ?? "");
}

/** Whether the XDG GlobalShortcuts portal was asked for (Linux): --global-shortcuts-portal. */
export function isShortcutsPortalRequested(
    argv: readonly string[] = process.argv,
    platform: NodeJS.Platform = process.platform,
): boolean {
    return platform === "linux" && argv.includes("--global-shortcuts-portal");
}

/**
 * Whether this platform gets global shortcuts registered: Windows unless turned off, Linux only
 * through the portal and only on request (Electron's own do not work on Wayland).
 */
export function wantsGlobalShortcuts(
    platform: NodeJS.Platform = process.platform,
    argv: readonly string[] = process.argv,
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    if (areGlobalShortcutsDisabled(argv, env)) return false;
    return platform === "win32" || isShortcutsPortalRequested(argv, platform);
}

/**
 * Register the global shortcuts for as long as a call is on, so that the keys are everybody
 * else's the rest of the time. The web app says when a call connects and ends.
 */
export function initCallShortcuts(): void {
    if (!wantsGlobalShortcuts()) return;
    let registered = false;
    const setRegistered = (wanted: boolean): void => {
        if (wanted === registered) return;
        registered = wanted;
        for (const [accelerator, action] of Object.entries(GLOBAL_SHORTCUTS)) {
            try {
                if (!wanted) globalShortcut.unregister(accelerator);
                else if (!globalShortcut.register(accelerator, () => sendCallAction(action, "global-shortcut"))) {
                    logDiagnostics("global_shortcut_unavailable", { accelerator });
                }
            } catch (e) {
                logDiagnostics("global_shortcut_unavailable", { accelerator, error: String(e).slice(0, 200) });
            }
        }
    };
    ipcMain.on("app_onAction", (_ev, payload: { action?: unknown; state?: unknown } | undefined) => {
        if (payload?.action !== "call_state") return;
        if (payload.state === "connected") setRegistered(true);
        else if (payload.state === "ended") setRegistered(false);
    });
    app.on("will-quit", () => setRegistered(false));
}
