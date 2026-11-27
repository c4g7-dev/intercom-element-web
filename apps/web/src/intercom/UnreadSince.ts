/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixClient, type MatrixEvent, NotificationCountType, type Room } from "matrix-js-sdk/src/matrix";

import { eventTriggersUnreadCount } from "../Unread";
import { formatDate } from "../DateUtils";

/** The unread messages after the read marker, for the bar at the top of the timeline. */
export interface UnreadSince {
    /** How many there are; null when that is not known */
    count: number | null;
    /** When the first of them was sent, or else when the last message read was, in ms; null when not known */
    since: number | null;
}

/**
 * The messages after the read marker that count as unread (from others, with a tile: see
 * {@link eventTriggersUnreadCount}), and when the first of them was sent.
 *
 * Counted in the loaded events when the marker is among them. When it is not (the reader came
 * back to a room with more unread than one load holds), the count is the server's count of unread
 * messages for the room, and the time that of the marker's event, where the client has it.
 *
 * @param client - the user's client, whose own messages are never unread
 * @param room - the room
 * @param events - the loaded events of the timeline, oldest first
 * @param markerEventId - the event the read marker is on; null when there is none
 * @param markerTs - when the marker's event was sent, if the caller knows better than the room
 * @returns null when there is no read marker
 */
export function unreadSinceReadMarker(
    client: MatrixClient,
    room: Room,
    events: readonly MatrixEvent[],
    markerEventId: string | null,
    markerTs?: number,
): UnreadSince | null {
    if (!markerEventId) return null;
    const index = events.findIndex((event) => event.getId() === markerEventId);
    if (index >= 0) {
        let count = 0;
        let since: number | null = null;
        for (const event of events.slice(index + 1)) {
            if (!eventTriggersUnreadCount(client, event)) continue;
            count++;
            since ??= event.getTs();
        }
        return { count, since };
    }
    const total = room.getUnreadNotificationCount(NotificationCountType.Total);
    return {
        count: total > 0 ? total : null,
        since: markerTs ?? room.findEventById(markerEventId)?.getTs() ?? null,
    };
}

/**
 * How many of `events` after `index` count as unread (from others, with a tile: see
 * {@link eventTriggersUnreadCount}). With the index of the read marker or of the last message in
 * view, whichever is later, this is how many unread messages are below the view: the count of the
 * bar "N new messages" at the bottom of the timeline.
 */
export function countUnreadAfter(client: MatrixClient, events: readonly MatrixEvent[], index: number): number {
    let count = 0;
    for (let i = Math.max(index + 1, 0); i < events.length; i++) {
        if (eventTriggersUnreadCount(client, events[i])) count++;
    }
    return count;
}

/** A time for the bar: the time alone today, with the day before that (see {@link formatDate}). */
export function formatUnreadSince(since: number | null, showTwelveHour: boolean): string | null {
    return since === null ? null : formatDate(new Date(since), showTwelveHour);
}
