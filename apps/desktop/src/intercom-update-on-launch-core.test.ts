/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import {
    LAUNCH_CHECK_LIMIT_MS,
    LAUNCH_STALL_MS,
    LAUNCH_TOTAL_LIMIT_MS,
    type LaunchCheckInput,
    type LaunchClock,
    launchSkipReason,
    nextLaunchStep,
    parseLaunchGuard,
    settleLaunchGuard,
    splashHtml,
    splashStatusFor,
    splashUpdateScript,
} from "./intercom-update-on-launch-core.js";

const CURRENT = "1.12.35-intercom.6";
const NEW = "1.12.35-intercom.7";

describe("whether a start looks for an update", () => {
    const ok: LaunchCheckInput = {
        packaged: true,
        currentVersion: CURRENT,
        allowedByFlag: true,
        platform: "linux",
        updateOnLaunch: true,
        autoCheck: true,
        replaceable: true,
    };

    it("does for a release that can replace itself, on Linux and on Windows", () => {
        expect(launchSkipReason(ok)).toBeUndefined();
        expect(launchSkipReason({ ...ok, platform: "win32" })).toBeUndefined();
    });

    it.each([
        ["run from the sources", { packaged: false }, "unpackaged"],
        ["a build without a version", { currentVersion: undefined }, "no-version"],
        ["a build with Element's version only", { currentVersion: "1.12.35" }, "no-version"],
        ["--no-update", { allowedByFlag: false }, "disabled-by-flag"],
        ["another system", { platform: "darwin" as const }, "platform"],
        ["the setting off", { updateOnLaunch: false }, "setting-off"],
        ["the automatic check off", { autoCheck: false }, "auto-check-off"],
        ["an install that is not the user's", { replaceable: false }, "not-writable"],
    ])("does not for %s", (_what, change, reason) => {
        expect(launchSkipReason({ ...ok, ...change })).toBe(reason);
    });

    it("names the first reason that applies", () => {
        expect(launchSkipReason({ ...ok, packaged: false, updateOnLaunch: false, replaceable: false })).toBe(
            "unpackaged",
        );
        expect(launchSkipReason({ ...ok, allowedByFlag: false, autoCheck: false })).toBe("disabled-by-flag");
    });
});

describe("what is remembered between starts", () => {
    it("reads only what has the right shape", () => {
        expect(parseLaunchGuard(undefined)).toEqual({});
        expect(parseLaunchGuard("nonsense")).toEqual({});
        expect(parseLaunchGuard({ failed: 7, attempt: "x" })).toEqual({});
        expect(parseLaunchGuard({ failed: "not-a-version" })).toEqual({});
        expect(parseLaunchGuard({ attempt: { from: CURRENT, to: "android-v1" } })).toEqual({});
        expect(parseLaunchGuard({ failed: NEW, attempt: { from: CURRENT, to: NEW, at: 5 }, more: 1 })).toEqual({
            failed: NEW,
            attempt: { from: CURRENT, to: NEW, at: 5 },
        });
        expect(parseLaunchGuard({ attempt: { from: CURRENT, to: NEW } }).attempt?.at).toBe(0);
    });

    it("has nothing to judge without an attempt", () => {
        expect(settleLaunchGuard({}, CURRENT)).toEqual({ guard: {}, outcome: "none" });
    });

    it("takes an install for done when the release runs, or a newer one", () => {
        const guard = { attempt: { from: CURRENT, to: NEW, at: 1 } };
        expect(settleLaunchGuard(guard, NEW)).toEqual({ guard: {}, outcome: "installed" });
        expect(settleLaunchGuard(guard, "1.12.36-intercom.1")).toEqual({ guard: {}, outcome: "installed" });
    });

    it("marks the release as failed when the old one still runs, so that a start does not try it again", () => {
        const guard = { attempt: { from: CURRENT, to: NEW, at: 1 } };
        expect(settleLaunchGuard(guard, CURRENT)).toEqual({ guard: { failed: NEW }, outcome: "failed" });
        // A build that lost its version cannot have become the release either
        expect(settleLaunchGuard(guard, undefined)).toEqual({ guard: { failed: NEW }, outcome: "failed" });
    });

    it("keeps a failed release until something at least as new runs", () => {
        expect(settleLaunchGuard({ failed: NEW }, CURRENT)).toEqual({ guard: { failed: NEW }, outcome: "none" });
        expect(settleLaunchGuard({ failed: NEW }, NEW)).toEqual({ guard: {}, outcome: "none" });
        expect(settleLaunchGuard({ failed: NEW }, "1.12.35-intercom.8")).toEqual({ guard: {}, outcome: "none" });
    });
});

describe("what a start does with where the updater stands", () => {
    const at = (elapsed: number, sinceChange = 0): LaunchClock => ({
        started: 1000,
        now: 1000 + elapsed,
        lastChange: 1000 + elapsed - sinceChange,
    });

    it("waits for the check, for three seconds at most", () => {
        expect(nextLaunchStep({ phase: "idle" }, at(0), {}, false)).toEqual({ action: "wait" });
        expect(nextLaunchStep({ phase: "checking" }, at(1500), {}, true)).toEqual({ action: "wait" });
        expect(nextLaunchStep({ phase: "checking" }, at(LAUNCH_CHECK_LIMIT_MS), {}, true)).toEqual({
            action: "start",
            reason: "check-timeout",
        });
        // An updater that never took the check up does not hold the start either
        expect(nextLaunchStep({ phase: "idle" }, at(LAUNCH_CHECK_LIMIT_MS), {}, false)).toEqual({
            action: "start",
            reason: "check-timeout",
        });
    });

    it("starts at once when there is nothing newer", () => {
        expect(nextLaunchStep({ phase: "idle" }, at(300), {}, true)).toEqual({ action: "start", reason: "up-to-date" });
    });

    it("starts at once when the check failed, and says how", () => {
        expect(nextLaunchStep({ phase: "idle", checkFailure: "timeout" }, at(2000), {}, true)).toEqual({
            action: "start",
            reason: "check-timeout",
        });
        expect(nextLaunchStep({ phase: "idle", checkFailure: "failed" }, at(200), {}, true)).toEqual({
            action: "start",
            reason: "check-failed",
        });
        expect(nextLaunchStep({ phase: "error" }, at(200), {}, true)).toEqual({
            action: "start",
            reason: "check-failed",
            version: undefined,
        });
    });

    it("starts when the newer release has no file for this install", () => {
        expect(nextLaunchStep({ phase: "manual", latestVersion: NEW }, at(400), {}, true)).toEqual({
            action: "start",
            reason: "no-asset",
            version: NEW,
        });
    });

    it("waits for a download as long as it moves, well beyond the limit of the check", () => {
        const downloading = { phase: "downloading" as const, latestVersion: NEW, progress: 0.4 };
        expect(nextLaunchStep(downloading, at(60_000, 200), {}, true)).toEqual({ action: "wait" });
        expect(nextLaunchStep({ ...downloading, phase: "verifying" }, at(60_000, 5000), {}, true)).toEqual({
            action: "wait",
        });
        expect(nextLaunchStep({ ...downloading, phase: "unpacking" }, at(60_000, 5000), {}, true)).toEqual({
            action: "wait",
        });
    });

    it("starts when a download stalls or takes too long", () => {
        const downloading = { phase: "downloading" as const, latestVersion: NEW, progress: 0.4 };
        expect(nextLaunchStep(downloading, at(60_000, LAUNCH_STALL_MS), {}, true)).toEqual({
            action: "start",
            reason: "stalled",
            version: NEW,
        });
        expect(nextLaunchStep(downloading, at(LAUNCH_TOTAL_LIMIT_MS, 100), {}, true)).toEqual({
            action: "start",
            reason: "too-slow",
            version: NEW,
        });
    });

    it("starts when the download, its check or the unpacking failed", () => {
        expect(nextLaunchStep({ phase: "error", latestVersion: NEW }, at(9000), {}, true)).toEqual({
            action: "start",
            reason: "error",
            version: NEW,
        });
    });

    it("installs what is ready", () => {
        expect(nextLaunchStep({ phase: "ready", latestVersion: NEW }, at(30_000), {}, true)).toEqual({
            action: "install",
            version: NEW,
        });
        // Also where it was ready before the start waited at all (downloaded by the run before)
        expect(nextLaunchStep({ phase: "ready", latestVersion: NEW }, at(LAUNCH_TOTAL_LIMIT_MS + 1), {}, true)).toEqual(
            { action: "install", version: NEW },
        );
        expect(nextLaunchStep({ phase: "ready" }, at(100), {}, true)).toEqual({ action: "start", reason: "error" });
    });

    it("does not try a release again that did not install at a start before", () => {
        const guard = { failed: NEW };
        expect(nextLaunchStep({ phase: "downloading", latestVersion: NEW }, at(500), guard, true)).toEqual({
            action: "start",
            reason: "failed-before",
            version: NEW,
        });
        expect(nextLaunchStep({ phase: "ready", latestVersion: NEW }, at(500), guard, true)).toEqual({
            action: "start",
            reason: "failed-before",
            version: NEW,
        });
        // The release after it is tried
        expect(nextLaunchStep({ phase: "ready", latestVersion: "1.12.35-intercom.8" }, at(500), guard, true)).toEqual({
            action: "install",
            version: "1.12.35-intercom.8",
        });
    });

    it("waits while the update is put in place", () => {
        expect(nextLaunchStep({ phase: "installing", latestVersion: NEW }, at(90_000, 60_000), {}, true)).toEqual({
            action: "wait",
        });
    });
});

describe("the small window", () => {
    it("says what the updater does", () => {
        expect(splashStatusFor({ phase: "idle" })).toEqual({ kind: "checking" });
        expect(splashStatusFor({ phase: "checking" })).toEqual({ kind: "checking" });
        expect(splashStatusFor({ phase: "downloading", progress: 0.429 })).toEqual({
            kind: "downloading",
            percent: 42,
        });
        expect(splashStatusFor({ phase: "downloading" })).toEqual({ kind: "downloading", percent: undefined });
        expect(splashStatusFor({ phase: "downloading", progress: 7 })).toEqual({ kind: "downloading", percent: 100 });
        for (const phase of ["verifying", "unpacking", "ready", "installing"] as const) {
            expect(splashStatusFor({ phase })).toEqual({ kind: "installing" });
        }
    });

    it("is a page that loads and runs nothing", () => {
        const html = splashHtml("Lattice", "Checking for updates…");
        expect(html).toContain("Content-Security-Policy");
        expect(html).toContain("default-src 'none'; style-src 'unsafe-inline'");
        expect(html).not.toMatch(/<script|https?:\/\/(?!www\.w3\.org\/2000\/svg)|<link|<img|url\(/i);
        expect(html).toContain("Checking for updates…");
        expect(html).toContain("#101013");
        expect(html).toContain("#6875f5");
    });

    it("escapes what it is given", () => {
        const html = splashHtml("<b>&", '<img src=x onerror="1">');
        expect(html).not.toContain("<b>");
        expect(html).not.toContain("<img");
        expect(html).toContain("&#60;img");
    });

    it("sets the line and the bar with a script that quotes its text", () => {
        const script = splashUpdateScript('Downloading update · 42 % "</script>', 42.4);
        expect(script).toContain(JSON.stringify('Downloading update · 42 % "</script>'));
        expect(script).toContain('f.style.width="42%"');
        expect(script).toContain("toggle('busy',false)");
        // Nothing to measure: the bar is left to move by itself
        const busy = splashUpdateScript("Installing…", undefined);
        expect(busy).toContain("toggle('busy',true)");
        expect(busy).toContain('f.style.width=""');
        expect(splashUpdateScript("x", 250)).toContain('"100%"');
    });
});
