/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// oxlint-disable element-web/require-test-teardown -- the stores here are emitters made per test, with nothing to release

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Room, type RoomMember, TypedEventEmitter } from "matrix-js-sdk/src/matrix";

import { VoiceChannelViewModel } from "./VoiceChannelViewModel";
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
        expect(vm.getSnapshot().participants).toEqual([]);
        expect(listener).toHaveBeenCalledTimes(3);
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
