/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    FAST_INTERVAL_MS,
    type PollCheck,
    type PollProbe,
    type PollRecord,
    RECHECK_DELAY_MS,
    SLOW_INTERVAL_MS,
    TRIGGER_DELAY_MS,
    TRIGGER_MIN_GAP_MS,
    TRIGGER_RETRY_GAP_MS,
    UpdatePoller,
} from "./intercom-updater-poll.js";

const MINUTE = 60 * 1000;

describe("UpdatePoller", () => {
    let probe: ReturnType<typeof vi.fn<(etag: string | undefined, reason: string) => Promise<PollProbe>>>;
    let check: ReturnType<typeof vi.fn<(reason: string) => Promise<PollCheck>>>;
    let records: PollRecord[];
    let poller: UpdatePoller;
    /** What the feed's ETag is on GitHub's side */
    let feed: string;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_800_000_000_000);
        feed = 'W/"1"';
        probe = vi.fn(async (etag) => ({ changed: etag !== feed, etag: feed }));
        check = vi.fn(async () => ({ ok: true, found: false }));
        records = [];
        poller = new UpdatePoller({
            now: Date.now,
            setTimer: (callback, ms) => setTimeout(callback, ms),
            clearTimer: (timer) => clearTimeout(timer as NodeJS.Timeout),
            probe,
            check,
            onPoll: (record) => records.push(record),
        });
    });

    afterEach(() => {
        poller.stop();
        vi.useRealTimers();
    });

    /** The schedule on, after the check the start of the app made */
    function started(fast = true): void {
        poller.configure({ enabled: true, fast });
        poller.noteCheck({ ok: true });
    }

    it("looks at the feed every five minutes and asks for the releases only when it changed", async () => {
        started();
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS - 1);
        expect(probe).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        // The first look has nothing to compare the feed with: the releases are asked for once
        expect(probe).toHaveBeenLastCalledWith(undefined, "interval");
        expect(check).toHaveBeenCalledTimes(1);
        expect(records).toEqual([{ reason: "interval", did: "check", why: "feed-unknown" }]);

        // An hour of nothing: twelve looks at the feed, with its ETag, and not one request to the API
        await vi.advanceTimersByTimeAsync(12 * FAST_INTERVAL_MS);
        expect(probe).toHaveBeenCalledTimes(13);
        expect(probe).toHaveBeenLastCalledWith('W/"1"', "interval");
        expect(check).toHaveBeenCalledTimes(1);
        expect(records.at(-1)).toEqual({ reason: "interval", did: "probe" });

        // A release: seen at the next look
        feed = 'W/"2"';
        check.mockResolvedValueOnce({ ok: true, found: true });
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        expect(check).toHaveBeenCalledTimes(2);
        expect(check).toHaveBeenLastCalledWith("interval");
        expect(records.at(-1)).toEqual({ reason: "interval", did: "check", why: "feed-changed" });
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        expect(probe).toHaveBeenLastCalledWith('W/"2"', "interval");
        expect(check).toHaveBeenCalledTimes(2);
    });

    it("asks for the releases every six hours whatever the feed says", async () => {
        started();
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        expect(check).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(SLOW_INTERVAL_MS - FAST_INTERVAL_MS);
        expect(check).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        expect(check).toHaveBeenCalledTimes(2);
        expect(records.at(-1)).toEqual({ reason: "interval", did: "check", why: "due" });
    });

    it("keeps to six hours, without the feed and without triggers, when the frequent look is off", async () => {
        started(false);
        await vi.advanceTimersByTimeAsync(SLOW_INTERVAL_MS - 1);
        expect(check).not.toHaveBeenCalled();
        expect(poller.trigger("focus")).toBe(false);
        expect(poller.trigger("online")).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(check).toHaveBeenCalledTimes(1);
        expect(probe).not.toHaveBeenCalled();
        expect(records).toEqual([{ reason: "interval", did: "check", why: "slow-mode" }]);
        await vi.advanceTimersByTimeAsync(SLOW_INTERVAL_MS);
        expect(check).toHaveBeenCalledTimes(2);

        // Turned on again: five minutes from then
        poller.configure({ enabled: true, fast: true });
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it("does nothing when automatic checks are off", async () => {
        poller.configure({ enabled: false, fast: true });
        expect(poller.trigger("focus")).toBe(false);
        await vi.advanceTimersByTimeAsync(2 * SLOW_INTERVAL_MS);
        expect(probe).not.toHaveBeenCalled();
        expect(check).not.toHaveBeenCalled();
    });

    it("looks when the window gets the focus, at most once a minute", async () => {
        started();
        // The start's check was just now
        expect(poller.trigger("focus")).toBe(false);
        await vi.advanceTimersByTimeAsync(TRIGGER_MIN_GAP_MS);
        expect(poller.trigger("focus")).toBe(true);
        // Focus, network and wake-up at once are one look
        expect(poller.trigger("online")).toBe(false);
        expect(poller.trigger("resume")).toBe(false);
        expect(probe).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(TRIGGER_DELAY_MS);
        expect(probe).toHaveBeenCalledTimes(1);
        expect(probe).toHaveBeenLastCalledWith(undefined, "focus");

        // Clicking in and out of the window does not ask again within the minute
        for (let i = 0; i < 5; i++) {
            await vi.advanceTimersByTimeAsync(10_000);
            expect(poller.trigger("focus")).toBe(false);
        }
        expect(probe).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(poller.trigger("focus")).toBe(true);
        await vi.advanceTimersByTimeAsync(TRIGGER_DELAY_MS);
        expect(probe).toHaveBeenCalledTimes(2);
        expect(records.at(-1)).toEqual({ reason: "focus", did: "probe" });
    });

    it("does not take the window's first focus for a reason to look: the start has its own check", async () => {
        poller.configure({ enabled: true, fast: true });
        expect(poller.trigger("focus")).toBe(false);
        await vi.advanceTimersByTimeAsync(TRIGGER_MIN_GAP_MS);
        expect(poller.trigger("focus")).toBe(true);
    });

    it("counts the five minutes from the last look, whatever asked for it", async () => {
        started();
        await vi.advanceTimersByTimeAsync(4 * MINUTE);
        poller.trigger("focus");
        await vi.advanceTimersByTimeAsync(TRIGGER_DELAY_MS);
        expect(probe).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS - 1);
        expect(probe).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(probe).toHaveBeenCalledTimes(2);
    });

    it("looks again ten seconds after a look that failed, when the network is back or the computer wakes", async () => {
        started();
        const offline = Object.assign(new Error("offline"), { status: undefined });
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        probe.mockRejectedValueOnce(offline);
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        expect(probe).toHaveBeenCalledTimes(2);
        // Not reached: the API is not tried
        expect(check).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(TRIGGER_RETRY_GAP_MS - 1);
        expect(poller.trigger("online")).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        // The focus alone still waits out the minute
        expect(poller.trigger("focus")).toBe(false);
        expect(poller.trigger("online")).toBe(true);
        await vi.advanceTimersByTimeAsync(TRIGGER_DELAY_MS);
        expect(probe).toHaveBeenCalledTimes(3);
        expect(probe).toHaveBeenLastCalledWith('W/"1"', "online");
        // It worked: back to once a minute
        await vi.advanceTimersByTimeAsync(TRIGGER_RETRY_GAP_MS);
        expect(poller.trigger("resume")).toBe(false);
    });

    it("leaves GitHub alone until the time it names after refusing the feed", async () => {
        started();
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        const retryAt = Date.now() + FAST_INTERVAL_MS + 17 * MINUTE;
        probe.mockRejectedValueOnce(Object.assign(new Error("429"), { status: 429, retryAt }));
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        expect(records.at(-1)).toEqual({ reason: "interval", did: "skip", why: "rate-limited", blockedUntil: retryAt });
        expect(poller.getBlockedUntil()).toBe(retryAt);
        expect(probe).toHaveBeenCalledTimes(2);

        // No look and no trigger until then
        await vi.advanceTimersByTimeAsync(17 * MINUTE - 1);
        expect(poller.trigger("focus")).toBe(false);
        expect(poller.trigger("online")).toBe(false);
        expect(probe).toHaveBeenCalledTimes(2);
        expect(check).toHaveBeenCalledTimes(1);
        // The schedule goes on at that time
        await vi.advanceTimersByTimeAsync(1);
        expect(probe).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        expect(probe).toHaveBeenCalledTimes(4);
    });

    it("leaves GitHub alone after the API refused, and asks for the releases again afterwards", async () => {
        started();
        const retryAt = Date.now() + FAST_INTERVAL_MS + 40 * MINUTE;
        check.mockResolvedValueOnce({ ok: false, found: false, retryAt });
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        expect(records.at(-1)).toEqual({
            reason: "interval",
            did: "check",
            why: "feed-unknown",
            blockedUntil: retryAt,
        });
        await vi.advanceTimersByTimeAsync(40 * MINUTE - 1);
        expect(probe).toHaveBeenCalledTimes(1);
        expect(check).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        // The check that failed did not take up the feed's state: it is made again
        expect(probe).toHaveBeenLastCalledWith(undefined, "interval");
        expect(check).toHaveBeenCalledTimes(2);
    });

    it("waits out a refusal that a check by hand or at the start ran into", async () => {
        poller.configure({ enabled: true, fast: true });
        const retryAt = Date.now() + 30 * MINUTE;
        poller.noteCheck({ ok: false, retryAt });
        await vi.advanceTimersByTimeAsync(30 * MINUTE - 1);
        expect(probe).not.toHaveBeenCalled();
        expect(check).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        // No check has got an answer yet: the releases are asked for, not the feed
        expect(check).toHaveBeenCalledTimes(1);
        expect(records.at(-1)).toMatchObject({ did: "check", why: "due" });
    });

    it("asks the API when the feed is out of order", async () => {
        started();
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        probe.mockRejectedValueOnce(Object.assign(new Error("502"), { status: 502 }));
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        expect(check).toHaveBeenCalledTimes(2);
        expect(records.at(-1)).toEqual({ reason: "interval", did: "check", why: "feed-error" });
    });

    it("asks once more a minute and a half after a changed feed that showed nothing new", async () => {
        started();
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        feed = 'W/"2"';
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        expect(check).toHaveBeenCalledTimes(2);
        check.mockResolvedValueOnce({ ok: true, found: true });
        await vi.advanceTimersByTimeAsync(RECHECK_DELAY_MS);
        expect(check).toHaveBeenCalledTimes(3);
        expect(check).toHaveBeenLastCalledWith("recheck");
        expect(records.at(-1)).toEqual({ reason: "recheck", did: "check", why: "recheck" });
        // Once: not again after that
        await vi.advanceTimersByTimeAsync(RECHECK_DELAY_MS);
        expect(check).toHaveBeenCalledTimes(3);
    });

    it("does not start a look while one is under way", async () => {
        started();
        let answer!: (probe: PollProbe) => void;
        probe.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        await vi.advanceTimersByTimeAsync(TRIGGER_MIN_GAP_MS);
        expect(poller.trigger("focus")).toBe(false);
        await poller.run("interval");
        expect(probe).toHaveBeenCalledTimes(1);
        answer({ changed: false, etag: feed });
        await vi.advanceTimersByTimeAsync(FAST_INTERVAL_MS);
        expect(probe).toHaveBeenCalledTimes(2);
    });
});
