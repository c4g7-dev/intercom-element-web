/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    EventType,
    type MatrixClient,
    type MatrixEvent,
    MatrixEventEvent,
    type Room,
    RoomEvent,
} from "matrix-js-sdk/src/matrix";
import { CallType } from "matrix-js-sdk/src/webrtc/call";
import { mkEvent, mkRoomMember, stubClient, tearDownAfterTest } from "test-utils";

import { CallEventTileViewModel, summariseCallOf } from "./CallEventTileViewModel";
import { CallEvent, ConnectionState } from "../../models/Call";
import { type CallStore, CallStoreEvent } from "../../stores/CallStore";
import {
    type LatestRtcNotificationEventStore,
    LatestRtcNotificationEventUpdate,
} from "../../stores/LatestRtcNotificationEventStore";
import type LegacyCallHandler from "../../LegacyCallHandler";
import { placeCall } from "../../utils/room/placeCall";
import { PlatformCallType } from "../../hooks/room/useRoomCall";

vi.mock("../../utils/room/placeCall", () => ({ placeCall: vi.fn() }));

const ROOM = "!room:example.org";
const ADA = "@ada:example.org";
const BEN = "@ben:example.org";
const T0 = 1_800_000_000_000;

class FakeCall extends EventEmitter {
    public participants = new Map([[mkRoomMember(ROOM, ADA), new Set(["D"])]]);
    public connectionState = ConnectionState.Disconnected;
    public session = { memberships: [{ createdTs: (): number => T0 - 1000 }] };
    public disconnect = vi.fn().mockResolvedValue(undefined);

    public get connected(): boolean {
        return this.connectionState !== ConnectionState.Disconnected;
    }

    public join(userId: string): void {
        this.participants = new Map([...this.participants, [mkRoomMember(ROOM, userId), new Set(["D"])]]);
        this.emit(CallEvent.Participants, this.participants);
    }

    public connect(state: ConnectionState): void {
        this.connectionState = state;
        this.emit(CallEvent.ConnectionState, state);
    }
}

class FakeRoom extends EventEmitter {
    public events: MatrixEvent[] = [];
    public maySend = true;
    public getLiveTimeline = (): unknown => ({
        getState: () => ({ mayClientSendStateEvent: () => this.maySend }),
    });
    public getTimelineForEvent = (eventId: string): unknown =>
        this.events.some((event) => event.getId() === eventId) ? { getEvents: () => this.events } : null;
}

function membership(userId: string, ts: number, joined: boolean, id?: string): MatrixEvent {
    return mkEvent({
        type: EventType.GroupCallMemberPrefix,
        id,
        room: ROOM,
        user: userId,
        skey: `_${userId}_D`,
        content: joined ? { application: "m.call", device_id: "D" } : {},
        ts,
        event: true,
    });
}

function notification(sender: string, content: Record<string, unknown> = {}): MatrixEvent {
    return mkEvent({
        type: EventType.RTCNotification,
        id: "$notification",
        room: ROOM,
        user: sender,
        content: {
            "m.call.intent": "audio",
            "notification_type": "notification",
            "sender_ts": T0,
            "lifetime": 30_000,
            "m.relates_to": { rel_type: "m.reference", event_id: "$membership" },
            ...content,
        },
        ts: T0,
        event: true,
    });
}

describe("CallEventTileViewModel", () => {
    let cli: MatrixClient;
    let room: FakeRoom;
    let call: FakeCall | null;
    let callStore: EventEmitter & { getCall: () => FakeCall | null };
    let latest: EventEmitter & { getLatestEventId: () => string | undefined };
    let latestId: string | undefined;
    const legacyCallHandler = {} as LegacyCallHandler;

    const create = (mxEvent: MatrixEvent, getRelationsForEvent = vi.fn()): CallEventTileViewModel =>
        tearDownAfterTest(
            new CallEventTileViewModel({
                mxEvent,
                getRelationsForEvent,
                cli,
                callStore: callStore as unknown as CallStore,
                latestRtcNotificationEventStore: latest as unknown as LatestRtcNotificationEventStore,
                legacyCallHandler,
            }),
        );

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(T0 + 5000);
        cli = stubClient();
        vi.mocked(cli.getUserId).mockReturnValue(BEN);
        vi.mocked(cli.getSafeUserId).mockReturnValue(BEN);
        room = new FakeRoom();
        cli.getRoom = () => room as unknown as Room;
        call = new FakeCall();
        latestId = "$notification";
        callStore = Object.assign(new EventEmitter(), { getCall: () => call });
        latest = Object.assign(new EventEmitter(), { getLatestEventId: () => latestId });
        vi.mocked(placeCall).mockClear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("shows the running call: who started it, who is in it, since when, and a way in", () => {
        const vm = create(notification(ADA));

        expect(vm.getSnapshot()).toMatchObject({
            state: "ongoing",
            video: false,
            outgoing: false,
            startedByName: ADA,
            participants: [{ id: ADA }],
            startedAt: T0 - 1000,
            joined: false,
            buttons: ["join"],
            disabledButtons: [],
        });
    });

    it("follows who joins, and the user joining and leaving", () => {
        const vm = create(notification(ADA));

        call!.join(BEN);
        expect(vm.getSnapshot().participants.map((person) => person.id)).toEqual([ADA, BEN]);

        call!.connect(ConnectionState.Connected);
        expect(vm.getSnapshot()).toMatchObject({ joined: true, buttons: ["leave"], disabledButtons: [] });

        call!.connect(ConnectionState.Disconnecting);
        expect(vm.getSnapshot()).toMatchObject({ joined: true, buttons: ["leave"], disabledButtons: ["leave"] });

        call!.connect(ConnectionState.Disconnected);
        expect(vm.getSnapshot()).toMatchObject({ joined: false, buttons: ["join"] });
    });

    it("joins the way the room's call button does, and leaves by disconnecting the call", () => {
        const vm = create(notification(ADA));

        vm.onButton("join");
        expect(placeCall).toHaveBeenCalledWith(
            legacyCallHandler,
            room,
            CallType.Voice,
            PlatformCallType.ElementCall,
            undefined,
            true,
        );

        vm.onButton("leave");
        expect(call!.disconnect).toHaveBeenCalled();
    });

    it("joins a video call as a video call", () => {
        const vm = create(notification(ADA, { "m.call.intent": "video" }));
        expect(vm.getSnapshot().video).toBe(true);

        vm.onButton("join");

        expect(placeCall).toHaveBeenCalledWith(
            legacyCallHandler,
            room,
            CallType.Video,
            PlatformCallType.ElementCall,
            undefined,
            false,
        );
    });

    it("does not let the user join where they may not", () => {
        room.maySend = false;
        expect(create(notification(ADA)).getSnapshot().disabledButtons).toEqual(["join"]);
    });

    it("rings until the call is picked up", () => {
        const vm = create(notification(ADA, { notification_type: "ring" }));
        expect(vm.getSnapshot().state).toBe("ringing");

        call!.join(BEN);

        expect(vm.getSnapshot().state).toBe("ongoing");
    });

    it("stops ringing by itself when the notification has rung out", () => {
        const vm = create(notification(ADA, { notification_type: "ring" }));
        expect(vm.getSnapshot().state).toBe("ringing");

        vi.advanceTimersByTime(26_000);

        expect(vm.getSnapshot().state).toBe("ongoing");
    });

    it("is the tile of the running call only if the notification is that call's", () => {
        latestId = "$another";
        const vm = create(notification(ADA));
        expect(vm.getSnapshot()).toMatchObject({ state: "ended", participants: [], buttons: [] });

        latestId = "$notification";
        latest.emit(LatestRtcNotificationEventUpdate, ROOM, "$notification");

        expect(vm.getSnapshot().state).toBe("ongoing");
    });

    it("takes the user's own notification the server has not confirmed yet for the running call's", () => {
        latestId = undefined;
        const mxEvent = notification(BEN);
        mxEvent.getId = () => "~local";
        expect(create(mxEvent).getSnapshot()).toMatchObject({ state: "ongoing", outgoing: true });
    });

    it("says how long the call took when it is over", () => {
        room.events = [
            membership(ADA, T0 - 500, true, "$membership"),
            notification(ADA),
            membership(BEN, T0 + 2000, true),
        ];
        const vm = create(notification(ADA));
        expect(vm.getSnapshot().state).toBe("ongoing");

        // Both leave, and the call is gone from the room
        room.events.push(membership(BEN, T0 + 5000, false), membership(ADA, T0 + 5500, false));
        call = null;
        callStore.emit(CallStoreEvent.Call, null, ROOM);

        expect(vm.getSnapshot()).toMatchObject({
            state: "ended",
            durationMs: 6000,
            participants: [],
            startedAt: undefined,
            joined: false,
            buttons: [],
        });
    });

    it("learns of the end from the room's history when that comes after the call is gone", () => {
        room.events = [membership(ADA, T0, true, "$membership"), membership(BEN, T0 + 2000, true)];
        call = null;
        const vm = create(notification(ADA));
        expect(vm.getSnapshot()).toMatchObject({ state: "ended", durationMs: undefined });

        const left = membership(ADA, T0 + 60_000, false);
        room.events.push(membership(BEN, T0 + 50_000, false), left);
        room.emit(RoomEvent.Timeline, left);

        expect(vm.getSnapshot()).toMatchObject({ state: "ended", durationMs: 60_000 });
    });

    it("calls a call missed that rang and nobody picked up, and calls back the way joining does", () => {
        room.events = [membership(ADA, T0, true, "$membership"), membership(ADA, T0 + 30_000, false)];
        call = null;
        const vm = create(notification(ADA, { notification_type: "ring" }));

        expect(vm.getSnapshot()).toMatchObject({ state: "missed", outgoing: false, buttons: ["call_back"] });

        vm.onButton("call_back");
        expect(placeCall).toHaveBeenCalledTimes(1);
    });

    it("says that the call was declined once somebody declines it", () => {
        call = null;
        const mxEvent = notification(ADA, { notification_type: "ring" });
        const getRelationsForEvent = vi.fn();
        const vm = create(mxEvent, getRelationsForEvent);
        expect(vm.getSnapshot().state).toBe("ended");

        getRelationsForEvent.mockReturnValue({
            getRelations: () => [mkEvent({ type: EventType.RTCDecline, user: BEN, content: {}, event: true })],
        });
        mxEvent.emit(MatrixEventEvent.RelationsCreated, "m.reference", EventType.RTCDecline);

        expect(vm.getSnapshot().state).toBe("declined");
    });

    it("ignores the calls of other rooms", () => {
        const vm = create(notification(ADA));
        const before = vm.getSnapshot();

        callStore.emit(CallStoreEvent.Call, null, "!other:example.org");

        expect(vm.getSnapshot()).toBe(before);
    });

    it("stops listening when it is disposed", () => {
        const vm = create(notification(ADA, { notification_type: "ring" }));
        vm.dispose();

        expect(call!.listenerCount(CallEvent.Participants)).toBe(0);
        expect(callStore.listenerCount(CallStoreEvent.Call)).toBe(0);
        expect(room.listenerCount(RoomEvent.Timeline)).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe("summariseCallOf", () => {
    it("tells nothing where the history does not hold the membership the call started with", () => {
        const room = new FakeRoom();
        room.events = [membership(ADA, T0, true, "$other")];
        expect(summariseCallOf(room as unknown as Room, notification(ADA))).toBeNull();
    });

    it("follows the memberships from the one the notification points at", () => {
        const room = new FakeRoom();
        room.events = [
            // An earlier call
            membership(BEN, T0 - 90_000, true),
            membership(BEN, T0 - 80_000, false),
            membership(ADA, T0, true, "$membership"),
            membership(ADA, T0 + 4000, false),
        ];
        expect(summariseCallOf(room as unknown as Room, notification(ADA))).toEqual({
            startTs: T0,
            summary: { endTs: T0 + 4000, joinedUserIds: [ADA] },
        });
    });
});
