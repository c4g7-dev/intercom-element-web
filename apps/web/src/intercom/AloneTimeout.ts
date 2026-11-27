/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type Room } from "matrix-js-sdk/src/matrix";

import { isVideoRoom } from "../utils/video-rooms";

/**
 * How long the user stays in a private call after everybody else left it: a number of seconds,
 * or "never" to stay until they leave themselves. Kept on this device (Settings → InterCom).
 */
export type AloneTimeout = number | "never";

/** What the setting offers: 3, 5 and 10 minutes, and never. */
export const ALONE_TIMEOUT_CHOICES: readonly AloneTimeout[] = [180, 300, 600, "never"];

export const DEFAULT_ALONE_TIMEOUT: AloneTimeout = 300;

/** The URL parameter the call (the InterCom build of Element Call) is given the timeout in. */
export const ALONE_TIMEOUT_URL_PARAM = "intercomAloneTimeout";

/** Why a call says it is leaving by itself: the user was alone in it for the whole timeout. */
export const ALONE_TIMEOUT_LEFT_REASON = "alone-timeout";

const STORAGE_KEY = "intercom_alone_timeout";

function storage(): Storage | undefined {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

/** Reads a kept or chosen value; anything that is not one of the choices is the default. */
export function readAloneTimeout(value: unknown): AloneTimeout {
    const read = value === "never" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    return ALONE_TIMEOUT_CHOICES.includes(read as AloneTimeout) ? (read as AloneTimeout) : DEFAULT_ALONE_TIMEOUT;
}

/** The user's setting. */
export function getAloneTimeout(): AloneTimeout {
    try {
        return readAloneTimeout(storage()?.getItem(STORAGE_KEY));
    } catch {
        return DEFAULT_ALONE_TIMEOUT;
    }
}

/** Keeps the user's setting. Calls that are on are told by `sendAloneTimeout` (CallActions). */
export function storeAloneTimeout(timeout: AloneTimeout): void {
    try {
        storage()?.setItem(STORAGE_KEY, String(timeout));
    } catch {
        // Not kept, then
    }
}

/**
 * Whether being alone in a call of this room counts down to leaving it. Not in a voice channel
 * (a room that is a call, joined with one click): one can sit there alone for as long as one
 * likes. Nor in a public room, whose call anybody may drop into later. The call of a private
 * room (a conversation with one person, an invite-only room) is one somebody was called into.
 */
export function aloneTimeoutApplies(room: Room | null | undefined): boolean {
    return !!room && !isVideoRoom(room) && room.getJoinRule() !== "public";
}

/**
 * What the call of a room is given as its `intercomAloneTimeout`: the setting, in seconds or
 * "never"; nothing for a voice channel, which leaves the call as it is without the parameter.
 */
export function aloneTimeoutParam(
    room: Room | null | undefined,
    timeout: AloneTimeout = getAloneTimeout(),
): string | undefined {
    return aloneTimeoutApplies(room) ? String(timeout) : undefined;
}

/** The countdown of a call the user is alone in, as the call tells it. */
export interface AloneCountdown {
    /** When the call leaves by itself, in ms on this app's clock */
    deadline: number;
    /** Which countdown it is: another one after the user chose to stay */
    seq: number;
}

/** How far a deadline told again may be off the one before and still be the same one, in ms */
const DEADLINE_SLACK_MS = 1500;

/**
 * Reads the `alone` field of the call's state: `{ ms_left, seq }`. The call tells what is left
 * whenever anything about it changes; the same countdown told again keeps the deadline it had,
 * so that what shows it does not jump (or render anew) for a few milliseconds of difference.
 * @param previous The countdown read from the state before, if there was one
 */
export function readAloneCountdown(data: unknown, now: number, previous?: AloneCountdown): AloneCountdown | undefined {
    if (typeof data !== "object" || data === null) return undefined;
    const raw = data as Record<string, unknown>;
    if (typeof raw.ms_left !== "number" || !Number.isFinite(raw.ms_left) || raw.ms_left < 0) return undefined;
    const seq = typeof raw.seq === "number" && Number.isFinite(raw.seq) ? raw.seq : 0;
    const deadline = now + raw.ms_left;
    if (previous && previous.seq === seq && Math.abs(previous.deadline - deadline) < DEADLINE_SLACK_MS) {
        return previous;
    }
    return { deadline, seq };
}

const disconnects = new Map<string, number>();

/** Notes that the call of a room left because the user was alone in it, now. */
export function noteAloneDisconnect(roomId: string, now = Date.now()): void {
    disconnects.set(roomId, now);
}

/**
 * When this device last left the call of a room because the user was alone in it (ms), if it
 * did since the app started. For whatever shows how a call ended.
 */
export function lastAloneDisconnect(roomId: string): number | undefined {
    return disconnects.get(roomId);
}
