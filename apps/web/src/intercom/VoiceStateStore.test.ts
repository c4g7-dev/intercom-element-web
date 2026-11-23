/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { type VoiceStateWire } from "./VoiceState";
import {
    type CallVoiceReport,
    VOICE_STATE_SETTLE_MS,
    VOICE_STATE_STORAGE_KEY,
    VoiceStateStore,
    VoiceStateStoreEvent,
} from "./VoiceStateStore";

class MemoryStorage {
    public readonly items = new Map<string, string>();
    public getItem = (key: string): string | null => this.items.get(key) ?? null;
    public setItem = (key: string, value: string): void => void this.items.set(key, value);
}

const ROOM = "!voice:x";
const wire = (muted: boolean, deafened: boolean, before = false): VoiceStateWire => ({
    muted,
    deafened,
    muted_before_deafen: before,
});
const report = (muted: boolean, deafened = false, reconnecting = false): CallVoiceReport => ({
    muted,
    deafened,
    reconnecting,
});

describe("VoiceStateStore", () => {
    let storage: MemoryStorage;
    let playCue: Mock<(on: boolean) => void>;
    let log: Mock<(record: Record<string, unknown>) => void>;
    const create = (from: Pick<Storage, "getItem" | "setItem"> = storage): VoiceStateStore =>
        new VoiceStateStore({ storage: from, playCue, log });

    /** A call that does what it is told and says so, like the InterCom build of Element Call. */
    function obedientCall(store: VoiceStateStore, roomId = ROOM): Mock<(state: VoiceStateWire) => Promise<unknown>> {
        const send = vi.fn(async (state: VoiceStateWire) => {
            // The call reports a little after it was told, as its state is debounced
            setTimeout(() => store.handleCallReport(roomId, report(state.muted, state.deafened)), 120);
            return {};
        });
        store.attachCall(roomId, send);
        return send;
    }

    beforeEach(() => {
        vi.useFakeTimers();
        storage = new MemoryStorage();
        playCue = vi.fn();
        log = vi.fn();
    });
    afterEach(() => vi.useRealTimers());

    it("is toggled without a call, plays the cue once per change and logs where it came from", () => {
        const store = create();
        const listener = vi.fn();
        store.on(VoiceStateStoreEvent.Update, listener);

        store.perform("toggle-mute", "panel");
        expect(store.state).toMatchObject({ muted: true, deafened: false });
        expect(playCue.mock.calls).toEqual([[false]]);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenLastCalledWith(
            expect.objectContaining({ type: "voice_state", source: "panel", muted: true, deafened: false, calls: 0 }),
        );

        // Nothing changes: no cue, no record, no update
        store.perform("mute", "cli");
        expect(playCue).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledTimes(1);

        store.perform("toggle-deafen", "hotkey");
        store.perform("toggle-deafen", "tray");
        expect(store.state).toMatchObject({ muted: true, deafened: false });
        expect(playCue.mock.calls).toEqual([[false], [false], [true]]);
        expect(log.mock.calls.map(([record]) => record.source)).toEqual(["panel", "hotkey", "tray"]);
    });

    it("is kept over a restart", () => {
        create().perform("toggle-deafen", "cli");
        expect(JSON.parse(storage.items.get(VOICE_STATE_STORAGE_KEY)!)).toEqual(wire(true, true, false));
        const restarted = create();
        expect(restarted.state).toEqual({ muted: true, deafened: true, mutedBeforeDeafen: false });
        // Nothing is played or logged for the state that was read
        expect(playCue).toHaveBeenCalledTimes(1);
        restarted.perform("toggle-deafen", "cli");
        expect(create().state).toEqual({ muted: false, deafened: false, mutedBeforeDeafen: false });
    });

    it("works without storage", () => {
        const store = create({
            getItem: () => {
                throw new Error("denied");
            },
            setItem: () => {
                throw new Error("denied");
            },
        });
        expect(store.perform("mute", "panel").muted).toBe(true);
    });

    it("gives a call that is joined the state to take: muted, or deafened", () => {
        const store = create();
        store.perform("toggle-deafen", "panel");
        const send = vi.fn().mockResolvedValue({});
        store.attachCall(ROOM, send);
        // The call asks when it is joined
        expect(store.handleCallRequest(ROOM)).toEqual(wire(true, true, false));
        // What it says until it has taken the state (microphone on, as it joins) changes nothing here
        store.handleCallReport(ROOM, report(false, false));
        expect(store.state).toMatchObject({ muted: true, deafened: true });
        store.handleCallReport(ROOM, report(true, true));
        expect(store.state).toMatchObject({ muted: true, deafened: true });
        expect(playCue).toHaveBeenCalledTimes(1);
    });

    it("joins unmuted where that is how things stand", () => {
        const store = create();
        const send = vi.fn().mockResolvedValue({});
        store.attachCall(ROOM, send);
        expect(store.handleCallRequest(ROOM)).toEqual(wire(false, false, false));
        store.handleCallReport(ROOM, report(false));
        expect(send).not.toHaveBeenCalled();
        expect(store.state.muted).toBe(false);
    });

    it("brings a call that did not ask to the state with its first report", async () => {
        const store = create();
        store.perform("mute", "panel");
        const send = obedientCall(store);
        store.handleCallReport(ROOM, report(false));
        await vi.advanceTimersByTimeAsync(0);
        expect(send).toHaveBeenCalledWith(wire(true, false));
        await vi.advanceTimersByTimeAsync(VOICE_STATE_SETTLE_MS * 2);
        expect(store.state.muted).toBe(true);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it("tells the call a change from the app, once, and is not told it back", async () => {
        const store = create();
        const send = obedientCall(store);
        store.handleCallReport(ROOM, report(false));

        store.perform("toggle-mute", "hotkey");
        await vi.advanceTimersByTimeAsync(VOICE_STATE_SETTLE_MS * 2);
        expect(send.mock.calls).toEqual([[wire(true, false)]]);
        expect(store.state.muted).toBe(true);
        expect(playCue).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledTimes(1);

        store.perform("toggle-deafen", "cli");
        store.perform("toggle-deafen", "cli");
        await vi.advanceTimersByTimeAsync(VOICE_STATE_SETTLE_MS * 2);
        expect(send.mock.calls.slice(1)).toEqual([[wire(true, true, true)], [wire(true, false)]]);
        expect(store.state).toEqual({ muted: true, deafened: false, mutedBeforeDeafen: false });
        expect(log).toHaveBeenCalledTimes(3);
    });

    it("takes over what the user did with the call's own controls, without sending it back", async () => {
        const store = create();
        const send = obedientCall(store);
        store.handleCallReport(ROOM, report(false));
        const listener = vi.fn();
        store.on(VoiceStateStoreEvent.Update, listener);

        store.handleCallReport(ROOM, report(true));
        expect(store.state.muted).toBe(true);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(playCue.mock.calls).toEqual([[false]]);
        expect(log).toHaveBeenLastCalledWith(expect.objectContaining({ source: "call", muted: true }));

        // Deafened and undeafened in the call, which puts its microphone back itself
        store.handleCallReport(ROOM, report(true, true));
        expect(store.state).toEqual({ muted: true, deafened: true, mutedBeforeDeafen: true });
        store.handleCallReport(ROOM, report(true, false));
        expect(store.state).toEqual({ muted: true, deafened: false, mutedBeforeDeafen: false });

        await vi.advanceTimersByTimeAsync(VOICE_STATE_SETTLE_MS * 2);
        expect(send).not.toHaveBeenCalled();
        // Somebody speaking makes the call report again: nothing changes, nothing is played
        const cues = playCue.mock.calls.length;
        store.handleCallReport(ROOM, report(true, false));
        expect(playCue).toHaveBeenCalledTimes(cues);
    });

    it("passes what one call did on to another", async () => {
        const store = create();
        const first = obedientCall(store, "!a:x");
        const second = obedientCall(store, "!b:x");
        store.handleCallReport("!a:x", report(false));
        store.handleCallReport("!b:x", report(false));
        store.handleCallReport("!a:x", report(true));
        await vi.advanceTimersByTimeAsync(VOICE_STATE_SETTLE_MS * 2);
        expect(first).not.toHaveBeenCalled();
        expect(second.mock.calls).toEqual([[wire(true, false)]]);
        expect(store.state.muted).toBe(true);
    });

    it("does not believe a report from before the call was told, and believes one that stays", async () => {
        const store = create();
        const send = vi.fn().mockResolvedValue({});
        store.attachCall(ROOM, send);
        store.handleCallReport(ROOM, report(false));

        store.perform("mute", "panel");
        // Still on its way to the call: what the call says now is from before
        store.handleCallReport(ROOM, report(false));
        expect(store.state.muted).toBe(true);
        store.handleCallReport(ROOM, report(true));
        await vi.advanceTimersByTimeAsync(VOICE_STATE_SETTLE_MS * 2);
        expect(store.state.muted).toBe(true);

        // A call that cannot do it (no microphone to turn on): after a while its state is the truth
        store.perform("unmute", "panel");
        await vi.advanceTimersByTimeAsync(VOICE_STATE_SETTLE_MS - 1);
        expect(store.state.muted).toBe(false);
        await vi.advanceTimersByTimeAsync(2);
        expect(store.state.muted).toBe(true);
        expect(log).toHaveBeenLastCalledWith(expect.objectContaining({ source: "call", muted: true }));
    });

    it("brings the call back to the state after a reconnect instead of drifting with it", async () => {
        const store = create();
        const send = obedientCall(store);
        store.handleCallReport(ROOM, report(false));
        store.perform("mute", "panel");
        await vi.advanceTimersByTimeAsync(VOICE_STATE_SETTLE_MS * 2);
        send.mockClear();

        // The connection goes, and the call comes back with its microphone on
        store.handleCallReport(ROOM, report(false, false, true));
        expect(store.state.muted).toBe(true);
        store.handleCallReport(ROOM, report(false, false, false));
        await vi.advanceTimersByTimeAsync(VOICE_STATE_SETTLE_MS * 2);
        expect(send.mock.calls).toEqual([[wire(true, false)]]);
        expect(store.state.muted).toBe(true);
        // No cue for any of that: the user's state never changed
        expect(playCue).toHaveBeenCalledTimes(1);
    });

    it("forgets a call that ended, and survives one that refuses the message", async () => {
        const store = create();
        const send = vi.fn().mockRejectedValue(new Error("Unknown or unsupported action"));
        const detach = store.attachCall(ROOM, send);
        store.handleCallReport(ROOM, report(false));
        store.perform("mute", "panel");
        await vi.advanceTimersByTimeAsync(0);
        expect(send).toHaveBeenCalledTimes(1);
        detach();
        store.perform("unmute", "panel");
        store.handleCallReport(ROOM, report(true));
        await vi.advanceTimersByTimeAsync(VOICE_STATE_SETTLE_MS * 2);
        expect(send).toHaveBeenCalledTimes(1);
        expect(store.state.muted).toBe(false);
    });
});
