/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Mute and deafen in the tray menu.
 *
 * The state is the web app's (it holds with or without a call and is kept over restarts there);
 * the web app tells it here whenever it changes, and a click on one of the two entries goes back
 * to it as a call action, like `intercom --toggle-mute` does.
 */

import { ipcMain, type MenuItemConstructorOptions } from "electron";

import { sendCallAction } from "./intercom-call-actions.js";

/** How the web app last said mute and deafen stand; undefined until it has. */
export interface TrayVoiceState {
    muted: boolean;
    deafened: boolean;
}

let state: TrayVoiceState | undefined;

/** Reads the web app's message; anything that is not one is undefined. */
export function parseVoiceStatePayload(payload: unknown): TrayVoiceState | undefined {
    if (typeof payload !== "object" || payload === null) return undefined;
    const raw = payload as Record<string, unknown>;
    if (raw.action !== "intercom_voice_state") return undefined;
    const deafened = raw.deafened === true;
    return { muted: deafened || raw.muted === true, deafened };
}

/**
 * The tray's entries for mute and deafen: checked when on. Empty before the web app has said how
 * they stand (it is not loaded yet, or the user is not signed in).
 */
export function voiceTrayItems(
    labels: { mute: string; deafen: string },
    current: TrayVoiceState | undefined = state,
    perform: (action: "toggle-mute" | "toggle-deafen") => void = (action) => void sendCallAction(action, "tray"),
): MenuItemConstructorOptions[] {
    if (!current) return [];
    return [
        { type: "separator" },
        { label: labels.mute, type: "checkbox", checked: current.muted, click: () => perform("toggle-mute") },
        { label: labels.deafen, type: "checkbox", checked: current.deafened, click: () => perform("toggle-deafen") },
        { type: "separator" },
    ];
}

let onChange: (() => void) | undefined;

/**
 * Says what builds the tray menu anew when mute or deafen changed. The state itself is listened
 * for from the start, so that a tray that is made later knows it.
 */
export function onVoiceTrayChange(listener: (() => void) | undefined): void {
    onChange = listener;
}

/** Takes a message of the web app in. Exported for the tests. */
export function handleVoiceStatePayload(payload: unknown): void {
    const next = parseVoiceStatePayload(payload);
    if (!next || (state && state.muted === next.muted && state.deafened === next.deafened)) return;
    state = next;
    onChange?.();
}

ipcMain.on("app_onAction", (_ev, payload: unknown) => handleVoiceStatePayload(payload));
