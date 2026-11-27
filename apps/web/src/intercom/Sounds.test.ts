/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, describe, expect, it, vi } from "vitest";
import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";
import { type ClientWidgetApi } from "matrix-widget-api";

import {
    getCustomSounds,
    isRisingCue,
    parseCustomSounds,
    playLoopCue,
    resetSoundCuesForTest,
    SOUND_CUES,
} from "./Sounds";
import { attachSoundsBridge, playedCue, SOUNDS_WIDGET_ACTION, soundsReply } from "./SoundsBridge";

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
            ringtone: { name: "ringtone.mp3", type: "audio/mpeg", data: "QUJD" },
            ringback: { name: "ringback.ogg", type: "audio/ogg", data: "REVG" },
        });
        expect(parsed).toEqual({
            join: { name: "join.ogg", type: "audio/ogg", data: "QUJD" },
            leave: { name: "leave", type: "audio/ogg", data: "REVG" },
            ringtone: { name: "ringtone.mp3", type: "audio/mpeg", data: "QUJD" },
            ringback: { name: "ringback.ogg", type: "audio/ogg", data: "REVG" },
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

describe("the ringtone and the ringback", () => {
    const source = {} as AudioBufferSourceNode;
    const createObjectURL = URL.createObjectURL;

    afterEach(() => {
        resetSoundCuesForTest();
        delete (window as { electron?: unknown }).electron;
        URL.createObjectURL = createObjectURL;
    });

    it("are InterCom's own sounds, on a loop", async () => {
        const play = vi.fn().mockResolvedValue(source);
        await expect(playLoopCue({ play }, "ringtone")).resolves.toBe(source);
        await playLoopCue({ play }, "ringback");
        expect(play.mock.calls).toEqual([
            ["media/intercom/ringtone.ogg", true],
            ["media/intercom/ringback.ogg", true],
        ]);
    });

    it("are the user's own files where there are some", async () => {
        const list = vi
            .fn()
            .mockResolvedValue({ ringtone: { name: "ringtone.mp3", type: "audio/mpeg", data: "QUJD" } });
        (window as { electron?: unknown }).electron = { intercomSounds: { list } };
        const blobs: Blob[] = [];
        URL.createObjectURL = vi.fn((blob: Blob) => `blob:own-${blobs.push(blob)}`);
        const play = vi.fn().mockResolvedValue(source);

        await playLoopCue({ play }, "ringtone");
        await playLoopCue({ play }, "ringtone");
        await playLoopCue({ play }, "ringback");
        expect(play.mock.calls).toEqual([
            ["blob:own-1", true],
            ["blob:own-1", true],
            ["media/intercom/ringback.ogg", true],
        ]);
        expect(blobs).toHaveLength(1);
        expect(blobs[0].type).toBe("audio/mpeg");
        expect(await blobs[0].text()).toBe("ABC");
    });

    it("are the built-in ones where the user's file cannot be played, from then on", async () => {
        const list = vi.fn().mockResolvedValue({ ringtone: { name: "ringtone.ogg", type: "audio/ogg", data: "QUJD" } });
        (window as { electron?: unknown }).electron = { intercomSounds: { list } };
        URL.createObjectURL = vi.fn(() => "blob:own");
        const play = vi.fn(async (url: string) => {
            if (url === "blob:own") throw new Error("EncodingError");
            return source;
        });

        await expect(playLoopCue({ play }, "ringtone")).resolves.toBe(source);
        await playLoopCue({ play }, "ringtone");
        expect(play.mock.calls.map(([url]) => url)).toEqual([
            "blob:own",
            "media/intercom/ringtone.ogg",
            "media/intercom/ringtone.ogg",
        ]);
    });
});

describe("the sounds a call is told of", () => {
    it("are the join and leave files, and that the app plays the user's own", () => {
        expect(soundsReply({})).toEqual({ host_cues: true, sounds: {} });
        expect(
            soundsReply({
                join: { name: "join.ogg", type: "audio/ogg", data: "QUJD" },
                mute: { name: "mute.ogg", type: "audio/ogg", data: "REVG" },
                ringtone: { name: "ringtone.ogg", type: "audio/ogg", data: "R0hJ" },
                ringback: { name: "ringback.ogg", type: "audio/ogg", data: "SktM" },
            }),
        ).toEqual({ host_cues: true, sounds: { join: { data: "QUJD" }, ringback: { data: "SktM" } } });
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

    it("takes the call's word that it played a leave sound, and no other word", () => {
        expect(playedCue({ played: "leave" })).toBe("leave");
        for (const data of [undefined, null, {}, { played: "join" }, { played: true }, "leave"]) {
            expect(playedCue(data)).toBeUndefined();
        }

        const api = new TypedEventEmitter<
            string,
            Record<string, (...args: unknown[]) => void>
        >() as unknown as ClientWidgetApi & { reply: ReturnType<typeof vi.fn> };
        api.reply = vi.fn();
        (api as unknown as { transport: object }).transport = { reply: api.reply };
        const customSounds = vi.fn(async () => ({}));
        const ownCues = { leaveHeard: vi.fn() };
        attachSoundsBridge(api, customSounds, ownCues);

        const event = { preventDefault: vi.fn(), detail: { data: { played: "leave" } } };
        api.emit(`action:${SOUNDS_WIDGET_ACTION}`, event);
        expect(ownCues.leaveHeard).toHaveBeenCalledTimes(1);
        expect(api.reply).toHaveBeenCalledWith(event.detail, {});
        // That was no question about the sound files
        expect(customSounds).not.toHaveBeenCalled();
    });
});
