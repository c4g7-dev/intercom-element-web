/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { playSoundCue, type SoundCue } from "./Sounds";

/**
 * How long the sound of leaving a call waits for a join that makes it a change of channel, and
 * how long after a join a leave is still the other half of such a change.
 */
export const OWN_LEAVE_GRACE_MS = 400;

/**
 * How long a leave sound that was heard stands for the next one too: the end of a call is one
 * sound. Where the other one of a call of two hangs up and the call plays the sound of that, the
 * user's own leave that follows within this makes none; nor does a second leave of the user's own.
 */
export const LEAVE_HEARD_QUIET_MS = 2000;

/**
 * Whether the user's own leave sound is played: not if a leave sound was heard less than
 * {@link LEAVE_HEARD_QUIET_MS} before the user left, or since.
 * @param leftAt - when the user left, in ms
 * @param leaveHeardAt - when a leave sound was last heard, the call's or the app's, if ever
 */
export function ownLeaveIsHeard(leftAt: number, leaveHeardAt: number | undefined): boolean {
    return leaveHeardAt === undefined || leftAt - leaveHeardAt >= LEAVE_HEARD_QUIET_MS;
}

interface Dependencies {
    play?: (cue: SoundCue) => void;
    now?: () => number;
}

/**
 * The sounds of the user's own coming into a call and going out of it. They are the app's and
 * not the call's: the call's view is gone when the user has left, and its sounds are off while
 * the user is deafened, which these are not meant to be.
 *
 *  - joining a call plays the join sound;
 *  - leaving one plays the leave sound;
 *  - going from one voice channel to another (a leave and a join within
 *    {@link OWN_LEAVE_GRACE_MS} of each other, in either order) plays the join sound alone;
 *  - a call that was never joined makes no sound when its view goes away;
 *  - a call that is left and joined again within the same time (its view was built anew, the
 *    connection to it came back) makes no sound at all: neither was heard to begin with;
 *  - the end of a call is one sound: none here where the call has just played the sound of
 *    somebody else leaving ({@link leaveHeard}, see {@link LEAVE_HEARD_QUIET_MS}), and one for
 *    two calls left together.
 */
export class OwnCallCues {
    private static internalInstance: OwnCallCues | undefined;

    public static get instance(): OwnCallCues {
        OwnCallCues.internalInstance ??= new OwnCallCues();
        return OwnCallCues.internalInstance;
    }

    private readonly play: (cue: SoundCue) => void;
    private readonly now: () => number;
    private readonly joinedRooms = new Set<string>();
    private lastJoinAt: number | undefined;
    private pendingLeave: ReturnType<typeof setTimeout> | undefined;
    private pendingLeaveRoom: string | undefined;
    private leaveHeardAt: number | undefined;

    public constructor(deps: Dependencies = {}) {
        this.play = deps.play ?? playSoundCue;
        this.now = deps.now ?? Date.now;
    }

    /** The user is in the call of a room. Saying so again changes nothing. */
    public joined(roomId: string): void {
        if (this.joinedRooms.has(roomId)) return;
        this.joinedRooms.add(roomId);
        if (this.pendingLeave !== undefined) {
            clearTimeout(this.pendingLeave);
            this.pendingLeave = undefined;
            // Back in the call whose leave was still waiting: the user never left it
            if (this.pendingLeaveRoom === roomId) return;
            // Otherwise that leave was the first half of a change of channel
        }
        this.lastJoinAt = this.now();
        this.play("join");
    }

    /**
     * A leave sound was played by somebody else than this: by the call, for another member who
     * left it. The user's own leave makes none if it comes right after, or came right before.
     */
    public leaveHeard(): void {
        this.leaveHeardAt = this.now();
    }

    /** The user is no longer in the call of a room, or its view went away. */
    public left(roomId: string): void {
        if (!this.joinedRooms.delete(roomId)) return;
        if (this.lastJoinAt !== undefined && this.now() - this.lastJoinAt < OWN_LEAVE_GRACE_MS) {
            // Another call was joined a moment ago: its sound said it
            if (this.joinedRooms.size > 0) return;
        }
        if (this.pendingLeave !== undefined) clearTimeout(this.pendingLeave);
        const leftAt = this.now();
        this.pendingLeaveRoom = roomId;
        this.pendingLeave = setTimeout(() => {
            this.pendingLeave = undefined;
            this.pendingLeaveRoom = undefined;
            // Asked now and not when the user left: the call may have said in between that
            // it played the sound of the other one leaving
            if (!ownLeaveIsHeard(leftAt, this.leaveHeardAt)) return;
            this.leaveHeardAt = this.now();
            this.play("leave");
        }, OWN_LEAVE_GRACE_MS);
    }
}
