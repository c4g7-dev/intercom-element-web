/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type ClientWidgetApi, type IWidgetApiRequest } from "matrix-widget-api";

import { type CustomSounds, getCustomSounds } from "./Sounds";
import { OwnCallCues } from "./OwnCallCues";

/**
 * The widget action Element Call (InterCom build) asks about the call's sounds on, once when the
 * call is joined: `{}`. The reply is `{ host_cues: true, sounds: { join?, leave?, ringback? } }`:
 * the app plays the user's own join and leave itself, and these are the user's own files
 * (`{ data }`, base64) for the sounds of others joining and leaving and for the ringback of a call
 * that is not answered yet, which the call plays.
 *
 * On the same action the call says `{ played: "leave" }` when it played the sound of another
 * member leaving (or of a call that was declined or not answered): the app then keeps its own
 * leave sound back for a moment, so that the end of a call is one sound. The reply is `{}`.
 */
export const SOUNDS_WIDGET_ACTION = "io.intercom.sounds";

/** What a call is told about the sounds. */
export function soundsReply(custom: CustomSounds): {
    host_cues: true;
    sounds: { join?: { data: string }; leave?: { data: string }; ringback?: { data: string } };
} {
    return {
        host_cues: true,
        sounds: {
            ...(custom.join && { join: { data: custom.join.data } }),
            ...(custom.leave && { leave: { data: custom.leave.data } }),
            ...(custom.ringback && { ringback: { data: custom.ringback.data } }),
        },
    };
}

/** The sound a call says it played, if that is what its message says. */
export function playedCue(data: unknown): "leave" | undefined {
    const played = (data as { played?: unknown } | null | undefined)?.played;
    return played === "leave" ? "leave" : undefined;
}

/**
 * Answers a call widget's question about the sounds. Only the bundled call is given this.
 * @returns what stops it again
 */
export function attachSoundsBridge(
    widgetApi: ClientWidgetApi,
    customSounds: () => Promise<CustomSounds> = getCustomSounds,
    ownCues: Pick<OwnCallCues, "leaveHeard"> = OwnCallCues.instance,
): () => void {
    const onAction = (ev: CustomEvent<IWidgetApiRequest>): void => {
        ev.preventDefault(); // stop the widget API from auto-rejecting this
        if (playedCue(ev.detail.data) === "leave") {
            ownCues.leaveHeard();
            widgetApi.transport.reply(ev.detail, {});
            return;
        }
        void customSounds()
            .catch((): CustomSounds => ({}))
            .then((custom) => widgetApi.transport.reply(ev.detail, soundsReply(custom)));
    };
    widgetApi.on(`action:${SOUNDS_WIDGET_ACTION}`, onAction);
    return () => widgetApi.off(`action:${SOUNDS_WIDGET_ACTION}`, onAction);
}
