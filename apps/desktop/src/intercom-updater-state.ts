/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Where an update stands, as a state machine without Electron: the steps it goes through, what
 * may follow what, and a short log of the steps for the window to show. The work itself is in
 * intercom-updater.ts, which sends the events.
 *
 *   idle ─check→ checking ─up_to_date→ idle
 *                checking ─manual→ manual          (a newer release this install cannot put in place)
 *                checking ─download→ downloading ─verify→ verifying ─unpack→ unpacking ─ready→ ready
 *                                                         verifying ─ready→ ready       (Windows)
 *   ready ─install→ installing
 *   any step of the work ─error→ error             (or back to idle for a check nobody asked for)
 *   manual, error ─check→ checking
 */

export type UpdaterPhase =
    | "idle"
    | "checking"
    | "downloading"
    | "verifying"
    | "unpacking"
    | "ready"
    | "installing"
    | "manual"
    | "error";

/** One line of the updater's log. */
export interface UpdaterLogLine {
    /** When, in ms since the epoch */
    t: number;
    text: string;
}

/** How far a download is. */
export interface UpdaterDownload {
    /** Bytes received */
    done: number;
    /** Bytes of the whole file; 0 where the server did not say */
    total: number;
    bytesPerSecond: number;
}

export interface UpdaterMachine {
    phase: UpdaterPhase;
    /** The newer release, once one is known */
    latestVersion?: string;
    releaseUrl?: string;
    /** 0 to 1 while downloading */
    progress?: number;
    download?: UpdaterDownload;
    error?: string;
    /** When the last check ended, in ms since the epoch */
    lastChecked?: number;
    /** The last steps, oldest first; at most {@link UPDATER_LOG_LINES} */
    log: UpdaterLogLine[];
}

export type UpdaterEvent =
    | { type: "check" }
    | { type: "up_to_date" }
    | { type: "manual"; version: string; releaseUrl: string }
    | { type: "download"; version: string; releaseUrl: string; total?: number }
    | { type: "progress"; done: number; total: number; bytesPerSecond: number }
    | { type: "verify" }
    | { type: "unpack" }
    | { type: "ready" }
    | { type: "install" }
    /** `quiet`: a check nobody asked for failed, which is logged and otherwise not shown */
    | { type: "error"; message: string; quiet?: boolean };

/** How many lines the log keeps. */
export const UPDATER_LOG_LINES = 10;

/** The phases in which the updater is at work and a new check is not started. */
const WORKING: ReadonlySet<UpdaterPhase> = new Set(["checking", "downloading", "verifying", "unpacking", "installing"]);

/** Whether the updater is at work: a check is not started then. */
export function isWorking(phase: UpdaterPhase): boolean {
    return WORKING.has(phase);
}

/** What may follow what: for every event, the phases it is taken in. */
const TAKEN_IN: Record<UpdaterEvent["type"], readonly UpdaterPhase[]> = {
    check: ["idle", "manual", "error"],
    up_to_date: ["checking"],
    manual: ["checking"],
    // From "verifying" too: a file that was there already and turned out not to be whole
    download: ["checking", "verifying"],
    progress: ["downloading"],
    verify: ["downloading"],
    unpack: ["verifying"],
    ready: ["verifying", "unpacking"],
    install: ["ready"],
    error: ["checking", "downloading", "verifying", "unpacking", "installing"],
};

export function initialUpdaterMachine(): UpdaterMachine {
    return { phase: "idle", log: [] };
}

/** `1.5 MB`, `186 MB`, `2.1 GB`: decimal units, as download pages give them. */
export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
    if (bytes < 1000) return `${Math.round(bytes)} B`;
    const units = ["kB", "MB", "GB", "TB"];
    let value = bytes / 1000;
    let unit = 0;
    while (value >= 1000 && unit < units.length - 1) {
        value /= 1000;
        unit++;
    }
    return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

const DOWNLOAD_LINE = "Downloading ";

function downloadLine(version: string | undefined, download: UpdaterDownload): string {
    const parts = [DOWNLOAD_LINE + (version ?? "")];
    if (download.total > 0) {
        parts.push(`${Math.floor((download.done / download.total) * 100)} %`);
        parts.push(`${formatBytes(download.done)} / ${formatBytes(download.total)}`);
    } else if (download.done > 0) {
        parts.push(formatBytes(download.done));
    }
    if (download.bytesPerSecond > 0) parts.push(`${formatBytes(download.bytesPerSecond)}/s`);
    return parts.join(" · ");
}

function withLine(log: UpdaterLogLine[], now: number, text: string, replaceDownload = false): UpdaterLogLine[] {
    const last = log[log.length - 1];
    // The progress of one download is one line that changes, not a line per report
    const kept = replaceDownload && last?.text.startsWith(DOWNLOAD_LINE) ? log.slice(0, -1) : log;
    return [...kept, { t: now, text }].slice(-UPDATER_LOG_LINES);
}

/**
 * The state after an event. An event that does not belong to the phase the machine is in
 * (a second "check" while one runs, "install" with nothing ready) changes nothing: the same
 * object is returned.
 * @param now - the time of the event, in ms since the epoch
 */
export function updaterTransition(state: UpdaterMachine, event: UpdaterEvent, now: number): UpdaterMachine {
    if (!TAKEN_IN[event.type]?.includes(state.phase)) return state;

    switch (event.type) {
        case "check":
            return {
                ...state,
                phase: "checking",
                error: undefined,
                progress: undefined,
                download: undefined,
                log: withLine(state.log, now, "Checking for updates…"),
            };
        case "up_to_date":
            return {
                ...state,
                phase: "idle",
                latestVersion: undefined,
                releaseUrl: undefined,
                lastChecked: now,
                log: withLine(state.log, now, "Lattice is up to date"),
            };
        case "manual":
            return {
                ...state,
                phase: "manual",
                latestVersion: event.version,
                releaseUrl: event.releaseUrl,
                lastChecked: now,
                log: withLine(state.log, now, `${event.version} is available; this install cannot update itself`),
            };
        case "download": {
            const download = { done: 0, total: event.total ?? 0, bytesPerSecond: 0 };
            return {
                ...state,
                phase: "downloading",
                latestVersion: event.version,
                releaseUrl: event.releaseUrl,
                lastChecked: state.phase === "checking" ? now : state.lastChecked,
                progress: 0,
                download,
                log: withLine(
                    state.phase === "checking" ? withLine(state.log, now, `Found ${event.version}`) : state.log,
                    now,
                    downloadLine(event.version, download),
                ),
            };
        }
        case "progress": {
            const download = {
                done: Math.max(0, event.done),
                total: Math.max(0, event.total),
                bytesPerSecond: Math.max(0, Math.round(event.bytesPerSecond)),
            };
            return {
                ...state,
                progress: download.total > 0 ? Math.min(1, download.done / download.total) : state.progress,
                download,
                log: withLine(state.log, now, downloadLine(state.latestVersion, download), true),
            };
        }
        case "verify":
            return {
                ...state,
                phase: "verifying",
                progress: undefined,
                log: withLine(state.log, now, "Verifying checksum…"),
            };
        case "unpack":
            return { ...state, phase: "unpacking", log: withLine(state.log, now, "Unpacking…") };
        case "ready":
            return {
                ...state,
                phase: "ready",
                progress: undefined,
                download: undefined,
                log: withLine(state.log, now, `${state.latestVersion ?? "The update"} is ready: restart to update`),
            };
        case "install":
            return { ...state, phase: "installing", log: withLine(state.log, now, "Installing and restarting…") };
        case "error":
            if (event.quiet && state.phase === "checking") {
                return {
                    ...state,
                    phase: "idle",
                    lastChecked: now,
                    log: withLine(state.log, now, `Check failed: ${event.message}`),
                };
            }
            return {
                ...state,
                phase: "error",
                error: event.message,
                progress: undefined,
                download: undefined,
                lastChecked: now,
                log: withLine(state.log, now, `Error: ${event.message}`),
            };
    }
}

/**
 * The speed of a download, from what arrived in the last few seconds: steadier than the last
 * chunk's, quicker to follow than the average since the start.
 */
export class SpeedMeter {
    private samples: Array<{ t: number; done: number }> = [];

    /** @param windowMs - how far back the speed looks */
    public constructor(private readonly windowMs = 3000) {}

    /**
     * Notes how far the download is.
     * @returns bytes per second over the window; 0 until there are two notes
     */
    public note(done: number, now: number): number {
        this.samples.push({ t: now, done });
        // The newest note that is older than the window is kept, as the window's start
        while (this.samples.length > 2 && this.samples[1].t <= now - this.windowMs) this.samples.shift();
        const first = this.samples[0];
        const elapsed = now - first.t;
        return elapsed > 0 ? ((done - first.done) / elapsed) * 1000 : 0;
    }
}
