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
 *  - a call that was never joined makes no sound when its view goes away.
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

    public constructor(deps: Dependencies = {}) {
        this.play = deps.play ?? playSoundCue;
        this.now = deps.now ?? Date.now;
    }

    /** The user is in the call of a room. Saying so again changes nothing. */
    public joined(roomId: string): void {
        if (this.joinedRooms.has(roomId)) return;
        this.joinedRooms.add(roomId);
        this.lastJoinAt = this.now();
        if (this.pendingLeave !== undefined) {
            // The leave that is waiting was the first half of a change of channel
            clearTimeout(this.pendingLeave);
            this.pendingLeave = undefined;
        }
        this.play("join");
    }

    /** The user is no longer in the call of a room, or its view went away. */
    public left(roomId: string): void {
        if (!this.joinedRooms.delete(roomId)) return;
        if (this.lastJoinAt !== undefined && this.now() - this.lastJoinAt < OWN_LEAVE_GRACE_MS) {
            // Another call was joined a moment ago: its sound said it
            if (this.joinedRooms.size > 0) return;
        }
        if (this.pendingLeave !== undefined) clearTimeout(this.pendingLeave);
        this.pendingLeave = setTimeout(() => {
            this.pendingLeave = undefined;
            this.play("leave");
        }, OWN_LEAVE_GRACE_MS);
    }
}
