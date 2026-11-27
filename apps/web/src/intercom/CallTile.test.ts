/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { describe, expect, it } from "vitest";

import {
    CALL_MERGE_WINDOW_MS,
    type CallFacts,
    type CallTileCandidate,
    type LegacyCallFacts,
    callTileOutcome,
    isActiveCallMembership,
    isSameCall,
    legacyCallTileOutcome,
    mergedCallTiles,
    summariseCall,
} from "./CallTile";

const T0 = 1_800_000_000_000;
const ADA = "@ada:example.org";
const BEN = "@ben:example.org";

const notification = (over: Partial<CallTileCandidate> = {}): CallTileCandidate => ({
    kind: "notification",
    roomId: "!room:example.org",
    sender: ADA,
    ts: T0,
    callId: "m.call#ROOM",
    ...over,
});

describe("isSameCall", () => {
    it("takes two announcements from one person in one room, seconds apart, for one call", () => {
        expect(isSameCall(notification(), notification({ ts: T0 + 6000 }))).toBe(true);
        expect(isSameCall(notification({ ts: T0 + 6000 }), notification())).toBe(true);
    });

    it("tells calls apart by room, by sender, by time and by the call they name", () => {
        expect(isSameCall(notification(), notification({ roomId: "!other:example.org" }))).toBe(false);
        expect(isSameCall(notification(), notification({ sender: BEN }))).toBe(false);
        expect(isSameCall(notification(), notification({ ts: T0 + CALL_MERGE_WINDOW_MS + 1 }))).toBe(false);
        expect(isSameCall(notification(), notification({ ts: T0 + CALL_MERGE_WINDOW_MS }))).toBe(true);
        expect(isSameCall(notification(), notification({ callId: "m.call#OTHER" }))).toBe(false);
    });

    it("goes by sender and time where an event does not name its call", () => {
        expect(isSameCall(notification({ callId: undefined }), notification({ ts: T0 + 1000 }))).toBe(true);
    });

    it("takes an announcement and the call's own event for one call, though they name it differently", () => {
        const call = notification({ kind: "call", callId: "abc", ts: T0 - 2000 });
        expect(isSameCall(call, notification())).toBe(true);
        expect(isSameCall(call, notification({ sender: BEN }))).toBe(false);
    });
});

describe("mergedCallTiles", () => {
    it("leaves a timeline without neighbouring calls alone", () => {
        expect(mergedCallTiles([])).toEqual(new Set());
        expect(mergedCallTiles([null, notification(), null])).toEqual(new Set());
    });

    it("shows a call announced twice once, on the later tile", () => {
        expect(mergedCallTiles([null, notification(), notification({ ts: T0 + 6000 }), null])).toEqual(new Set([1]));
    });

    it("keeps the last of three", () => {
        const rows = [notification(), notification({ ts: T0 + 5000 }), notification({ ts: T0 + 10_000 })];
        expect(mergedCallTiles(rows)).toEqual(new Set([0, 1]));
    });

    it("keeps the announcement of a call rather than the call's own event, whichever comes first", () => {
        const call = notification({ kind: "call", callId: "abc" });
        expect(mergedCallTiles([call, notification({ ts: T0 + 800 })])).toEqual(new Set([0]));
        expect(mergedCallTiles([notification(), { ...call, ts: T0 + 800 }])).toEqual(new Set([1]));
        // And goes on from the announcement
        expect(mergedCallTiles([notification(), { ...call, ts: T0 + 800 }, notification({ ts: T0 + 2000 })])).toEqual(
            new Set([1, 0]),
        );
    });

    it("does not merge across another row", () => {
        expect(mergedCallTiles([notification(), null, notification({ ts: T0 + 6000 })])).toEqual(new Set());
    });

    it("does not merge two calls: another caller, or the next call minutes later", () => {
        expect(mergedCallTiles([notification(), notification({ sender: BEN, ts: T0 + 6000 })])).toEqual(new Set());
        expect(mergedCallTiles([notification(), notification({ ts: T0 + 5 * 60_000 })])).toEqual(new Set());
    });

    it("measures from the tile that stays", () => {
        // Each 20 s after the one before: the chain is one call, though its ends are 40 s apart
        const rows = [notification(), notification({ ts: T0 + 20_000 }), notification({ ts: T0 + 40_000 })];
        expect(mergedCallTiles(rows)).toEqual(new Set([0, 1]));
    });
});

describe("isActiveCallMembership", () => {
    it("takes an empty content for having left", () => {
        expect(isActiveCallMembership(undefined)).toBe(false);
        expect(isActiveCallMembership({})).toBe(false);
        expect(isActiveCallMembership({ memberships: [] })).toBe(false);
    });

    it("takes a membership for being in the call", () => {
        expect(isActiveCallMembership({ application: "m.call", device_id: "D" })).toBe(true);
        expect(isActiveCallMembership({ memberships: [{ device_id: "D" }] })).toBe(true);
    });
});

describe("summariseCall", () => {
    const change = (
        ts: number,
        userId: string,
        joined: boolean,
        device = "D",
    ): Parameters<typeof summariseCall>[0][0] => ({
        ts,
        userId,
        key: `_${userId}_${device}`,
        joined,
    });

    it("ends the call when the last device has left", () => {
        expect(
            summariseCall([
                change(T0, ADA, true),
                change(T0 + 2000, BEN, true),
                change(T0 + 50_000, ADA, false),
                change(T0 + 60_000, BEN, false),
                // The next call
                change(T0 + 90_000, BEN, true),
            ]),
        ).toEqual({ endTs: T0 + 60_000, joinedUserIds: [ADA, BEN] });
    });

    it("knows no end while somebody is in the call, or as far as the history goes", () => {
        expect(
            summariseCall([change(T0, ADA, true), change(T0 + 2000, BEN, true), change(T0 + 3000, ADA, false)]),
        ).toEqual({ joinedUserIds: [ADA, BEN] });
        expect(summariseCall([])).toEqual({ joinedUserIds: [] });
    });

    it("counts a second device of the same person, and a membership that is renewed, once", () => {
        expect(
            summariseCall([
                change(T0, ADA, true),
                change(T0 + 1000, ADA, true, "E"),
                change(T0 + 2000, ADA, true),
                change(T0 + 3000, ADA, false),
                change(T0 + 6000, ADA, false, "E"),
            ]),
        ).toEqual({ endTs: T0 + 6000, joinedUserIds: [ADA] });
    });

    it("ignores somebody leaving who was not in the call", () => {
        expect(summariseCall([change(T0, BEN, false), change(T0 + 1000, ADA, true)])).toEqual({ joinedUserIds: [ADA] });
    });
});

describe("callTileOutcome", () => {
    const facts = (over: Partial<CallFacts> = {}): CallFacts => ({
        ongoing: false,
        outgoing: false,
        startedBy: ADA,
        ownUserId: BEN,
        ring: false,
        now: T0 + 5000,
        othersInCall: false,
        joined: false,
        canJoin: true,
        declined: false,
        startTs: T0,
        ...over,
    });

    it("lets the user join a running call", () => {
        expect(callTileOutcome(facts({ ongoing: true }))).toEqual({
            state: "ongoing",
            buttons: ["join"],
            disabledButtons: [],
        });
    });

    it("does not let them join where they may not", () => {
        expect(callTileOutcome(facts({ ongoing: true, canJoin: false })).disabledButtons).toEqual(["join"]);
    });

    it("lets them leave the call they are in, but not twice", () => {
        expect(callTileOutcome(facts({ ongoing: true, joined: true }))).toEqual({
            state: "ongoing",
            buttons: ["leave"],
            disabledButtons: [],
        });
        expect(callTileOutcome(facts({ ongoing: true, joined: true, leaving: true })).disabledButtons).toEqual([
            "leave",
        ]);
    });

    it("rings while a call to one person waits to be picked up", () => {
        const ringing = facts({ ongoing: true, ring: true, ringUntil: T0 + 30_000 });
        expect(callTileOutcome(ringing).state).toBe("ringing");
        expect(callTileOutcome(ringing).buttons).toEqual(["join"]);
        // The caller's own tile rings too, and they can hang up
        expect(callTileOutcome({ ...ringing, outgoing: true, joined: true })).toEqual({
            state: "ringing",
            buttons: ["leave"],
            disabledButtons: [],
        });
    });

    it("stops ringing when it is picked up, when it has rung out, and when it was declined", () => {
        const ringing = facts({ ongoing: true, ring: true, ringUntil: T0 + 30_000 });
        expect(callTileOutcome({ ...ringing, othersInCall: true }).state).toBe("ongoing");
        expect(callTileOutcome({ ...ringing, now: T0 + 30_000 }).state).toBe("ongoing");
        expect(callTileOutcome({ ...ringing, declined: true }).state).toBe("ongoing");
        expect(callTileOutcome({ ...ringing, ringUntil: undefined }).state).toBe("ongoing");
    });

    it("says how long a call took that is over", () => {
        const summary = { endTs: T0 + 6000, joinedUserIds: [ADA, BEN] };
        expect(callTileOutcome(facts({ summary }))).toEqual({
            state: "ended",
            durationMs: 6000,
            buttons: [],
            disabledButtons: [],
        });
        expect(callTileOutcome(facts({ ring: true, summary })).state).toBe("ended");
    });

    it("says only that a call is over where the history does not show its end", () => {
        expect(callTileOutcome(facts())).toEqual({ state: "ended", buttons: [], disabledButtons: [] });
        expect(callTileOutcome(facts({ ring: true, summary: { joinedUserIds: [ADA] } })).state).toBe("ended");
        // An end before the start is the clocks, not a length
        expect(callTileOutcome(facts({ summary: { endTs: T0 - 10, joinedUserIds: [ADA, BEN] } })).durationMs).toBe(
            undefined,
        );
    });

    it("calls a call that rang and nobody picked up missed, and offers to call back", () => {
        const summary = { endTs: T0 + 30_000, joinedUserIds: [ADA] };
        expect(callTileOutcome(facts({ ring: true, summary }))).toEqual({
            state: "missed",
            buttons: ["call_back"],
            disabledButtons: [],
        });
        // The caller's own tile: nobody answered, and there is nobody to call back
        expect(callTileOutcome(facts({ ring: true, summary, outgoing: true, ownUserId: ADA }))).toEqual({
            state: "missed",
            buttons: [],
            disabledButtons: [],
        });
    });

    it("does not call a call in a room missed that nobody else joined: it did not ring", () => {
        const outcome = callTileOutcome(facts({ summary: { endTs: T0 + 30_000, joinedUserIds: [ADA] } }));
        expect(outcome).toEqual({ state: "ended", durationMs: 30_000, buttons: [], disabledButtons: [] });
    });

    it("says that a call was declined", () => {
        expect(callTileOutcome(facts({ ring: true, declined: true })).state).toBe("declined");
        const summary = { endTs: T0 + 9000, joinedUserIds: [ADA] };
        expect(callTileOutcome(facts({ ring: true, declined: true, summary }))).toEqual({
            state: "declined",
            buttons: [],
            disabledButtons: [],
        });
    });
});

describe("legacyCallTileOutcome", () => {
    const facts = (over: Partial<LegacyCallFacts> = {}): LegacyCallFacts => ({
        phase: "ended",
        outgoing: false,
        rejected: false,
        missed: false,
        hangupReason: null,
        durationMs: null,
        connectedSeconds: 0,
        now: T0,
        ...over,
    });

    it("offers both answers while it rings", () => {
        expect(legacyCallTileOutcome(facts({ phase: "ringing" }))).toEqual({
            state: "ringing",
            joined: false,
            buttons: ["decline", "accept"],
        });
    });

    it("says that it connects", () => {
        expect(legacyCallTileOutcome(facts({ phase: "connecting" }))).toMatchObject({
            state: "ringing",
            note: "connecting",
            buttons: [],
        });
    });

    it("counts a connected call from when it connected", () => {
        expect(legacyCallTileOutcome(facts({ phase: "connected", connectedSeconds: 42 }))).toEqual({
            state: "ongoing",
            joined: true,
            buttons: [],
            startedAt: T0 - 42_000,
        });
    });

    it("says how long a call took that was hung up", () => {
        for (const hangupReason of [null, "user_hangup", "user hangup"]) {
            expect(legacyCallTileOutcome(facts({ hangupReason, durationMs: 6000 }))).toMatchObject({
                state: "ended",
                durationMs: 6000,
                buttons: [],
            });
        }
        expect(legacyCallTileOutcome(facts()).durationMs).toBe(undefined);
    });

    it("offers to call back after a call that was declined, missed or not answered", () => {
        expect(legacyCallTileOutcome(facts({ rejected: true }))).toMatchObject({
            state: "declined",
            buttons: ["call_back"],
        });
        expect(legacyCallTileOutcome(facts({ missed: true }))).toMatchObject({
            state: "missed",
            buttons: ["call_back"],
        });
        expect(legacyCallTileOutcome(facts({ outgoing: true, hangupReason: "invite_timeout" }))).toMatchObject({
            state: "missed",
            buttons: ["call_back"],
        });
    });

    it("says that it was answered on another device, rather than missed", () => {
        expect(legacyCallTileOutcome(facts({ missed: true, hangupReason: "answered_elsewhere" }))).toMatchObject({
            state: "ended",
            note: "answered_elsewhere",
            buttons: [],
        });
    });

    it("says that a call failed, and offers to try again", () => {
        expect(legacyCallTileOutcome(facts({ hangupReason: "ice_failed" }))).toMatchObject({
            state: "ended",
            note: "failed",
            buttons: ["call_back"],
        });
    });

    it("says so when it does not know where the call is", () => {
        expect(legacyCallTileOutcome(facts({ phase: undefined }))).toMatchObject({ state: "ended", note: "unknown" });
    });
});
