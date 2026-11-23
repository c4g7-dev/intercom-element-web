/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import {
    adoptCallVoiceState,
    INITIAL_VOICE_STATE,
    isVoiceAction,
    parseVoiceState,
    reduceVoiceState,
    type VoiceAction,
    voiceCueFor,
    type VoiceState,
    voiceStateToWire,
} from "./VoiceState";

const run = (actions: VoiceAction[], from: VoiceState = INITIAL_VOICE_STATE): VoiceState =>
    actions.reduce(reduceVoiceState, from);
const short = (s: VoiceState): string => `${s.muted ? "M" : "m"}${s.deafened ? "D" : "d"}`;

describe("the voice state", () => {
    it("starts heard and hearing", () => {
        expect(INITIAL_VOICE_STATE).toEqual({ muted: false, deafened: false, mutedBeforeDeafen: false });
    });

    it("mutes and unmutes", () => {
        expect(short(run(["toggle-mute"]))).toBe("Md");
        expect(short(run(["toggle-mute", "toggle-mute"]))).toBe("md");
        expect(short(run(["mute", "mute"]))).toBe("Md");
        expect(short(run(["mute", "unmute"]))).toBe("md");
    });

    it("mutes with deafening, and puts the microphone back as it was afterwards", () => {
        expect(short(run(["toggle-deafen"]))).toBe("MD");
        // Was unmuted before: unmuted again
        expect(short(run(["toggle-deafen", "toggle-deafen"]))).toBe("md");
        // Was muted before: stays muted
        expect(short(run(["mute", "toggle-deafen", "toggle-deafen"]))).toBe("Md");
        expect(short(run(["mute", "deafen", "undeafen"]))).toBe("Md");
    });

    it("ends the deafening when the microphone is turned on", () => {
        expect(run(["toggle-deafen", "unmute"])).toEqual(INITIAL_VOICE_STATE);
        expect(run(["toggle-deafen", "toggle-mute"])).toEqual(INITIAL_VOICE_STATE);
        // Also where the microphone was off before the deafening
        expect(run(["mute", "toggle-deafen", "toggle-mute"])).toEqual(INITIAL_VOICE_STATE);
    });

    it("stays muted after a deafening during which the user muted by hand", () => {
        expect(short(run(["toggle-deafen", "mute", "toggle-deafen"]))).toBe("Md");
    });

    it("gives the same object back where nothing changes", () => {
        const muted = run(["mute"]);
        expect(reduceVoiceState(muted, "mute")).toBe(muted);
        expect(reduceVoiceState(INITIAL_VOICE_STATE, "unmute")).toBe(INITIAL_VOICE_STATE);
        expect(reduceVoiceState(INITIAL_VOICE_STATE, "undeafen")).toBe(INITIAL_VOICE_STATE);
        const deafened = run(["deafen"]);
        expect(reduceVoiceState(deafened, "deafen")).toBe(deafened);
    });

    it("never has deafened without muted", () => {
        const actions: VoiceAction[] = ["toggle-mute", "mute", "unmute", "toggle-deafen", "deafen", "undeafen"];
        let frontier: VoiceState[] = [INITIAL_VOICE_STATE];
        for (let depth = 0; depth < 5; depth++) {
            frontier = frontier.flatMap((state) => actions.map((action) => reduceVoiceState(state, action)));
            for (const state of frontier) {
                if (state.deafened) expect(state.muted).toBe(true);
                else expect(state.mutedBeforeDeafen).toBe(false);
            }
        }
    });

    it("takes over what a call did with its own controls", () => {
        // Muted in the call
        expect(short(adoptCallVoiceState(INITIAL_VOICE_STATE, { muted: true, deafened: false }))).toBe("Md");
        // Deafened in the call: the microphone goes back to what it was here
        const deafened = adoptCallVoiceState(INITIAL_VOICE_STATE, { muted: true, deafened: true });
        expect(deafened).toEqual({ muted: true, deafened: true, mutedBeforeDeafen: false });
        expect(short(reduceVoiceState(deafened, "toggle-deafen"))).toBe("md");
        const mutedThenDeafened = adoptCallVoiceState(run(["mute"]), { muted: true, deafened: true });
        expect(short(reduceVoiceState(mutedThenDeafened, "toggle-deafen"))).toBe("Md");
        // Undeafened in the call, which put its microphone back itself
        expect(adoptCallVoiceState(deafened, { muted: false, deafened: false })).toEqual(INITIAL_VOICE_STATE);
        // Nothing new: the same object
        expect(adoptCallVoiceState(deafened, { muted: true, deafened: true })).toBe(deafened);
    });

    it("plays one cue for what can be heard of a change, and none otherwise", () => {
        const muted = run(["mute"]);
        const deafened = run(["deafen"]);
        expect(voiceCueFor(INITIAL_VOICE_STATE, muted)).toBe("off");
        expect(voiceCueFor(muted, INITIAL_VOICE_STATE)).toBe("on");
        expect(voiceCueFor(INITIAL_VOICE_STATE, deafened)).toBe("off");
        expect(voiceCueFor(deafened, INITIAL_VOICE_STATE)).toBe("on");
        // Undeafened into muted: hearing again
        expect(voiceCueFor(run(["mute", "deafen"]), muted)).toBe("on");
        // Muted by hand while deafened: nothing to hear of it
        expect(voiceCueFor(deafened, reduceVoiceState(deafened, "mute"))).toBeUndefined();
        expect(voiceCueFor(muted, muted)).toBeUndefined();
    });

    it("is stored and read back, and anything else is the initial state", () => {
        for (const state of [INITIAL_VOICE_STATE, run(["mute"]), run(["deafen"]), run(["mute", "deafen"])]) {
            expect(parseVoiceState(JSON.stringify(voiceStateToWire(state)))).toEqual(state);
        }
        for (const broken of [null, undefined, "", "{", "null", "5", '"muted"', "[]"]) {
            expect(parseVoiceState(broken)).toEqual(INITIAL_VOICE_STATE);
        }
        // A stored state that contradicts itself is put right
        expect(parseVoiceState('{"muted":false,"deafened":true}')).toEqual({
            muted: true,
            deafened: true,
            mutedBeforeDeafen: false,
        });
        expect(parseVoiceState('{"muted":true,"deafened":false,"muted_before_deafen":true}')).toEqual({
            muted: true,
            deafened: false,
            mutedBeforeDeafen: false,
        });
    });

    it("knows its actions", () => {
        for (const action of ["toggle-mute", "mute", "unmute", "toggle-deafen", "deafen", "undeafen"]) {
            expect(isVoiceAction(action)).toBe(true);
        }
        for (const other of ["toggle-camera", "leave-call", "", null, 1]) expect(isVoiceAction(other)).toBe(false);
    });
});
