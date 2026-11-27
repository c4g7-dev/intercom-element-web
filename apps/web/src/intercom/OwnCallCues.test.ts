/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { LEAVE_HEARD_QUIET_MS, OWN_LEAVE_GRACE_MS, ownLeaveIsHeard, OwnCallCues } from "./OwnCallCues";

describe("the sounds of the user's own joining and leaving", () => {
    let play: Mock<(cue: string) => void>;
    let cues: OwnCallCues;

    beforeEach(() => {
        vi.useFakeTimers();
        play = vi.fn();
        cues = new OwnCallCues({ play, now: () => Date.now() });
    });
    afterEach(() => vi.useRealTimers());

    it("plays the join sound once when a call is joined", () => {
        cues.joined("!a");
        cues.joined("!a");
        expect(play.mock.calls).toEqual([["join"]]);
    });

    it("plays the leave sound when the call is left", () => {
        cues.joined("!a");
        vi.advanceTimersByTime(60_000);
        cues.left("!a");
        expect(play).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(OWN_LEAVE_GRACE_MS);
        expect(play.mock.calls).toEqual([["join"], ["leave"]]);
        // Leaving again is nothing
        cues.left("!a");
        vi.advanceTimersByTime(OWN_LEAVE_GRACE_MS);
        expect(play).toHaveBeenCalledTimes(2);
    });

    it("makes no sound for a call that was never joined", () => {
        cues.left("!a");
        vi.advanceTimersByTime(OWN_LEAVE_GRACE_MS * 2);
        expect(play).not.toHaveBeenCalled();
    });

    it("plays the join sound alone when the channel is changed: left, then joined", () => {
        cues.joined("!a");
        vi.advanceTimersByTime(60_000);
        cues.left("!a");
        vi.advanceTimersByTime(OWN_LEAVE_GRACE_MS - 1);
        cues.joined("!b");
        vi.advanceTimersByTime(OWN_LEAVE_GRACE_MS * 2);
        expect(play.mock.calls).toEqual([["join"], ["join"]]);
    });

    it("plays the join sound alone when the channel is changed: joined, then left", () => {
        cues.joined("!a");
        vi.advanceTimersByTime(60_000);
        cues.joined("!b");
        vi.advanceTimersByTime(OWN_LEAVE_GRACE_MS - 1);
        cues.left("!a");
        vi.advanceTimersByTime(OWN_LEAVE_GRACE_MS * 2);
        expect(play.mock.calls).toEqual([["join"], ["join"]]);
    });

    it("plays the leave sound for a call that is left right after it was joined", () => {
        cues.joined("!a");
        cues.left("!a");
        vi.advanceTimersByTime(OWN_LEAVE_GRACE_MS);
        expect(play.mock.calls).toEqual([["join"], ["leave"]]);
    });

    it("plays the leave sound when one of two calls is left later", () => {
        cues.joined("!a");
        cues.joined("!b");
        vi.advanceTimersByTime(OWN_LEAVE_GRACE_MS);
        cues.left("!a");
        vi.advanceTimersByTime(OWN_LEAVE_GRACE_MS);
        expect(play.mock.calls).toEqual([["join"], ["join"], ["leave"]]);
    });

    it("plays one leave sound however often the call is said to be left", () => {
        cues.joined("!dm");
        vi.advanceTimersByTime(60_000);
        cues.left("!dm");
        cues.left("!dm");
        vi.advanceTimersByTime(OWN_LEAVE_GRACE_MS / 2);
        cues.left("!dm");
        vi.advanceTimersByTime(10_000);
        cues.left("!dm");
        vi.advanceTimersByTime(10_000);
        expect(play.mock.calls).toEqual([["join"], ["leave"]]);
    });

    describe("the end of a call is one sound", () => {
        beforeEach(() => {
            cues.joined("!dm");
            vi.advanceTimersByTime(60_000);
            play.mockClear();
        });

        it("we leave a call of two: our own leave sound", () => {
            cues.left("!dm");
            vi.advanceTimersByTime(10_000);
            expect(play.mock.calls).toEqual([["leave"]]);
        });

        it("the other one leaves and the call ends with that: our own leave sound", () => {
            // The call says nothing: it is quiet from when it leaves by itself
            cues.left("!dm");
            vi.advanceTimersByTime(10_000);
            expect(play.mock.calls).toEqual([["leave"]]);
        });

        it("the other one leaves, the call plays that, and we leave within 2 s: none of ours", () => {
            cues.leaveHeard();
            vi.advanceTimersByTime(LEAVE_HEARD_QUIET_MS - 1);
            cues.left("!dm");
            vi.advanceTimersByTime(10_000);
            expect(play).not.toHaveBeenCalled();
        });

        it("the call's word that it played the sound comes after we left: none of ours", () => {
            cues.left("!dm");
            vi.advanceTimersByTime(OWN_LEAVE_GRACE_MS / 2);
            cues.leaveHeard();
            vi.advanceTimersByTime(10_000);
            expect(play).not.toHaveBeenCalled();
        });

        it("the other one left a while ago: our leave is heard", () => {
            cues.leaveHeard();
            vi.advanceTimersByTime(LEAVE_HEARD_QUIET_MS);
            cues.left("!dm");
            vi.advanceTimersByTime(10_000);
            expect(play.mock.calls).toEqual([["leave"]]);
        });

        it("others leaving a group call we stay in takes nothing from our later leave", () => {
            cues.leaveHeard();
            vi.advanceTimersByTime(30_000);
            cues.leaveHeard();
            vi.advanceTimersByTime(30_000);
            expect(play).not.toHaveBeenCalled();
            cues.left("!dm");
            vi.advanceTimersByTime(10_000);
            expect(play.mock.calls).toEqual([["leave"]]);
        });

        it("two calls left together are one leave sound", () => {
            cues.joined("!other");
            vi.advanceTimersByTime(60_000);
            play.mockClear();
            cues.left("!dm");
            vi.advanceTimersByTime(OWN_LEAVE_GRACE_MS + 100);
            cues.left("!other");
            vi.advanceTimersByTime(10_000);
            expect(play.mock.calls).toEqual([["leave"]]);
        });

        it("a call that is back before its leave was heard makes no sound: a reconnect", () => {
            cues.left("!dm");
            vi.advanceTimersByTime(OWN_LEAVE_GRACE_MS - 1);
            cues.joined("!dm");
            vi.advanceTimersByTime(10_000);
            expect(play).not.toHaveBeenCalled();
            // And it is still a call to leave
            cues.left("!dm");
            vi.advanceTimersByTime(10_000);
            expect(play.mock.calls).toEqual([["leave"]]);
        });

        it("a call joined again after its leave was heard is a join", () => {
            cues.left("!dm");
            vi.advanceTimersByTime(OWN_LEAVE_GRACE_MS + 1);
            cues.joined("!dm");
            expect(play.mock.calls).toEqual([["leave"], ["join"]]);
        });
    });

    it("says when a leave is heard", () => {
        expect(ownLeaveIsHeard(5000, undefined)).toBe(true);
        expect(ownLeaveIsHeard(5000, 5000 - LEAVE_HEARD_QUIET_MS)).toBe(true);
        expect(ownLeaveIsHeard(5000, 5001 - LEAVE_HEARD_QUIET_MS)).toBe(false);
        expect(ownLeaveIsHeard(5000, 5200)).toBe(false);
    });
});
