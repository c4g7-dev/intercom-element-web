/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type I18nApi } from "@element-hq/element-web-module-api";

/**
 * What a call's tile in the timeline says about the call:
 * - `ongoing`: the call is running;
 * - `ringing`: it rings and nobody has answered yet;
 * - `ended`: it is over;
 * - `missed`: it is over and was not answered;
 * - `declined`: it was turned down.
 */
export type CallTileState = "ongoing" | "ringing" | "ended" | "missed" | "declined";

/** What the tile's text is made from. */
export interface CallTileText {
    /** What the tile says about the call */
    state: CallTileState;
    /** Whether the user started the call themselves */
    outgoing: boolean;
    /** The name of whoever started the call */
    startedByName: string;
    /** How long the call lasted, in ms, when it is over and that is known */
    durationMs?: number;
}

type Translate = I18nApi["translate"];

/** The most people shown as avatars on the tile of a running call; the rest are counted. */
export const MAX_CALL_TILE_AVATARS = 4;

/**
 * How long a call lasted, for reading: "6 s" under a minute, "4 min" under an hour, then "1 h" or
 * "1 h 12 min". Seconds and minutes are rounded down; a call of less than a second is "1 s".
 */
export function formatCallDuration(durationMs: number, _t: Translate): string {
    const totalSeconds = Math.max(1, Math.floor(durationMs / 1000));
    if (totalSeconds < 60) return _t("intercom|call_tile|duration_s", { seconds: totalSeconds });
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) return _t("intercom|call_tile|duration_min", { minutes: totalMinutes });
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (minutes === 0) return _t("intercom|call_tile|duration_h", { hours });
    return _t("intercom|call_tile|duration_h_min", { hours, minutes });
}

/** The counter of a running call: "0:06", "4:12", "1:02:03". Never negative. */
export function formatCallClock(elapsedMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** The line of text of a call's tile. */
export function callTileTitle({ state, outgoing, startedByName, durationMs }: CallTileText, _t: Translate): string {
    switch (state) {
        case "ongoing":
            return outgoing
                ? _t("intercom|call_tile|you_started")
                : _t("intercom|call_tile|started_by", { name: startedByName });
        case "ringing":
            return outgoing
                ? _t("intercom|call_tile|calling_out")
                : _t("intercom|call_tile|calling_in", { name: startedByName });
        case "ended":
            return durationMs !== undefined && durationMs > 0
                ? _t("intercom|call_tile|ended_duration", { duration: formatCallDuration(durationMs, _t) })
                : _t("intercom|call_tile|ended");
        case "missed":
            return outgoing ? _t("intercom|call_tile|no_answer") : _t("intercom|call_tile|missed");
        case "declined":
            return _t("intercom|call_tile|declined");
    }
}

/**
 * Who of the people in a call get an avatar on its tile, and how many are only counted: at most
 * {@link MAX_CALL_TILE_AVATARS} avatars, the rest as "+N".
 */
export function stackCallParticipants<T>(
    participants: readonly T[],
    max = MAX_CALL_TILE_AVATARS,
): {
    shown: T[];
    more: number;
} {
    const shown = participants.slice(0, max);
    return { shown, more: participants.length - shown.length };
}
