/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, describe, expect, it, vi } from "vitest";
import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";
import { type ClientWidgetApi } from "matrix-widget-api";

import { getCustomSounds, isRisingCue, parseCustomSounds, resetSoundCuesForTest, SOUND_CUES } from "./Sounds";
import { attachSoundsBridge, SOUNDS_WIDGET_ACTION, soundsReply } from "./SoundsBridge";

describe("the user's own sounds", () => {
    afterEach(() => {
        resetSoundCuesForTest();
        delete (window as { electron?: unknown }).electron;
    });

    it("are read for the cues there are, and nothing else", () => {
        const parsed = parseCustomSounds({
            join: { name: "join.ogg", type: "audio/ogg", data: "QUJD" },
            leave: { data: "REVG" },
            mute: { name: "mute.ogg", data: "" },
            unmute: "unmute.ogg",
            deafen: { name: "deafen.ogg", data: "A".repeat(3 * 1024 * 1024) },
            ring: { name: "ring.ogg", data: "QUJD" },
        });
        expect(parsed).toEqual({
            join: { name: "join.ogg", type: "audio/ogg", data: "QUJD" },
            leave: { name: "leave", type: "audio/ogg", data: "REVG" },
        });
        for (const nothing of [undefined, null, "x", 4, []]) expect(parseCustomSounds(nothing)).toEqual({});
    });

    it("are none without the desktop app", async () => {
        await expect(getCustomSounds()).resolves.toEqual({});
    });

    it("are asked for once", async () => {
        const list = vi.fn().mockResolvedValue({ join: { name: "join.mp3", type: "audio/mpeg", data: "QUJD" } });
        (window as { electron?: unknown }).electron = { intercomSounds: { list } };
        await expect(getCustomSounds()).resolves.toEqual({
            join: { name: "join.mp3", type: "audio/mpeg", data: "QUJD" },
        });
        await getCustomSounds();
        expect(list).toHaveBeenCalledTimes(1);
    });

    it("are none where the desktop app fails to read them", async () => {
        (window as { electron?: unknown }).electron = {
            intercomSounds: { list: vi.fn().mockRejectedValue(new Error("no")) },
        };
        await expect(getCustomSounds()).resolves.toEqual({});
    });

    it("rise for what comes on and fall for what goes off", () => {
        expect(SOUND_CUES.filter(isRisingCue)).toEqual(["join", "unmute", "undeafen"]);
    });
});

describe("the sounds a call is told of", () => {
    it("are the join and leave files, and that the app plays the user's own", () => {
        expect(soundsReply({})).toEqual({ host_cues: true, sounds: {} });
        expect(
            soundsReply({
                join: { name: "join.ogg", type: "audio/ogg", data: "QUJD" },
                mute: { name: "mute.ogg", type: "audio/ogg", data: "REVG" },
            }),
        ).toEqual({ host_cues: true, sounds: { join: { data: "QUJD" } } });
    });

    it("answers the call's question, until detached", async () => {
        const api = new TypedEventEmitter<
            string,
            Record<string, (...args: unknown[]) => void>
        >() as unknown as ClientWidgetApi & { reply: ReturnType<typeof vi.fn> };
        api.reply = vi.fn();
        (api as unknown as { transport: object }).transport = { reply: api.reply };
        const detach = attachSoundsBridge(api, async () => ({
            leave: { name: "leave.wav", type: "audio/wav", data: "REVG" },
        }));

        const event = { preventDefault: vi.fn(), detail: { data: {} } };
        api.emit(`action:${SOUNDS_WIDGET_ACTION}`, event);
        await vi.waitFor(() => expect(api.reply).toHaveBeenCalled());
        expect(event.preventDefault).toHaveBeenCalled();
        expect(api.reply).toHaveBeenCalledWith(event.detail, {
            host_cues: true,
            sounds: { leave: { data: "REVG" } },
        });

        detach();
        api.emit(`action:${SOUNDS_WIDGET_ACTION}`, event);
        await Promise.resolve();
        expect(api.reply).toHaveBeenCalledTimes(1);
    });
});
