/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { logger } from "matrix-js-sdk/src/logger";

import { CallStore } from "../stores/CallStore";
import { WidgetMessagingStore } from "../stores/widgets/WidgetMessagingStore";
import WidgetUtils from "../utils/WidgetUtils";
import { isVoiceAction, type VoiceSource } from "./VoiceState";
import { VoiceStateStore } from "./VoiceStateStore";
import { type AloneTimeout, storeAloneTimeout } from "./AloneTimeout";

/**
 * What a shortcut can ask of the call that is on: from the keyboard while the window has the
 * focus, and from the desktop app while it has not (a global shortcut, or `intercom --toggle-mute`
 * run by the compositor's key binding), and from the buttons of the user panel.
 */
export type CallAction =
    | "toggle-mute"
    | "mute"
    | "unmute"
    | "toggle-deafen"
    | "toggle-camera"
    | "toggle-screenshare"
    | "screenshare-settings"
    | "toggle-diagnostics"
    /** Stays in a private call the user was left alone in: its countdown starts over */
    | "stay-in-call"
    | "leave-call";

const CALL_ACTIONS = new Set<string>([
    "toggle-mute",
    "mute",
    "unmute",
    "toggle-deafen",
    "toggle-camera",
    "toggle-screenshare",
    "screenshare-settings",
    "toggle-diagnostics",
    "stay-in-call",
    "leave-call",
]);

export function isCallAction(value: unknown): value is CallAction {
    return typeof value === "string" && CALL_ACTIONS.has(value);
}

/** The widget action Element Call (InterCom build) carries the call actions out on. */
export const CALL_ACTION_WIDGET_ACTION = "io.intercom.call_action";

/** The shortcut a key press is while a call is on: Ctrl+Shift+M, D, V or S. */
export function callActionForKey(
    ev: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">,
): CallAction | undefined {
    if (!ev.ctrlKey || !ev.shiftKey || ev.altKey || ev.metaKey) return undefined;
    switch (ev.key.toLowerCase()) {
        case "m":
            return "toggle-mute";
        case "d":
            return "toggle-deafen";
        case "v":
            return "toggle-camera";
        case "s":
            return "toggle-screenshare";
        default:
            return undefined;
    }
}

/**
 * Where a change of mute or deafen came from, as the diagnostics name it, from who asked for the
 * call action: the keyboard, the user panel, or the desktop app with what it was asked by.
 */
export function voiceSourceFor(source: string): VoiceSource {
    switch (source) {
        case "user-panel":
            return "panel";
        case "desktop:tray":
            return "tray";
        case "keyboard":
        case "desktop:global-shortcut":
            return "hotkey";
        default:
            // The desktop app is asked on its command line unless it says otherwise
            return source.startsWith("desktop") ? "cli" : "hotkey";
    }
}

/**
 * Carry a call action out. Mute and deafen are the app's own state, which holds with or without
 * a call (see {@link VoiceStateStore}); everything else goes to every call the user is in (which
 * is one, as a rule).
 * @returns how many calls it reached; 0 where there is no call, which is not an error
 */
export async function performCallAction(action: unknown, source: string): Promise<number> {
    if (!isCallAction(action)) {
        logger.warn(`Ignoring unknown call action from ${source}`);
        return 0;
    }
    if (isVoiceAction(action)) {
        // The store tells the calls, plays the cue and writes the diagnostics record
        VoiceStateStore.instance.perform(action, voiceSourceFor(source));
        return CallStore.instance.connectedCalls.size;
    }
    let reached = 0;
    for (const call of CallStore.instance.connectedCalls) {
        try {
            if (action === "leave-call") {
                await call.disconnect();
            } else {
                const messaging = WidgetMessagingStore.instance.getMessagingForUid(
                    WidgetUtils.getWidgetUid(call.widget),
                );
                if (!messaging?.widgetApi) continue;
                await messaging.widgetApi.transport.send(CALL_ACTION_WIDGET_ACTION, { action });
            }
            reached++;
        } catch (e) {
            // A call widget that does not know the action (not the InterCom build) says so
            logger.warn(`Call action ${action} from ${source} failed`, e);
        }
    }
    // The desktop app writes the console's diagnostics lines to its log
    logger.log(`[intercom-diag] ${JSON.stringify({ type: "call_action_host", action, source, calls: reached })}`);
    return reached;
}

/**
 * Keeps another time to stay alone in a private call for (Settings → InterCom), and tells the
 * calls that are on: a countdown that runs starts over with it. A voice channel's call, which
 * was not given a timeout to begin with, does nothing about it.
 * @returns how many calls were told
 */
export async function changeAloneTimeout(timeout: AloneTimeout): Promise<number> {
    storeAloneTimeout(timeout);
    let reached = 0;
    for (const call of CallStore.instance.connectedCalls) {
        try {
            const messaging = WidgetMessagingStore.instance.getMessagingForUid(WidgetUtils.getWidgetUid(call.widget));
            if (!messaging?.widgetApi) continue;
            await messaging.widgetApi.transport.send(CALL_ACTION_WIDGET_ACTION, { action: "alone-timeout", timeout });
            reached++;
        } catch (e) {
            // A call widget that does not know the action (not the InterCom build) says so
            logger.warn("Could not tell a call the new time to stay alone for", e);
        }
    }
    return reached;
}

/**
 * Listen for the call shortcuts on the app's own page. The call's frame listens for the same keys
 * itself, as key presses inside a frame do not come by here.
 * @returns what removes the listener again
 */
export function installCallShortcuts(target: Document = document): () => void {
    const onKeyDown = (ev: KeyboardEvent): void => {
        const action = callActionForKey(ev);
        if (action === undefined) return;
        // Ctrl+Shift+M mutes with or without a call. Outside a call the other keys are whatever
        // they are otherwise (Ctrl+Shift+D: the space panel)
        if (action !== "toggle-mute" && CallStore.instance.connectedCalls.size === 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (!ev.repeat) void performCallAction(action, "keyboard");
    };
    // Captured, so that it is ours before the app's own key bindings see it
    target.addEventListener("keydown", onKeyDown, true);
    return () => target.removeEventListener("keydown", onKeyDown, true);
}
