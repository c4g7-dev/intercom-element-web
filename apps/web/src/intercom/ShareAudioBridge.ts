/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type ClientWidgetApi, type IWidgetApiRequest } from "matrix-widget-api";
import { logger } from "matrix-js-sdk/src/logger";

/**
 * The widget action through which the bundled Element Call asks the desktop app for a screen
 * share's audio from a PipeWire/PulseAudio sink. The widget runs in an iframe without the preload's
 * IPC; this is the one, narrow way through, and only the bundled call widget is given it.
 *
 * Request data: `{ op: "list" }`, `{ op: "prepare", sink: string }` or `{ op: "release", sink?: string }`
 * (one sink's source, or all of them).
 * Response: `{ supported, sinks }`, `{ description, sourceName, reused }` or `{}`; an error
 * response where the desktop app refuses or fails.
 */
export const SHARE_AUDIO_ACTION = "io.intercom.share_audio";

/** Whether a widget URL is the Element Call build that ships inside this app. */
export function isBundledElementCall(widgetUrl: string, location: string = window.location.href): boolean {
    try {
        const bundled = new URL("./widgets/element-call/", location);
        const url = new URL(widgetUrl, location);
        return (
            url.protocol === bundled.protocol && url.host === bundled.host && url.pathname.startsWith(bundled.pathname)
        );
    } catch {
        return false;
    }
}

/**
 * Lets the widget behind `widgetApi` use the desktop app's share audio, if it is the bundled
 * Element Call and the desktop app has it. Otherwise the action stays unknown to the host, which
 * the widget takes as "not available".
 * @returns what to call when the widget is stopped, which lets go of the share's source
 */
export function attachShareAudioBridge(widgetApi: ClientWidgetApi, widgetUrl: string): () => void {
    const shareAudio = window.electron?.intercomShareAudio;
    if (!shareAudio || !isBundledElementCall(widgetUrl)) return () => {};

    let used = false;
    const onAction = (ev: CustomEvent<IWidgetApiRequest>): void => {
        ev.preventDefault(); // stop the widget API from auto-rejecting this
        const data = (ev.detail.data ?? {}) as { op?: unknown; sink?: unknown };
        let answer: Promise<object | void>;
        switch (data.op) {
            case "list":
                answer = shareAudio.listSinks();
                break;
            case "prepare":
                if (typeof data.sink !== "string") {
                    answer = Promise.reject(new Error("No sink given"));
                    break;
                }
                used = true;
                answer = shareAudio.prepareShareSource(data.sink);
                break;
            case "release":
                answer = shareAudio.releaseShareSource(typeof data.sink === "string" ? data.sink : undefined);
                break;
            default:
                answer = Promise.reject(new Error("Unknown share audio operation"));
        }
        answer.then(
            (result) => widgetApi.transport.reply(ev.detail, { ...result }),
            (e: unknown) => {
                logger.warn("InterCom share audio request failed", e);
                widgetApi.transport.reply(ev.detail, {
                    error: { message: e instanceof Error ? e.message : String(e) },
                });
            },
        );
    };
    widgetApi.on(`action:${SHARE_AUDIO_ACTION}`, onAction);

    return () => {
        widgetApi.off(`action:${SHARE_AUDIO_ACTION}`, onAction);
        // A call that ends with its share still on cannot say that it is over
        if (used) shareAudio.releaseShareSource().catch(() => {});
    };
}
