/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * When the running app looks for a new release, without Electron: intercom-updater.ts gives it
 * the clock, the timers and the two things it can ask.
 *
 * There is nothing that pushes a release to the app, so the app asks often and cheaply. Every
 * five minutes, and when the window gets the focus back, the computer wakes up or the network
 * returns, it asks whether the releases feed changed (one conditional request to github.com,
 * answered "304" with no body while nothing was released). Only when the feed did change are the
 * releases themselves asked for (the GitHub API, which allows an address without a login 60
 * requests an hour and counts unchanged answers too). Every six hours the releases are asked for
 * whatever the feed says, which is also all that happens with the frequent look turned off.
 *
 * GitHub refusing for too many requests is waited out: nothing is asked until the time it names.
 */

/** How often the feed is looked at with the frequent look on. */
export const FAST_INTERVAL_MS = 5 * 60 * 1000;
/** How often the releases are asked for whatever the feed says: the whole schedule with the frequent look off. */
export const SLOW_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** The least time between a look and one that the focus, a wake-up or the network asks for. */
export const TRIGGER_MIN_GAP_MS = 60 * 1000;
/** The least time after a look that failed before the network coming back asks for another. */
export const TRIGGER_RETRY_GAP_MS = 10 * 1000;
/** How long a trigger waits before it looks: several at once (focus and network after a wake-up) are one look. */
export const TRIGGER_DELAY_MS = 2000;
/**
 * How long after a changed feed that showed nothing new the releases are asked for once more:
 * the API may answer from a copy that is up to a minute old.
 */
export const RECHECK_DELAY_MS = 90 * 1000;

/** Why a look happens. */
export type PollReason = "interval" | "focus" | "online" | "resume" | "recheck";

/** What a look at the feed says; see `probeReleasesFeed` in intercom-updater-check.ts. */
export interface PollProbe {
    changed: boolean;
    etag?: string;
}

/** How asking for the releases went. */
export interface PollCheck {
    /** Whether GitHub answered */
    ok: boolean;
    /** Whether a newer release is known now */
    found: boolean;
    /** Where GitHub refused for too many requests: when it may be asked again */
    retryAt?: number;
}

/** What a look came to, for the log. */
export interface PollRecord {
    reason: PollReason;
    /** probe: the feed was unchanged. check: the releases were asked for. skip: nothing was asked */
    did: "probe" | "check" | "skip";
    /** Why the releases were asked for, or why nothing was */
    why?: "feed-changed" | "feed-unknown" | "feed-error" | "due" | "slow-mode" | "recheck" | "rate-limited";
    /** Until when GitHub is left alone, if it refused */
    blockedUntil?: number;
}

export interface PollerDeps {
    now: () => number;
    setTimer: (callback: () => void, ms: number) => unknown;
    clearTimer: (timer: unknown) => void;
    /**
     * Asks whether the feed changed since the answer with `etag`.
     * Rejects with an error that may carry `retryAt` (a refusal for too many requests) and
     * `status` (an HTTP error; none where GitHub was not reached).
     */
    probe: (etag: string | undefined, reason: PollReason) => Promise<PollProbe>;
    /** Asks for the releases and takes up what is found. Never rejects. */
    check: (reason: PollReason) => Promise<PollCheck>;
    /** Told what every look came to */
    onPoll?: (record: PollRecord) => void;
}

interface ProbeFailure {
    retryAt?: number;
    status?: number;
}

/** Looks for a new release on a schedule and when asked to; see the top of the file. */
export class UpdatePoller {
    private enabled = false;
    private fast = true;
    private timer: unknown;
    private triggerTimer: unknown;
    private recheckTimer: unknown;
    private running = false;
    /** When the last look began; undefined before the first */
    private lastRun: number | undefined;
    /** When the releases were last asked for and GitHub answered */
    private lastCheck: number | undefined;
    private lastFailed = false;
    private etag: string | undefined;
    private blockedUntil = 0;

    public constructor(private readonly deps: PollerDeps) {}

    /**
     * Turns the schedule on or off and chooses the frequent or the six-hourly look. The first
     * look comes one interval from now: the start of the app has its own check.
     */
    public configure(settings: { enabled: boolean; fast: boolean }): void {
        this.enabled = settings.enabled;
        this.fast = settings.fast;
        // The start's own check is on its way: the window's first focus is no reason for another
        this.lastRun ??= this.deps.now();
        this.clear("triggerTimer");
        this.clear("recheckTimer");
        this.arm();
    }

    /** Stops everything. */
    public stop(): void {
        this.configure({ enabled: false, fast: this.fast });
    }

    /**
     * Notes that the releases were asked for by other means (the start of the app, "Check now"),
     * so that the schedule counts from there and a refusal by GitHub is waited out.
     */
    public noteCheck(result: Pick<PollCheck, "ok" | "retryAt">): void {
        const now = this.deps.now();
        this.lastRun = now;
        this.lastFailed = !result.ok;
        if (result.ok) this.lastCheck = now;
        if (result.retryAt !== undefined) this.blockedUntil = Math.max(this.blockedUntil, result.retryAt);
    }

    /** Until when GitHub is left alone after it refused; 0 if it did not. */
    public getBlockedUntil(): number {
        return this.blockedUntil;
    }

    /**
     * The window got the focus back, the computer woke up or the network returned: looks now,
     * unless the frequent look is off, a look is under way, or the last one is less than a
     * minute ago. After a look that failed, the network coming back or a wake-up is taken after
     * ten seconds already.
     * @returns whether a look was scheduled
     */
    public trigger(reason: "focus" | "online" | "resume"): boolean {
        if (!this.enabled || !this.fast || this.running || this.triggerTimer !== undefined) return false;
        const now = this.deps.now();
        if (now < this.blockedUntil) return false;
        if (this.lastRun !== undefined) {
            const gap = this.lastFailed && reason !== "focus" ? TRIGGER_RETRY_GAP_MS : TRIGGER_MIN_GAP_MS;
            if (now - this.lastRun < gap) return false;
        }
        this.triggerTimer = this.deps.setTimer(() => {
            this.triggerTimer = undefined;
            void this.run(reason);
        }, TRIGGER_DELAY_MS);
        return true;
    }

    private clear(which: "timer" | "triggerTimer" | "recheckTimer"): void {
        if (this[which] !== undefined) this.deps.clearTimer(this[which]);
        this[which] = undefined;
    }

    /** Sets the next look of the schedule: an interval from now, or when GitHub may be asked again if that is later. */
    private arm(): void {
        this.clear("timer");
        if (!this.enabled) return;
        const interval = this.fast ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;
        const wait = Math.max(interval, this.blockedUntil - this.deps.now());
        this.timer = this.deps.setTimer(() => {
            this.timer = undefined;
            void this.run("interval");
        }, wait);
    }

    private told(record: PollRecord): void {
        try {
            this.deps.onPoll?.(record);
        } catch {
            // The log is not what the schedule depends on
        }
    }

    /** One look. Resolves when it is over; the next one of the schedule is set by then. */
    public async run(reason: PollReason): Promise<void> {
        if (!this.enabled || this.running) return;
        const now = this.deps.now();
        if (now < this.blockedUntil) {
            this.told({ reason, did: "skip", why: "rate-limited", blockedUntil: this.blockedUntil });
            this.arm();
            return;
        }
        this.running = true;
        this.lastRun = now;
        try {
            let why: PollRecord["why"];
            let feed: PollProbe | undefined;
            if (reason === "recheck") why = "recheck";
            else if (!this.fast) why = "slow-mode";
            else if (this.lastCheck === undefined || now - this.lastCheck >= SLOW_INTERVAL_MS) why = "due";
            else {
                try {
                    feed = await this.deps.probe(this.etag, reason);
                    if (feed.changed) why = this.etag ? "feed-changed" : "feed-unknown";
                } catch (e) {
                    const failure = (e ?? {}) as ProbeFailure;
                    if (typeof failure.retryAt === "number") {
                        this.blockedUntil = failure.retryAt;
                        this.lastFailed = true;
                        this.told({ reason, did: "skip", why: "rate-limited", blockedUntil: this.blockedUntil });
                        return;
                    }
                    if (typeof failure.status !== "number") {
                        // GitHub was not reached: the API would not be either
                        this.lastFailed = true;
                        return;
                    }
                    // The feed is out of order, the API may not be
                    why = "feed-error";
                }
                if (!why) {
                    this.lastFailed = false;
                    this.told({ reason, did: "probe" });
                    return;
                }
            }

            const result = await this.deps.check(reason);
            this.lastFailed = !result.ok;
            if (result.retryAt !== undefined) this.blockedUntil = result.retryAt;
            if (result.ok) {
                this.lastCheck = this.deps.now();
                // Only now is the feed's new state the one to compare with: a check that failed is made again
                if (feed?.etag) this.etag = feed.etag;
                if (why === "feed-changed" && !result.found && this.recheckTimer === undefined) {
                    this.recheckTimer = this.deps.setTimer(() => {
                        this.recheckTimer = undefined;
                        void this.run("recheck");
                    }, RECHECK_DELAY_MS);
                }
            }
            this.told({ reason, did: "check", why, blockedUntil: result.retryAt });
        } finally {
            this.running = false;
            this.arm();
        }
    }
}
