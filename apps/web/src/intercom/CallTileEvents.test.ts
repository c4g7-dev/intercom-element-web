/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { EventType, type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { mkEvent, mkMessage } from "test-utils";

import { callTileCandidate, findMergedCallTiles } from "./CallTileEvents";

const ROOM = "!room:example.org";
const ADA = "@ada:example.org";
const T0 = 1_800_000_000_000;

const notification = (ts: number, user = ADA, slotId: unknown = "m.call#ROOM"): MatrixEvent =>
    mkEvent({
        type: EventType.RTCNotification,
        room: ROOM,
        user,
        content: { slot_id: slotId, notification_type: "ring" },
        ts,
        event: true,
    });
const message = (ts: number): MatrixEvent => mkMessage({ room: ROOM, user: ADA, msg: "hello", ts, event: true });
const shown = (event: MatrixEvent): { event: MatrixEvent; shouldShow: boolean } => ({ event, shouldShow: true });

describe("callTileCandidate", () => {
    it("reads what the merge rule needs from a call notification", () => {
        expect(callTileCandidate(notification(T0))).toEqual({
            kind: "notification",
            roomId: ROOM,
            sender: ADA,
            ts: T0,
            callId: "m.call#ROOM",
        });
        expect(callTileCandidate(notification(T0, ADA, 7))?.callId).toBeUndefined();
    });

    it("reads it from Element Call's call state event", () => {
        const call = mkEvent({
            type: EventType.GroupCallPrefix,
            room: ROOM,
            user: ADA,
            skey: "abc",
            content: { "m.intent": "m.prompt" },
            ts: T0,
            event: true,
        });
        expect(callTileCandidate(call)).toEqual({ kind: "call", roomId: ROOM, sender: ADA, ts: T0, callId: "abc" });
    });

    it("is nothing for a message, and for a call made the old way", () => {
        expect(callTileCandidate(message(T0))).toBeNull();
        const invite = mkEvent({
            type: EventType.CallInvite,
            room: ROOM,
            user: ADA,
            content: { call_id: "c" },
            event: true,
        });
        expect(callTileCandidate(invite)).toBeNull();
    });
});

describe("findMergedCallTiles", () => {
    it("leaves the earlier of two notifications of one call out", () => {
        const first = notification(T0);
        const second = notification(T0 + 6000);

        expect(findMergedCallTiles([shown(message(T0 - 1000)), shown(first), shown(second)])).toEqual(new Set([first]));
    });

    it("looks through events that have no row: they do not part the two", () => {
        const first = notification(T0);
        const second = notification(T0 + 6000);
        const hidden = { event: message(T0 + 1000), shouldShow: false };

        expect(findMergedCallTiles([shown(first), hidden, shown(second)])).toEqual(new Set([first]));
    });

    it("does not merge a notification that has no row itself", () => {
        const first = notification(T0);
        const second = notification(T0 + 6000);

        expect(findMergedCallTiles([{ event: first, shouldShow: false }, shown(second)])).toEqual(new Set());
    });

    it("keeps two calls apart: a message between them, or minutes", () => {
        expect(
            findMergedCallTiles([shown(notification(T0)), shown(message(T0 + 1000)), shown(notification(T0 + 6000))]),
        ).toEqual(new Set());
        expect(findMergedCallTiles([shown(notification(T0)), shown(notification(T0 + 600_000))])).toEqual(new Set());
    });
});
