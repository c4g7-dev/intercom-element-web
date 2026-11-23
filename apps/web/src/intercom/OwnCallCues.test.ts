/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { OWN_LEAVE_GRACE_MS, OwnCallCues } from "./OwnCallCues";

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
});
