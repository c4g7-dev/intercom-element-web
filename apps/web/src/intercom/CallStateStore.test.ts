/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// oxlint-disable element-web/require-test-teardown -- the stores here are emitters made per test, with nothing to release

import { describe, expect, it, vi } from "vitest";
import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";
import { type ClientWidgetApi } from "matrix-widget-api";

import {
    attachCallStateBridge,
    CALL_STATE_WIDGET_ACTION,
    CallStateStore,
    CallStateStoreEvent,
    parseCallState,
} from "./CallStateStore";
import { VOICE_STATE_WIDGET_ACTION, VoiceStateStore } from "./VoiceStateStore";

/** A plain emitter, standing in for the stores and objects the code under test listens to. */
class Emitter extends TypedEventEmitter<string, Record<string, (...args: unknown[]) => void>> {}

describe("parseCallState", () => {
    it("reads what the call sends", () => {
        const state = parseCallState({
            audio_enabled: true,
            video_enabled: false,
            deafened: true,
            screen_sharing: true,
            reconnecting: false,
            participants: [
                { user_id: "@ada:x", local: true, speaking: true, audio_enabled: true, screen_sharing: false },
                { user_id: "@ben:x", speaking: false, audio_enabled: false, screen_sharing: true },
            ],
        });
        expect(state).toMatchObject({ audioEnabled: true, videoEnabled: false, deafened: true, screenSharing: true });
        expect([...state.participants.values()]).toEqual([
            { userId: "@ada:x", speaking: true, audioEnabled: true, screenSharing: false },
            { userId: "@ben:x", speaking: false, audioEnabled: false, screenSharing: true },
        ]);
    });

    it.each([undefined, null, "x", 3, {}, { participants: "no" }, { participants: [null, {}, { user_id: 3 }] }])(
        "takes %j for a call in which everything is off",
        (data) => {
            const state = parseCallState(data);
            expect(state).toMatchObject({ audioEnabled: false, deafened: false, screenSharing: false });
            expect(state.participants.size).toBe(0);
        },
    );
});

describe("CallStateStore", () => {
    it("keeps the state by room and tells when it changes or goes", () => {
        const store = new CallStateStore();
        const onUpdate = vi.fn();
        store.on(CallStateStoreEvent.Update, onUpdate);

        expect(store.getState("!a:x")).toBeUndefined();
        const state = parseCallState({ audio_enabled: true });
        store.setState("!a:x", state);
        expect(store.getState("!a:x")).toBe(state);
        expect(store.getState("!b:x")).toBeUndefined();
        store.clear("!a:x");
        expect(store.getState("!a:x")).toBeUndefined();
        expect(onUpdate.mock.calls).toEqual([["!a:x"], ["!a:x"]]);
        // Nothing to forget, nothing to tell
        store.clear("!a:x");
        expect(onUpdate).toHaveBeenCalledTimes(2);
    });
});

describe("attachCallStateBridge", () => {
    function widgetApi(): ClientWidgetApi & { reply: ReturnType<typeof vi.fn> } {
        const api = new Emitter() as unknown as ClientWidgetApi & { reply: ReturnType<typeof vi.fn> };
        api.reply = vi.fn();
        (api as unknown as { transport: object }).transport = {
            reply: api.reply,
            send: vi.fn().mockResolvedValue({}),
        };
        return api;
    }
    const voiceStore = (): VoiceStateStore =>
        new VoiceStateStore({ storage: { getItem: () => null, setItem: () => {} }, playCue: () => {}, log: () => {} });

    it("stores what the widget sends, answers it, and forgets it when detached", () => {
        const store = new CallStateStore();
        const api = widgetApi();
        const detach = attachCallStateBridge(api, "!a:x", store, voiceStore());

        const preventDefault = vi.fn();
        const detail = { data: { deafened: true, participants: [{ user_id: "@ada:x", speaking: true }] } };
        api.emit(`action:${CALL_STATE_WIDGET_ACTION}`, { preventDefault, detail });

        expect(preventDefault).toHaveBeenCalled();
        expect(api.reply).toHaveBeenCalledWith(detail, {});
        expect(store.getState("!a:x")?.deafened).toBe(true);
        expect(store.getState("!a:x")?.participants.get("@ada:x")?.speaking).toBe(true);

        detach();
        expect(store.getState("!a:x")).toBeUndefined();
        api.emit(`action:${CALL_STATE_WIDGET_ACTION}`, { preventDefault, detail });
        expect(store.getState("!a:x")).toBeUndefined();
    });

    it("does nothing for a widget that belongs to no room", () => {
        const store = new CallStateStore();
        const api = widgetApi();
        attachCallStateBridge(api, undefined, store, voiceStore())();
        expect(api.listenerCount(`action:${CALL_STATE_WIDGET_ACTION}`)).toBe(0);
    });

    it("gives the call the user's mute and deafen when it asks, and takes over what the call then does", async () => {
        vi.useFakeTimers();
        try {
            const voice = voiceStore();
            voice.perform("mute", "panel");
            const api = widgetApi();
            const send = (api as unknown as { transport: { send: ReturnType<typeof vi.fn> } }).transport.send;
            const detach = attachCallStateBridge(api, "!a:x", new CallStateStore(), voice);

            // Joined: the call asks, and is answered with the state to take
            const request = { data: {} };
            api.emit(`action:${VOICE_STATE_WIDGET_ACTION}`, { preventDefault: vi.fn(), detail: request });
            expect(api.reply).toHaveBeenCalledWith(request, {
                muted: true,
                deafened: false,
                muted_before_deafen: false,
            });

            const report = (data: object): void => {
                api.emit(`action:${CALL_STATE_WIDGET_ACTION}`, { preventDefault: vi.fn(), detail: { data } });
            };
            report({ audio_enabled: false });
            expect(voice.state.muted).toBe(true);

            // A change in the app goes to the call
            voice.perform("unmute", "hotkey");
            await vi.advanceTimersByTimeAsync(0);
            expect(send).toHaveBeenLastCalledWith(VOICE_STATE_WIDGET_ACTION, {
                muted: false,
                deafened: false,
                muted_before_deafen: false,
            });
            report({ audio_enabled: true });

            // The call's own deafen button comes back as the app's state, and is not sent back to the call
            send.mockClear();
            await vi.advanceTimersByTimeAsync(5000);
            report({ audio_enabled: false, deafened: true });
            expect(voice.state).toEqual({ muted: true, deafened: true, mutedBeforeDeafen: false });
            await vi.advanceTimersByTimeAsync(0);
            expect(send).not.toHaveBeenCalled();

            detach();
            expect(api.listenerCount(`action:${VOICE_STATE_WIDGET_ACTION}`)).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});
