/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { EventType, type MatrixEvent, NotificationCountType, Room } from "matrix-js-sdk/src/matrix";
import { createTestClient, mkEvent, mkMessage } from "test-utils";

import { countUnreadAfter, formatUnreadSince, unreadSinceReadMarker } from "./UnreadSince";
import { formatDate } from "../DateUtils";

const ROOM_ID = "!room:example.org";
const ME = "@nora:example.org";
const SAM = "@sam:example.org";

const client = createTestClient();
vi.mocked(client.getSafeUserId).mockReturnValue(ME);
const room = new Room(ROOM_ID, client, ME);
const message = (id: string, user: string, ts: number): MatrixEvent =>
    mkMessage({ room: ROOM_ID, user, msg: `message ${id}`, event: true, id, ts });

const events = [
    message("$read", SAM, 1000),
    message("$mine", ME, 2000),
    mkEvent({
        type: EventType.RoomMember,
        room: ROOM_ID,
        user: SAM,
        skey: SAM,
        content: { membership: "join" },
        event: true,
        ts: 2500,
    }),
    message("$first", SAM, 3000),
    message("$second", SAM, 4000),
];

describe("unreadSinceReadMarker", () => {
    it("is null without a read marker", () => {
        expect(unreadSinceReadMarker(client, room, events, null)).toBeNull();
    });

    it("counts the messages of others after the marker, and when the first was sent", () => {
        // Neither our own message nor a membership change is unread
        expect(unreadSinceReadMarker(client, room, events, "$read")).toEqual({ count: 2, since: 3000 });
    });

    it("counts nothing after the last message", () => {
        expect(unreadSinceReadMarker(client, room, events, "$second")).toEqual({ count: 0, since: null });
    });

    it("takes the server's count and the marker's time when the marker is not loaded", () => {
        room.setUnreadNotificationCount(NotificationCountType.Total, 31);
        expect(unreadSinceReadMarker(client, room, events, "$older", 500)).toEqual({ count: 31, since: 500 });
    });

    it("does not know the count when the server has none either", () => {
        room.setUnreadNotificationCount(NotificationCountType.Total, 0);
        expect(unreadSinceReadMarker(client, room, events, "$older")).toEqual({ count: null, since: null });
    });
});

describe("countUnreadAfter", () => {
    it("counts the messages of others after an index", () => {
        expect(countUnreadAfter(client, events, 0)).toBe(2);
        expect(countUnreadAfter(client, events, 3)).toBe(1);
        expect(countUnreadAfter(client, events, events.length - 1)).toBe(0);
    });

    it("counts them all from before the first", () => {
        expect(countUnreadAfter(client, events, -1)).toBe(3);
    });
});

describe("formatUnreadSince", () => {
    it("formats a time as the timeline's dates do", () => {
        const ts = new Date("2026-11-27T14:32:00").getTime();
        expect(formatUnreadSince(ts, false)).toBe(formatDate(new Date(ts), false));
    });

    it("is null without a time", () => {
        expect(formatUnreadSince(null, true)).toBeNull();
    });
});
