/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import type { CallTileButton, CallTileState } from "@element-hq/web-shared-components";

/*
 * What the timeline shows of a call, decided here from plain facts so that it can be tested
 * without a client: which tiles of one call are shown as one (the merge rule), what became of a
 * call (from who joined and left it), and what its tile says (the state and its buttons).
 */

/**
 * Two tiles of calls from one person in one room that start within this of each other are one
 * call: the second announcement of a call that was set up twice (a reconnect, a second ring), or
 * the announcement and the call's own event.
 */
export const CALL_MERGE_WINDOW_MS = 30_000;

/** An event the timeline shows as a call's tile. */
export interface CallTileCandidate {
    /**
     * What the event is: `notification` announces a call (`m.rtc.notification`), `call` is a
     * call's own event (Element Call's call state event).
     */
    kind: "notification" | "call";
    /** The room it is in */
    roomId: string;
    /** Who sent it */
    sender: string;
    /** When, in ms since the epoch */
    ts: number;
    /** What names the call, if the event says: a notification's slot, a call event's call ID */
    callId?: string;
}

/**
 * Whether two events that each have a call's tile stand for the same call: the same room, the
 * same sender, within {@link CALL_MERGE_WINDOW_MS} of each other, and, where both are of one
 * kind and both name their call, the same call. (A notification and a call's own event name the
 * call differently, so there the sender and the time decide.)
 */
export function isSameCall(a: CallTileCandidate, b: CallTileCandidate, windowMs = CALL_MERGE_WINDOW_MS): boolean {
    if (a.roomId !== b.roomId || a.sender !== b.sender) return false;
    if (Math.abs(a.ts - b.ts) > windowMs) return false;
    if (a.kind === b.kind && a.callId !== undefined && b.callId !== undefined && a.callId !== b.callId) return false;
    return true;
}

/**
 * The merge rule: which of the timeline's rows are left out because the row next to them shows
 * the same call.
 *
 * @param rows the rows the timeline would show, in order: a candidate for a call's tile, `null`
 *     for any other row (which parts two tiles: only neighbours are merged)
 * @returns the indexes of the rows that get no tile of their own. Of two tiles of one call the
 *     notification stays (it carries who is in the call and the buttons); of two notifications the
 *     later one, which is the one the running call belongs to.
 */
export function mergedCallTiles(rows: readonly (CallTileCandidate | null)[], windowMs?: number): Set<number> {
    const hidden = new Set<number>();
    let kept: number | undefined;
    rows.forEach((row, index) => {
        const previous = kept === undefined ? null : rows[kept];
        if (row === null || !previous || !isSameCall(previous, row, windowMs)) {
            kept = row === null ? undefined : index;
            return;
        }
        if (previous.kind === "notification" && row.kind === "call") {
            hidden.add(index);
        } else {
            hidden.add(kept!);
            kept = index;
        }
    });
    return hidden;
}

/** Somebody's device joining or leaving a call, as the room's history has it. */
export interface CallMembershipChange {
    /** When, in ms since the epoch */
    ts: number;
    /** Whose device */
    userId: string;
    /** What tells that device's membership from the others: the state key */
    key: string;
    /** Whether it joined (or renewed its membership); otherwise it left */
    joined: boolean;
}

/** What became of a call, as far as the room's history tells. */
export interface CallSummary {
    /** When the last device left: missing while the history does not show the end */
    endTs?: number;
    /** Everybody who was in the call at some time, in the order they joined */
    joinedUserIds: string[];
}

/**
 * Whether the content of a call membership event says that the device is in the call: one that
 * left has an empty content (or, in the oldest form, an empty list of memberships).
 */
export function isActiveCallMembership(content: Record<string, unknown> | undefined): boolean {
    if (!content || Object.keys(content).length === 0) return false;
    if (Array.isArray(content.memberships)) return content.memberships.length > 0;
    return true;
}

/**
 * Follows a call from its first membership to the moment nobody is left in it.
 *
 * @param changes the membership changes of the room from the one that started the call on, in order
 */
export function summariseCall(changes: readonly CallMembershipChange[]): CallSummary {
    const inCall = new Set<string>();
    const joinedUserIds: string[] = [];
    for (const change of changes) {
        if (change.joined) {
            inCall.add(change.key);
            if (!joinedUserIds.includes(change.userId)) joinedUserIds.push(change.userId);
        } else if (inCall.delete(change.key) && inCall.size === 0) {
            return { endTs: change.ts, joinedUserIds };
        }
    }
    return { joinedUserIds };
}

/** What is known of a call announced by a notification. */
export interface CallFacts {
    /** Whether the call is running and this is its tile */
    ongoing: boolean;
    /** Whether the user started it themselves */
    outgoing: boolean;
    /** Who started it */
    startedBy: string;
    /** The user */
    ownUserId: string;
    /** Whether the call rings the other side (a call to one person), rather than only notifying */
    ring: boolean;
    /** Until when it rings, in ms since the epoch */
    ringUntil?: number;
    /** The time now, in ms since the epoch */
    now: number;
    /** Whether somebody other than who started it is in the call right now */
    othersInCall: boolean;
    /** Whether the user is in the call themselves */
    joined: boolean;
    /** Whether the user may join calls in the room */
    canJoin: boolean;
    /** Whether the user is leaving the call at this moment */
    leaving?: boolean;
    /** Whether the call was declined */
    declined: boolean;
    /** When the call started, in ms since the epoch */
    startTs: number;
    /** What the room's history tells of the call, if it tells anything */
    summary?: CallSummary;
}

/** What a call's tile shows. */
export interface CallTileOutcome {
    /** What the tile says about the call */
    state: CallTileState;
    /** How long the call took, in ms, for one that is over and whose end is known */
    durationMs?: number;
    /** The buttons of the tile */
    buttons: CallTileButton[];
    /** Those of them that cannot be used right now */
    disabledButtons: CallTileButton[];
}

/**
 * The state mapping: what the tile of a call says, from what is known of the call.
 *
 * - A running call is `ongoing`; while it rings and nobody has picked up (and the user has not
 *   declined it), `ringing`. The user joins it, or leaves it when they are in it.
 * - A call that is over was `declined` if somebody declined it; `missed` if it rang and nobody
 *   but the caller was ever in it; otherwise `ended`, with how long it took where the room's
 *   history shows its end.
 */
export function callTileOutcome(facts: CallFacts): CallTileOutcome {
    if (facts.ongoing) {
        const ringing =
            facts.ring &&
            !facts.declined &&
            !facts.othersInCall &&
            facts.ringUntil !== undefined &&
            facts.now < facts.ringUntil;
        const buttons: CallTileButton[] = [facts.joined ? "leave" : "join"];
        const disabledButtons: CallTileButton[] = [];
        if (!facts.joined && !facts.canJoin) disabledButtons.push("join");
        if (facts.joined && facts.leaving) disabledButtons.push("leave");
        return { state: ringing ? "ringing" : "ongoing", buttons, disabledButtons };
    }

    if (facts.declined) return { state: "declined", buttons: [], disabledButtons: [] };

    const { summary } = facts;
    const answered = summary?.joinedUserIds.some((userId) => userId !== facts.startedBy) ?? false;
    // Only what the history shows from start to end tells that nobody picked up
    if (facts.ring && summary?.endTs !== undefined && !answered) {
        const callBack = !facts.outgoing && facts.canJoin;
        return { state: "missed", buttons: callBack ? ["call_back"] : [], disabledButtons: [] };
    }

    const durationMs = summary?.endTs === undefined ? undefined : summary.endTs - facts.startTs;
    return {
        state: "ended",
        durationMs: durationMs !== undefined && durationMs > 0 ? durationMs : undefined,
        buttons: [],
        disabledButtons: [],
    };
}

/** What is known of a call between two people made the old way (`m.call.invite`). */
export interface LegacyCallFacts {
    /** Where the call is: `undefined` while that is not known */
    phase: "ringing" | "connecting" | "connected" | "ended" | undefined;
    /** Whether the user started it themselves */
    outgoing: boolean;
    /** Whether the other side turned it down */
    rejected: boolean;
    /** Whether the user never took part in it */
    missed: boolean;
    /** Why it ended, as the hangup says, if it says */
    hangupReason: string | null;
    /** How long it took, in ms, when both its answer and its end are known */
    durationMs: number | null;
    /** For how long it has been connected, in seconds */
    connectedSeconds: number;
    /** The time now, in ms since the epoch */
    now: number;
}

/** What the tile of such a call shows. */
export interface LegacyCallTileOutcome extends Omit<CallTileOutcome, "disabledButtons"> {
    /** Since when a connected call runs, in ms since the epoch */
    startedAt?: number;
    /** Whether the user is in the call */
    joined: boolean;
    /**
     * What the tile says where the state's own text would not do: `connecting`, `answered_elsewhere`,
     * `failed` (the reason is in `hangupReason`) or `unknown`
     */
    note?: "connecting" | "answered_elsewhere" | "failed" | "unknown";
}

/** The hangup reasons that are an ordinary end of a call (see `LegacyCallEvent`). */
const PLAIN_HANGUPS = ["user_hangup", "user hangup"];

/** The state mapping of a call made the old way: the states and buttons Element's own tile has. */
export function legacyCallTileOutcome(facts: LegacyCallFacts): LegacyCallTileOutcome {
    const none = { joined: false, buttons: [] };
    switch (facts.phase) {
        case "ringing":
            return { state: "ringing", joined: false, buttons: ["decline", "accept"] };
        case "connecting":
            return { ...none, state: "ringing", note: "connecting" };
        case "connected":
            return {
                state: "ongoing",
                joined: true,
                buttons: [],
                startedAt: facts.now - facts.connectedSeconds * 1000,
            };
        case "ended": {
            if (facts.rejected) return { ...none, state: "declined", buttons: ["call_back"] };
            if (facts.hangupReason === "answered_elsewhere") {
                return { ...none, state: "ended", note: "answered_elsewhere" };
            }
            if (facts.missed) return { ...none, state: "missed", buttons: ["call_back"] };
            if (!facts.hangupReason || PLAIN_HANGUPS.includes(facts.hangupReason)) {
                return { ...none, state: "ended", durationMs: facts.durationMs || undefined };
            }
            if (facts.hangupReason === "invite_timeout") return { ...none, state: "missed", buttons: ["call_back"] };
            return { ...none, state: "ended", note: "failed", buttons: ["call_back"] };
        }
        default:
            return { ...none, state: "ended", note: "unknown" };
    }
}
