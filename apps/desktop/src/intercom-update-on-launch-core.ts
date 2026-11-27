/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Updating when the app starts, the parts that need no Electron: whether to look for an update
 * before the window opens, what to do with what the updater reports while the start waits for it,
 * what is remembered between starts so that a release that does not install is not tried at every
 * start, and the page of the small window that says what is going on.
 * The glue to the app is in intercom-update-on-launch.ts.
 */

import { compareIntercomVersions, parseIntercomVersion } from "./intercom-updater-core.js";
import { type UpdaterPhase } from "./intercom-updater-state.js";

/** How long GitHub has to say whether there is a newer release before the app starts without knowing. */
export const LAUNCH_CHECK_TIMEOUT_MS = 2000;
/** How long the start waits for the updater to end its check, whatever it does: the limit of a start that finds nothing. */
export const LAUNCH_CHECK_LIMIT_MS = 3000;
/** How long a download may go without a byte, or a later step without ending, before the app starts with what it is. */
export const LAUNCH_STALL_MS = 20 * 1000;
/** How long download, check and unpacking may take together before the app starts with what it is. */
export const LAUNCH_TOTAL_LIMIT_MS = 5 * 60 * 1000;

/** Why the start does not look for an update. */
export type LaunchSkipReason =
    /** Run from the sources, not from a package */
    | "unpackaged"
    /** A build that does not know its InterCom version */
    | "no-version"
    /** Started with `--no-update` */
    | "disabled-by-flag"
    /** Neither Linux nor Windows */
    | "platform"
    /** "Update automatically on launch" is off */
    | "setting-off"
    /** "Check for updates automatically" is off: nothing is asked of GitHub unasked */
    | "auto-check-off"
    /** An install this user cannot replace (a package under /opt, an AppImage) */
    | "not-writable";

/** What is known when the app starts, before anything is asked of GitHub. */
export interface LaunchCheckInput {
    /** Whether the app runs from a package */
    packaged: boolean;
    /** The InterCom release that is running, e.g. `1.12.35-intercom.7`; undefined in a build without one */
    currentVersion: string | undefined;
    /** False when started with `--no-update` */
    allowedByFlag: boolean;
    platform: NodeJS.Platform;
    /** The setting "Update automatically on launch" */
    updateOnLaunch: boolean;
    /** The setting "Check for updates automatically" */
    autoCheck: boolean;
    /** Whether this install can put a release in its own place */
    replaceable: boolean;
}

/**
 * Whether the start looks for an update before the window opens.
 * @returns the reason not to, or undefined to go ahead
 */
export function launchSkipReason(input: LaunchCheckInput): LaunchSkipReason | undefined {
    if (!input.packaged) return "unpackaged";
    if (!parseIntercomVersion(input.currentVersion)) return "no-version";
    if (!input.allowedByFlag) return "disabled-by-flag";
    if (input.platform !== "linux" && input.platform !== "win32") return "platform";
    if (!input.updateOnLaunch) return "setting-off";
    if (!input.autoCheck) return "auto-check-off";
    if (!input.replaceable) return "not-writable";
    return undefined;
}

/** What is remembered between starts, in the profile. */
export interface LaunchGuard {
    /** An install that was started and whose outcome the next start has to judge */
    attempt?: { from: string; to: string; at: number };
    /** A release that did not install when it was tried at a start: not tried at a start again */
    failed?: string;
}

/** What the start reads off the file of the guard: only what has the right shape. */
export function parseLaunchGuard(value: unknown): LaunchGuard {
    const guard: LaunchGuard = {};
    if (!value || typeof value !== "object") return guard;
    const { attempt, failed } = value as { attempt?: unknown; failed?: unknown };
    if (typeof failed === "string" && parseIntercomVersion(failed)) guard.failed = failed;
    if (attempt && typeof attempt === "object") {
        const { from, to, at } = attempt as { from?: unknown; to?: unknown; at?: unknown };
        if (typeof from === "string" && typeof to === "string" && parseIntercomVersion(to)) {
            guard.attempt = { from, to, at: typeof at === "number" ? at : 0 };
        }
    }
    return guard;
}

/** How the install that the last start began ended. */
export type LaunchAttemptOutcome = "none" | "installed" | "failed";

/**
 * Judges the install the last start began, now that the app runs again: if what runs is not at
 * least the release that was to be installed, that release failed, and is not tried at a start
 * again (the updater in the app still offers it, behind a click).
 * @returns the guard to keep from here on, and what became of the attempt
 */
export function settleLaunchGuard(
    guard: LaunchGuard,
    currentVersion: string | undefined,
): { guard: LaunchGuard; outcome: LaunchAttemptOutcome } {
    const current = parseIntercomVersion(currentVersion);
    const next: LaunchGuard = {};
    // A release that failed is forgotten once something at least as new runs
    const failed = parseIntercomVersion(guard.failed);
    if (failed && current && compareIntercomVersions(current, failed) < 0) next.failed = guard.failed;
    if (!guard.attempt) return { guard: next, outcome: "none" };
    const target = parseIntercomVersion(guard.attempt.to);
    if (target && current && compareIntercomVersions(current, target) >= 0) {
        return { guard: next, outcome: "installed" };
    }
    return { guard: { failed: guard.attempt.to }, outcome: "failed" };
}

/** What the updater shows of itself that the start goes by. */
export interface LaunchProgress {
    phase: UpdaterPhase;
    /** The newer release, once one is known */
    latestVersion?: string;
    /** 0 to 1 while downloading */
    progress?: number;
    /** How the last check failed, if it did: the updater is back to idle then, as after a check that found nothing */
    checkFailure?: "timeout" | "failed";
}

/** What the start does next. */
export type LaunchStep =
    /** Keep waiting for the updater */
    | { action: "wait" }
    /** The update is downloaded and checked: put it in place and start again */
    | { action: "install"; version: string }
    /** Start the app as it is; `reason` says why, `version` which release was found, if any */
    | { action: "start"; reason: LaunchStartReason; version?: string };

/** Why the app starts as it is after it looked for an update. */
export type LaunchStartReason =
    /** Nothing newer */
    | "up-to-date"
    /** GitHub did not answer in time, or not with a list of releases */
    | "check-failed"
    /** GitHub did not answer within {@link LAUNCH_CHECK_TIMEOUT_MS}, or the check did not end within {@link LAUNCH_CHECK_LIMIT_MS} */
    | "check-timeout"
    /** A newer release that has no file for this platform yet */
    | "no-asset"
    /** A newer release that did not install when a start tried it before */
    | "failed-before"
    /** The download, its check or the unpacking failed */
    | "error"
    /** Nothing moved for {@link LAUNCH_STALL_MS} */
    | "stalled"
    /** More than {@link LAUNCH_TOTAL_LIMIT_MS} in all */
    | "too-slow";

/** The times the start goes by, all in ms since the epoch. */
export interface LaunchClock {
    now: number;
    /** When the start began to look for an update */
    started: number;
    /** When the updater last reported anything: a step, or bytes of the download */
    lastChange: number;
}

/**
 * What the start does with where the updater stands.
 *
 * While the updater checks, the start waits at most {@link LAUNCH_CHECK_LIMIT_MS}. Once a newer
 * release is being fetched it waits for as long as something moves, within
 * {@link LAUNCH_TOTAL_LIMIT_MS}. Where the start stops waiting the updater is left to go on: what
 * it fetches is then offered in the app, behind "Restart to update".
 * @param seenWork - whether the updater was seen at work since the start asked it to check
 */
export function nextLaunchStep(
    progress: LaunchProgress,
    clock: LaunchClock,
    guard: LaunchGuard,
    seenWork: boolean,
): LaunchStep {
    const version = progress.latestVersion;
    switch (progress.phase) {
        case "idle":
            // Before the updater took the check up there is nothing to read off it
            if (!seenWork) break;
            // Back to idle after a check: nothing newer, or a check that failed
            if (progress.checkFailure === "timeout") return { action: "start", reason: "check-timeout" };
            if (progress.checkFailure) return { action: "start", reason: "check-failed" };
            return { action: "start", reason: "up-to-date" };
        case "checking":
            break;
        case "manual":
            return { action: "start", reason: "no-asset", version };
        case "error":
            return { action: "start", reason: version ? "error" : "check-failed", version };
        case "ready":
            if (!version) return { action: "start", reason: "error" };
            if (version === guard.failed) return { action: "start", reason: "failed-before", version };
            return { action: "install", version };
        case "downloading":
        case "verifying":
        case "unpacking":
            if (version !== undefined && version === guard.failed) {
                return { action: "start", reason: "failed-before", version };
            }
            if (clock.now - clock.lastChange >= LAUNCH_STALL_MS) return { action: "start", reason: "stalled", version };
            if (clock.now - clock.started >= LAUNCH_TOTAL_LIMIT_MS) {
                return { action: "start", reason: "too-slow", version };
            }
            return { action: "wait" };
        case "installing":
            return { action: "wait" };
    }
    if (clock.now - clock.started >= LAUNCH_CHECK_LIMIT_MS) return { action: "start", reason: "check-timeout" };
    return { action: "wait" };
}

/** What the small window says: one of these lines, and how far the bar is. */
export type SplashStatus =
    | { kind: "checking" }
    | { kind: "downloading"; percent: number | undefined }
    | { kind: "installing" }
    | { kind: "starting" };

/** What the small window shows for where the updater stands. */
export function splashStatusFor(progress: LaunchProgress): SplashStatus {
    switch (progress.phase) {
        case "downloading":
            return {
                kind: "downloading",
                percent:
                    typeof progress.progress === "number"
                        ? Math.max(0, Math.min(100, Math.floor(progress.progress * 100)))
                        : undefined,
            };
        case "verifying":
        case "unpacking":
        case "ready":
        case "installing":
            return { kind: "installing" };
        default:
            return { kind: "checking" };
    }
}

/**
 * Lattice's mark while something loads (intercom/brand/lattice-loading.svg): the three bars rise
 * and fall and the dots of the lattice light up in turn. The classes are its own (`lx-…`), since
 * its style sheet is part of the page it is put in. Still with reduced motion.
 */
const LOGO_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 512 512" aria-hidden="true"><style>' +
    ".lx-dot{fill:#6875f5;opacity:.25;animation:lx-dot 1.6s ease-in-out infinite}" +
    ".lx-bar{transform-box:fill-box;transform-origin:50% 50%;animation:lx-eq 1.1s ease-in-out infinite}" +
    ".lx-b1{animation-delay:-.35s}.lx-b2{animation-delay:0s}.lx-b3{animation-delay:-.7s}" +
    ".lx-d1{animation-delay:0s}.lx-d2{animation-delay:.12s}.lx-d3{animation-delay:.24s}" +
    ".lx-d4{animation-delay:.36s}.lx-d5{animation-delay:.48s}.lx-d6{animation-delay:.6s}" +
    "@keyframes lx-eq{0%,100%{transform:scaleY(.45)}50%{transform:scaleY(1)}}" +
    "@keyframes lx-dot{0%,100%{opacity:.18}40%{opacity:.75}}" +
    "@media (prefers-reduced-motion:reduce){.lx-bar,.lx-dot{animation:none}.lx-dot{opacity:.4}}" +
    "</style>" +
    '<rect x="16" y="16" width="480" height="480" rx="112" fill="#101013"/>' +
    '<rect x="17.5" y="17.5" width="477" height="477" rx="110.5" fill="none" stroke="#26262d" stroke-width="3"/>' +
    '<circle class="lx-dot lx-d1" cx="156" cy="132" r="22"/><circle class="lx-dot lx-d2" cx="256" cy="132" r="22"/>' +
    '<circle class="lx-dot lx-d3" cx="356" cy="132" r="22"/><circle class="lx-dot lx-d6" cx="156" cy="380" r="22"/>' +
    '<circle class="lx-dot lx-d5" cx="256" cy="380" r="22"/><circle class="lx-dot lx-d4" cx="356" cy="380" r="22"/>' +
    '<rect class="lx-bar lx-b1" x="134" y="196" width="44" height="120" rx="22" fill="#6875f5"/>' +
    '<rect class="lx-bar lx-b2" x="234" y="176" width="44" height="160" rx="22" fill="#eef0ff"/>' +
    '<rect class="lx-bar lx-b3" x="334" y="186" width="44" height="140" rx="22" fill="#6875f5"/></svg>';

function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * The page of the small window: the logo, one line and a thin bar, on the dark surface of the
 * room list. It loads nothing and runs nothing: the policy in it forbids every source but its
 * own style sheet, and the main process changes the line and the bar from outside.
 * @param brand - the app's name, for the title
 * @param status - the first line
 */
export function splashHtml(brand: string, status: string): string {
    return (
        '<!doctype html><html><head><meta charset="utf-8">' +
        "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">" +
        `<title>${escapeHtml(brand)}</title><style>` +
        "html,body{height:100%;margin:0;background:transparent;overflow:hidden}" +
        "body{display:flex;font:13px/1.4 Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;" +
        "color:#f0f0f3;user-select:none;cursor:default}" +
        "main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;" +
        "box-sizing:border-box;margin:0;padding:24px 28px;border:1px solid #202025;border-radius:12px;" +
        "background:#101013;-webkit-app-region:drag}" +
        "p{margin:0;color:#8d8d97;white-space:nowrap;font-variant-numeric:tabular-nums}" +
        "#bar{width:168px;height:3px;border-radius:999px;background:#27272d;overflow:hidden}" +
        "#fill{width:0;height:100%;border-radius:999px;background:#6875f5;transition:width .2s linear}" +
        // Nothing to measure yet: the bar's light moves from side to side
        "#bar.busy #fill{width:35%;animation:slide 1.2s ease-in-out infinite alternate}" +
        "@keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(286%)}}" +
        "@media (prefers-reduced-motion:reduce){#bar.busy #fill{animation:none;width:100%;opacity:.5}}" +
        "</style></head><body><main>" +
        LOGO_SVG +
        `<p id="status" role="status" aria-live="polite">${escapeHtml(status)}</p>` +
        '<div id="bar" class="busy"><div id="fill"></div></div>' +
        "</main></body></html>"
    );
}

/**
 * The script that sets the line and the bar of the small window. It is run by the main process;
 * the page itself may run none.
 * @param text - the line
 * @param percent - how far the bar is, 0 to 100; undefined where there is nothing to measure
 */
export function splashUpdateScript(text: string, percent: number | undefined): string {
    const known = typeof percent === "number" && Number.isFinite(percent);
    const width = known ? `${Math.max(0, Math.min(100, Math.round(percent)))}%` : "";
    return (
        "(()=>{const s=document.getElementById('status'),b=document.getElementById('bar')," +
        "f=document.getElementById('fill');if(!s||!b||!f)return;" +
        `s.textContent=${JSON.stringify(text)};b.classList.toggle('busy',${!known});` +
        `f.style.width=${JSON.stringify(width)};})()`
    );
}
