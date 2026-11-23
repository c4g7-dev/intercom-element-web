/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// oxlint-disable element-web/require-test-teardown -- the stores here are emitters made per test, with nothing to release

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Room, type RoomMember, TypedEventEmitter } from "matrix-js-sdk/src/matrix";

import { JOIN_MARK_MS, LEAVE_LINGER_MS, VoiceChannelViewModel } from "./VoiceChannelViewModel";
import { type CallStore, CallStoreEvent } from "../../stores/CallStore";
import { type Call, CallEvent } from "../../models/Call";
import { CallStateStore, CallStateStoreEvent, parseCallState } from "../../intercom/CallStateStore";
import dispatcher from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";

/** A plain emitter, standing in for the stores and objects the code under test listens to. */
class Emitter extends TypedEventEmitter<string, Record<string, (...args: unknown[]) => void>> {}

vi.mock("../../stores/CallStore", () => ({
    CallStore: { instance: undefined },
    CallStoreEvent: { Call: "call", ConnectedCalls: "connected_calls" },
}));
// The call model pulls the whole call stack in; only its event names are needed here
vi.mock("../../models/Call", () => ({
    CallEvent: { Participants: "participants", ConnectionState: "connection_state" },
}));
vi.mock("../../customisations/Media", () => ({
    mediaFromMxc: (mxc: string) => ({
        getSquareThumbnailHttp: (size: number) => `http://media/${mxc.slice(6)}?s=${size}`,
    }),
}));

const ROOM = "!voice:x";
const ME = "@ada:x";

function member(userId: string, name: string, avatar?: string): RoomMember {
    return { userId, name, getMxcAvatarUrl: () => avatar } as unknown as RoomMember;
}

class FakeCall extends Emitter {
    public connected = false;
    public participants = new Map<RoomMember, Set<string>>();
    public setParticipants(members: RoomMember[]): void {
        this.participants = new Map(members.map((m) => [m, new Set(["DEVICE"])]));
        this.emit(CallEvent.Participants, this.participants, new Map());
    }
}

class FakeCallStore extends Emitter {
    public call: FakeCall | null = null;
    public getCall = (roomId: string): Call | null => (roomId === ROOM ? (this.call as unknown as Call) : null);
}

describe("VoiceChannelViewModel", () => {
    const room = { roomId: ROOM, name: "Lounge" } as unknown as Room;
    const ada = member(ME, "Ada", "mxc://x/ada");
    const ben = member("@ben:x", "Ben");
    const cy = member("@cy:x", "");
    let callStore: FakeCallStore;
    let callStateStore: CallStateStore;
    let call: FakeCall;

    const create = (): VoiceChannelViewModel =>
        new VoiceChannelViewModel({ room, userId: ME, callStore: callStore as unknown as CallStore, callStateStore });

    beforeEach(() => {
        callStore = new FakeCallStore();
        callStateStore = new CallStateStore();
        call = new FakeCall();
    });

    it("is empty while the room has no call or nobody is in it", () => {
        const vm = create();
        expect(vm.getSnapshot()).toEqual({ roomName: "Lounge", participants: [] });
        callStore.call = call;
        callStore.emit(CallStoreEvent.Call, call, ROOM);
        expect(vm.getSnapshot().participants).toEqual([]);
    });

    it("lists who is in the call by name, also while the user is not in it", () => {
        callStore.call = call;
        call.participants = new Map([
            [cy, new Set(["D"])],
            [ben, new Set(["D"])],
            [ada, new Set(["D"])],
        ]);
        const vm = create();
        expect(vm.getSnapshot().participants).toEqual([
            // Somebody without a name is listed under their ID
            {
                id: "@cy:x",
                name: "@cy:x",
                avatarUrl: undefined,
                speaking: false,
                muted: false,
                deafened: false,
                live: false,
            },
            {
                id: "@ada:x",
                name: "Ada",
                avatarUrl: "http://media/x/ada?s=24",
                speaking: false,
                muted: false,
                deafened: false,
                live: false,
            },
            {
                id: "@ben:x",
                name: "Ben",
                avatarUrl: undefined,
                speaking: false,
                muted: false,
                deafened: false,
                live: false,
            },
        ]);
    });

    it("follows people joining and leaving, and a call that appears later", () => {
        const vm = create();
        const listener = vi.fn();
        vm.subscribe(listener);

        callStore.call = call;
        callStore.emit(CallStoreEvent.Call, call, ROOM);
        call.setParticipants([ben]);
        expect(vm.getSnapshot().participants.map((p) => p.id)).toEqual(["@ben:x"]);
        call.setParticipants([ben, ada]);
        expect(vm.getSnapshot().participants.map((p) => p.id)).toEqual(["@ada:x", "@ben:x"]);
        call.setParticipants([]);
        // Who left is listed a moment longer (see "coming and going")
        expect(vm.getSnapshot().participants.map((p) => p.transition)).toEqual(["leaving", "leaving"]);
        expect(listener).toHaveBeenCalledTimes(3);
        vm.dispose();
    });

    it("shows who speaks, is muted, deafened or shares once the user is in the call", () => {
        callStore.call = call;
        call.participants = new Map([
            [ada, new Set(["D"])],
            [ben, new Set(["D"])],
        ]);
        const vm = create();
        const told = parseCallState({
            deafened: true,
            participants: [
                { user_id: ME, speaking: false, audio_enabled: false, screen_sharing: false },
                { user_id: "@ben:x", speaking: true, audio_enabled: true, screen_sharing: true },
            ],
        });

        // Told, but the user is not in the call (any more): it says nothing
        callStateStore.setState(ROOM, told);
        expect(vm.getSnapshot().participants.every((p) => !p.speaking && !p.muted && !p.live)).toBe(true);

        call.connected = true;
        call.emit(CallEvent.ConnectionState, "connected", "disconnected");
        expect(vm.getSnapshot().participants).toEqual([
            expect.objectContaining({ id: ME, speaking: false, muted: true, deafened: true, live: false }),
            // Only the user's own deafening is known
            expect.objectContaining({ id: "@ben:x", speaking: true, muted: false, deafened: false, live: true }),
        ]);

        // The state of another room's call is none of this one's
        const listener = vi.fn();
        vm.subscribe(listener);
        callStateStore.setState("!other:x", told);
        // And the same state again is nothing new
        callStateStore.setState(ROOM, told);
        expect(listener).not.toHaveBeenCalled();

        callStateStore.clear(ROOM);
        expect(vm.getSnapshot().participants.every((p) => !p.speaking && !p.muted && !p.live)).toBe(true);
    });

    describe("coming and going", () => {
        const transitions = (vm: VoiceChannelViewModel): Record<string, string | undefined> =>
            Object.fromEntries(vm.getSnapshot().participants.map((p) => [p.name, p.transition]));

        beforeEach(() => {
            vi.useFakeTimers();
            callStore.call = call;
            call.participants = new Map([[ada, new Set(["D"])]]);
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it("does not mark who is in the call when the list is first shown", () => {
            const vm = create();
            expect(transitions(vm)).toEqual({ Ada: undefined });
            vm.dispose();
        });

        it("marks somebody who joins for a moment", () => {
            const vm = create();
            call.setParticipants([ada, ben]);
            expect(transitions(vm)).toEqual({ Ada: undefined, Ben: "joining" });

            vi.advanceTimersByTime(JOIN_MARK_MS - 1);
            expect(transitions(vm)).toEqual({ Ada: undefined, Ben: "joining" });
            vi.advanceTimersByTime(1);
            expect(transitions(vm)).toEqual({ Ada: undefined, Ben: undefined });
            vm.dispose();
        });

        it("keeps somebody who left for a moment, as leaving, then drops them", () => {
            call.participants = new Map([
                [ada, new Set(["D"])],
                [ben, new Set(["D"])],
            ]);
            const vm = create();
            call.setParticipants([ada]);
            expect(transitions(vm)).toEqual({ Ada: undefined, Ben: "leaving" });

            vi.advanceTimersByTime(LEAVE_LINGER_MS - 1);
            expect(transitions(vm)).toEqual({ Ada: undefined, Ben: "leaving" });
            vi.advanceTimersByTime(1);
            expect(transitions(vm)).toEqual({ Ada: undefined });
            vm.dispose();
        });

        it("shows the last one to leave until their moment is over", () => {
            const vm = create();
            call.setParticipants([]);
            expect(transitions(vm)).toEqual({ Ada: "leaving" });
            vi.advanceTimersByTime(LEAVE_LINGER_MS);
            expect(vm.getSnapshot().participants).toEqual([]);
            vm.dispose();
        });

        it("does not show somebody who left as speaking or sharing", () => {
            call.participants = new Map([
                [ada, new Set(["D"])],
                [ben, new Set(["D"])],
            ]);
            call.connected = true;
            callStateStore.setState(
                ROOM,
                parseCallState({
                    audio_enabled: true,
                    video_enabled: false,
                    deafened: false,
                    screen_sharing: false,
                    reconnecting: false,
                    participants: [{ user_id: "@ben:x", speaking: true, audio_enabled: true, screen_sharing: true }],
                })!,
            );
            const vm = create();
            expect(vm.getSnapshot().participants.find((p) => p.id === "@ben:x")).toMatchObject({
                speaking: true,
                live: true,
            });
            call.setParticipants([ada]);
            expect(vm.getSnapshot().participants.find((p) => p.id === "@ben:x")).toMatchObject({
                transition: "leaving",
                speaking: false,
                live: false,
            });
            vm.dispose();
        });

        it("takes somebody who comes back at once as having joined", () => {
            call.participants = new Map([
                [ada, new Set(["D"])],
                [ben, new Set(["D"])],
            ]);
            const vm = create();
            call.setParticipants([ada]);
            vi.advanceTimersByTime(500);
            call.setParticipants([ada, ben]);
            expect(transitions(vm)).toEqual({ Ada: undefined, Ben: "joining" });
            // The timer of their leaving is gone with it
            vi.advanceTimersByTime(LEAVE_LINGER_MS);
            expect(transitions(vm)).toEqual({ Ada: undefined, Ben: undefined });
            vm.dispose();
        });

        it("drops its timers when disposed", () => {
            const vm = create();
            call.setParticipants([ben]);
            expect(vi.getTimerCount()).toBe(2);
            vm.dispose();
            expect(vi.getTimerCount()).toBe(0);
        });
    });

    it("joins without the lobby when clicked", () => {
        const dispatch = vi.spyOn(dispatcher, "dispatch").mockImplementation(() => {});
        create().onJoin();
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewRoom, room_id: ROOM, view_call: true, skipLobby: true }),
        );
        dispatch.mockRestore();
    });

    it("stops listening when disposed", () => {
        callStore.call = call;
        const vm = create();
        vm.dispose();
        expect(callStore.listenerCount(CallStoreEvent.Call)).toBe(0);
        expect(call.listenerCount(CallEvent.Participants)).toBe(0);
        expect(call.listenerCount(CallEvent.ConnectionState)).toBe(0);
        expect(callStateStore.listenerCount(CallStateStoreEvent.Update)).toBe(0);
    });
});
