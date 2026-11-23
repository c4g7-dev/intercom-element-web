/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * The user's microphone and hearing, as one state for the whole app: it holds outside a call,
 * is kept over restarts, and every call is joined with it.
 *
 * Deafened is hearing nobody and being heard by nobody, so it implies muted. Ending it puts the
 * microphone back to what it was before; unmuting while deafened ends the deafening too, and
 * muting by hand while deafened means staying muted afterwards.
 *
 * This file is the state and its transitions only; {@link VoiceStateStore} keeps it, stores it
 * and passes it between the app and the calls.
 */

export interface VoiceState {
    /** The microphone is off */
    muted: boolean;
    /** Nothing of a call is heard; implies `muted` */
    deafened: boolean;
    /** While deafened: whether the microphone stays off when the deafening ends */
    mutedBeforeDeafen: boolean;
}

/** What the state is on first start: heard and hearing. */
export const INITIAL_VOICE_STATE: Readonly<VoiceState> = Object.freeze({
    muted: false,
    deafened: false,
    mutedBeforeDeafen: false,
});

/** What can be asked of the state by the user. */
export type VoiceAction = "toggle-mute" | "mute" | "unmute" | "toggle-deafen" | "deafen" | "undeafen";

const VOICE_ACTIONS = new Set<string>(["toggle-mute", "mute", "unmute", "toggle-deafen", "deafen", "undeafen"]);

export function isVoiceAction(value: unknown): value is VoiceAction {
    return typeof value === "string" && VOICE_ACTIONS.has(value);
}

/** Where a change came from, as the diagnostics name it. */
export type VoiceSource = "panel" | "hotkey" | "cli" | "call" | "tray";

function setMuted(state: VoiceState, muted: boolean): VoiceState {
    if (muted) {
        // Muted by hand while deafened: stay muted when the deafening ends
        if (state.deafened) return { ...state, mutedBeforeDeafen: true };
        return { ...state, muted: true };
    }
    // Nobody wants to talk to people they cannot hear
    return { muted: false, deafened: false, mutedBeforeDeafen: false };
}

function setDeafened(state: VoiceState, deafened: boolean): VoiceState {
    if (deafened === state.deafened) return state;
    if (deafened) return { muted: true, deafened: true, mutedBeforeDeafen: state.muted };
    return { muted: state.mutedBeforeDeafen, deafened: false, mutedBeforeDeafen: false };
}

/** The state after an action. The same object comes back where nothing changes. */
export function reduceVoiceState(state: VoiceState, action: VoiceAction): VoiceState {
    let next: VoiceState;
    switch (action) {
        case "mute":
            next = setMuted(state, true);
            break;
        case "unmute":
            next = setMuted(state, false);
            break;
        case "toggle-mute":
            // While deafened the microphone is off, so the toggle turns it on
            next = setMuted(state, !state.muted);
            break;
        case "deafen":
            next = setDeafened(state, true);
            break;
        case "undeafen":
            next = setDeafened(state, false);
            break;
        case "toggle-deafen":
            next = setDeafened(state, !state.deafened);
            break;
    }
    return sameVoiceState(state, next) ? state : next;
}

/**
 * The state after a call said how its microphone and hearing stand (the user used the call's own
 * controls, or the call could not do what was asked of it).
 */
export function adoptCallVoiceState(state: VoiceState, call: { muted: boolean; deafened: boolean }): VoiceState {
    let next: VoiceState;
    if (call.deafened) {
        next = {
            muted: true,
            deafened: true,
            // Deafened in the call just now: the microphone goes back to what it was here
            mutedBeforeDeafen: state.deafened ? state.mutedBeforeDeafen : state.muted,
        };
    } else {
        next = { muted: call.muted, deafened: false, mutedBeforeDeafen: false };
    }
    return sameVoiceState(state, next) ? state : next;
}

export function sameVoiceState(a: VoiceState, b: VoiceState): boolean {
    return a.muted === b.muted && a.deafened === b.deafened && a.mutedBeforeDeafen === b.mutedBeforeDeafen;
}

/** Whether a call that reports this stands as the state says. */
export function callMatchesVoiceState(state: VoiceState, call: { muted: boolean; deafened: boolean }): boolean {
    return state.muted === call.muted && state.deafened === call.deafened;
}

/**
 * Which cue a change is worth: "on" when the user can be heard or can hear again, "off" when
 * they no longer can, none when nothing audible changed.
 */
export function voiceCueFor(before: VoiceState, after: VoiceState): "on" | "off" | undefined {
    if (before.deafened !== after.deafened) return after.deafened ? "off" : "on";
    if (before.muted !== after.muted) return after.muted ? "off" : "on";
    return undefined;
}

/** The state as it is stored and sent to a call. */
export type VoiceStateWire = {
    muted: boolean;
    deafened: boolean;
    muted_before_deafen: boolean;
};

export function voiceStateToWire(state: VoiceState): VoiceStateWire {
    return { muted: state.muted, deafened: state.deafened, muted_before_deafen: state.mutedBeforeDeafen };
}

/**
 * Reads a stored state. Anything that is not one (nothing stored, another version's, broken JSON)
 * is the initial state, and a state that contradicts itself is put right.
 */
export function parseVoiceState(text: string | null | undefined): VoiceState {
    if (!text) return { ...INITIAL_VOICE_STATE };
    try {
        const raw = JSON.parse(text) as Partial<VoiceStateWire> | null;
        if (typeof raw !== "object" || raw === null) return { ...INITIAL_VOICE_STATE };
        const deafened = raw.deafened === true;
        return {
            muted: deafened || raw.muted === true,
            deafened,
            mutedBeforeDeafen: deafened && raw.muted_before_deafen === true,
        };
    } catch {
        return { ...INITIAL_VOICE_STATE };
    }
}
