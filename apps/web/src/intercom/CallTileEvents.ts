/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { EventType, type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { ElementCallEventType } from "../call-types";
import { type CallTileCandidate, mergedCallTiles } from "./CallTile";

/**
 * What the merge rule needs of an event that has a call's tile: an `m.rtc.notification`, or
 * Element Call's call state event. `null` for everything else, the calls made the old way
 * (`m.call.invite`) among it: their events are one tile already.
 */
export function callTileCandidate(event: MatrixEvent): CallTileCandidate | null {
    const roomId = event.getRoomId();
    const sender = event.getSender();
    if (!roomId || !sender) return null;
    const type = event.getType();
    if (type === EventType.RTCNotification) {
        const slotId = event.getContent()["slot_id"];
        return {
            kind: "notification",
            roomId,
            sender,
            ts: event.getTs(),
            callId: typeof slotId === "string" ? slotId : undefined,
        };
    }
    if (ElementCallEventType.matches(type) && event.isState()) {
        return { kind: "call", roomId, sender, ts: event.getTs(), callId: event.getStateKey() };
    }
    return null;
}

/**
 * The events of a timeline that get no tile because their neighbour shows the same call (see
 * {@link mergedCallTiles}).
 *
 * @param rows the events of the timeline in order, each with whether it has a row at all
 */
export function findMergedCallTiles(rows: readonly { event: MatrixEvent; shouldShow?: boolean }[]): Set<MatrixEvent> {
    const shown = rows.filter((row) => row.shouldShow).map((row) => row.event);
    const candidates = shown.map(callTileCandidate);
    // Most timelines have no two calls next to each other: nothing to work out
    if (!candidates.some((candidate, index) => candidate && candidates[index + 1])) return new Set();
    return new Set([...mergedCallTiles(candidates)].map((index) => shown[index]));
}
