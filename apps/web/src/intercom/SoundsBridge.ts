/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type ClientWidgetApi, type IWidgetApiRequest } from "matrix-widget-api";

import { type CustomSounds, getCustomSounds } from "./Sounds";

/**
 * The widget action Element Call (InterCom build) asks about the call's sounds on, once when the
 * call is joined: `{}`. The reply is `{ host_cues: true, sounds: { join?, leave? } }`: the app
 * plays the user's own join and leave itself, and these are the user's own files (`{ data }`,
 * base64) for the sounds of others joining and leaving, which the call plays.
 */
export const SOUNDS_WIDGET_ACTION = "io.intercom.sounds";

/** What a call is told about the sounds. */
export function soundsReply(custom: CustomSounds): {
    host_cues: true;
    sounds: { join?: { data: string }; leave?: { data: string } };
} {
    return {
        host_cues: true,
        sounds: {
            ...(custom.join && { join: { data: custom.join.data } }),
            ...(custom.leave && { leave: { data: custom.leave.data } }),
        },
    };
}

/**
 * Answers a call widget's question about the sounds. Only the bundled call is given this.
 * @returns what stops it again
 */
export function attachSoundsBridge(
    widgetApi: ClientWidgetApi,
    customSounds: () => Promise<CustomSounds> = getCustomSounds,
): () => void {
    const onAction = (ev: CustomEvent<IWidgetApiRequest>): void => {
        ev.preventDefault(); // stop the widget API from auto-rejecting this
        void customSounds()
            .catch((): CustomSounds => ({}))
            .then((custom) => widgetApi.transport.reply(ev.detail, soundsReply(custom)));
    };
    widgetApi.on(`action:${SOUNDS_WIDGET_ACTION}`, onAction);
    return () => widgetApi.off(`action:${SOUNDS_WIDGET_ACTION}`, onAction);
}
