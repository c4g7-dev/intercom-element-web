/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * InterCom diagnostics: everything the web app and Element Call say behind `[intercom-diag] ` on
 * the console, plus warnings and errors, is written to a JSON-lines file per app start in
 * `<userData>/logs`, so that a call can be judged afterwards from the file alone.
 */

import { app, type DownloadItem, shell, type WebContents } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getIntercomVersion } from "./build-config.js";

/** Element Call (InterCom build) writes its diagnostics records to the console behind this. */
const DIAG_PREFIX = "[intercom-diag] ";
/** Element Call downloads a frame snapshot under a name that starts with this. */
const SNAPSHOT_FILE_PREFIX = "intercom-snapshot-";

const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
/** A file is closed and a new one begun at this size, so that pruning has something to delete. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_CONSOLE_TEXT = 2000;
/** Console warnings and errors beyond this many per window of time are counted, not written. */
const CONSOLE_BURST = 200;
const CONSOLE_BURST_WINDOW_MS = 10_000;

type Json = Record<string, unknown>;

/** `diag-YYYYMMDD-HHMMSS` in local time. */
export function logFileStamp(date: Date): string {
    const p = (n: number): string => String(n).padStart(2, "0");
    return (
        `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
        `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
    );
}

/**
 * Take out of a console line whatever looks like a credential: bearer and access tokens, JWTs,
 * Matrix access tokens, values of fields named like a secret, and URL query strings.
 */
export function redactSecrets(text: string): string {
    return text
        .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, "<jwt>")
        .replace(/\b(syt|mat|mct|mas)_[\w-]{10,}/g, "<token>")
        .replace(/\b(Bearer)\s+[\w.~+/=-]{8,}/gi, "$1 <token>")
        .replace(
            /((?:access_?token|refresh_?token|id_?token|token|password|passphrase|secret|api_?key|session_?key|private_?key|recovery_?key|authorization)["']?\s*[:=]\s*["']?)(?!Bearer\b|<)[^\s"'&,;}\]]{4,}/gi,
            "$1<redacted>",
        )
        .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s?#"']+)\?[^\s"')]+/gi, "$1?<query>")
        .slice(0, MAX_CONSOLE_TEXT);
}

/**
 * Delete the oldest `diag-*.jsonl` files until what is left fits in `budget` bytes.
 * @returns the files deleted
 */
export function pruneLogs(dir: string, budget: number, keep?: string): string[] {
    let files: { file: string; size: number; mtime: number }[];
    try {
        files = fs
            .readdirSync(dir)
            .filter((name) => /^diag-.*\.jsonl$/.test(name))
            .map((name) => {
                const file = path.join(dir, name);
                const stat = fs.statSync(file);
                return { file, size: stat.size, mtime: stat.mtimeMs };
            })
            .sort((a, b) => a.mtime - b.mtime || a.file.localeCompare(b.file));
    } catch {
        return [];
    }
    let total = files.reduce((sum, { size }) => sum + size, 0);
    const deleted: string[] = [];
    for (const { file, size } of files) {
        if (total <= budget) break;
        if (file === keep) continue;
        try {
            fs.unlinkSync(file);
            total -= size;
            deleted.push(file);
        } catch {
            // A file that cannot be deleted stays counted
        }
    }
    return deleted;
}

/** One JSON-lines log, rolled over by size, with the directory kept within a total. */
export class DiagnosticsLog {
    private file!: string;
    private fd: number | undefined;
    private written = 0;
    private part = 0;
    private readonly stamp: string;

    public constructor(
        public readonly dir: string,
        started: Date = new Date(),
        private readonly maxTotalBytes = MAX_TOTAL_BYTES,
        private readonly maxFileBytes = MAX_FILE_BYTES,
    ) {
        this.stamp = logFileStamp(started);
        fs.mkdirSync(dir, { recursive: true });
        this.open();
    }

    public get path(): string {
        return this.file;
    }

    private open(): void {
        const suffix = this.part === 0 ? "" : `-${this.part}`;
        this.file = path.join(this.dir, `diag-${this.stamp}${suffix}.jsonl`);
        this.written = 0;
        // Room is made for this file before it is written, not after
        pruneLogs(this.dir, this.maxTotalBytes - this.maxFileBytes, this.file);
        this.fd = fs.openSync(this.file, "a");
    }

    /** Append one record as a line. Never throws: diagnostics must not take the app down. */
    public append(record: Json): void {
        try {
            if (this.fd === undefined) return;
            const line = JSON.stringify(record) + "\n";
            if (this.written > 0 && this.written + line.length > this.maxFileBytes) {
                fs.closeSync(this.fd);
                this.part++;
                this.open();
            }
            fs.writeSync(this.fd, line);
            this.written += line.length;
        } catch (e) {
            console.error("Failed to write the diagnostics log", e);
        }
    }

    public close(): void {
        if (this.fd === undefined) return;
        try {
            fs.closeSync(this.fd);
        } catch {
            // Already gone
        }
        this.fd = undefined;
    }
}

/** What Electron 44 passes to `console-message` listeners (the positional arguments are deprecated). */
interface ConsoleMessage {
    message: string;
    level: "info" | "warning" | "error" | "debug";
    lineNumber?: number;
    sourceId?: string;
    frame?: { url?: string; routingId?: number } | null;
}

/**
 * Turn one console message into the record to log, or nothing where it is neither a diagnostics
 * line nor a warning or error.
 */
export function consoleMessageToRecord(
    { message, level, lineNumber, sourceId, frame }: ConsoleMessage,
    window: string,
    now: Date = new Date(),
): Json | undefined {
    const envelope = { wall: now.toISOString(), window };
    if (message.startsWith(DIAG_PREFIX)) {
        try {
            const record: unknown = JSON.parse(message.slice(DIAG_PREFIX.length));
            if (typeof record === "object" && record !== null && !Array.isArray(record)) {
                return { ...envelope, ...(record as Json) };
            }
        } catch {
            // Falls through: kept as text so that a broken line is seen rather than lost
        }
        return { ...envelope, type: "diag_unparsed", text: redactSecrets(message.slice(DIAG_PREFIX.length)) };
    }
    if (level !== "warning" && level !== "error") return undefined;
    return {
        ...envelope,
        type: "console",
        level,
        text: redactSecrets(message),
        ...(sourceId && { source: `${describeUrl(sourceId)}:${lineNumber ?? 0}` }),
        ...frameOf(frame),
    };
}

/** A frame that is gone by the time it is asked throws rather than answers. */
function frameOf(frame: ConsoleMessage["frame"]): { frame?: string } {
    try {
        return frame?.url ? { frame: describeUrl(frame.url) } : {};
    } catch {
        return {};
    }
}

/** A URL without its query and fragment, which is where tokens ride. */
function describeUrl(url: string): string {
    return url.split(/[?#]/)[0].slice(0, 200);
}

let log: DiagnosticsLog | undefined;
const windowLabels = new Map<number, string>();
let burstStart = 0;
let burstCount = 0;
let dropped = 0;

function getDiagnosticsDir(): string {
    return path.join(app.getPath("userData"), "logs");
}

/** Write a record of the main process's own to the log. */
export function logDiagnostics(type: string, fields: Json = {}): void {
    log?.append({ wall: new Date().toISOString(), window: "main-process", t: Date.now(), type, ...fields });
}

/** Give a window a name in the log; without one it is logged by its webContents id. */
export function labelDiagnosticsWindow(webContents: WebContents, label: string): void {
    windowLabels.set(webContents.id, label);
    webContents.once("destroyed", () => windowLabels.delete(webContents.id));
}

function onConsoleMessage(webContents: WebContents, details: ConsoleMessage): void {
    if (!log || typeof details?.message !== "string") return;
    const record = consoleMessageToRecord(details, windowLabels.get(webContents.id) ?? `webcontents-${webContents.id}`);
    if (!record) return;
    if (record.type === "console") {
        const now = Date.now();
        if (now - burstStart > CONSOLE_BURST_WINDOW_MS) {
            if (dropped > 0) logDiagnostics("console_dropped", { count: dropped });
            burstStart = now;
            burstCount = 0;
            dropped = 0;
        }
        if (++burstCount > CONSOLE_BURST) {
            dropped++;
            return;
        }
    }
    log.append(record);
}

/**
 * Listen to the console of one webContents. Electron emits `console-message` for every frame of
 * the page (the event names the frame), so Element Call's iframe is covered by its window.
 */
function attachDiagnostics(webContents: WebContents): void {
    // Electron 44: one event object carrying the details and the frame that logged them
    webContents.on("console-message", (event) => onConsoleMessage(webContents, event));
    webContents.on("render-process-gone", (_ev, details) => {
        logDiagnostics("render_process_gone", {
            of: windowLabels.get(webContents.id) ?? `webcontents-${webContents.id}`,
            reason: details.reason,
            exitCode: details.exitCode,
        });
    });
}

/** What is known about this run when it starts. */
function appStartRecord(): Json {
    const switches = [
        "enable-features",
        "disable-features",
        "ozone-platform",
        "ozone-platform-hint",
        "use-gl",
        "use-angle",
    ];
    let gpuFeatureStatus: unknown;
    try {
        gpuFeatureStatus = app.getGPUFeatureStatus();
    } catch {
        gpuFeatureStatus = undefined;
    }
    return {
        app: app.getName(),
        version: app.getVersion(),
        electron: process.versions.electron,
        chromium: process.versions.chrome,
        node: process.versions.node,
        os: { platform: process.platform, release: os.release(), arch: process.arch, version: os.version() },
        sessionType: process.env.XDG_SESSION_TYPE ?? null,
        waylandDisplay: Boolean(process.env.WAYLAND_DISPLAY),
        desktop: process.env.XDG_CURRENT_DESKTOP ?? null,
        memoryGb: Math.round(os.totalmem() / 2 ** 30),
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model,
        featureSwitches: Object.fromEntries(
            switches
                .filter((name) => app.commandLine.hasSwitch(name))
                .map((name) => [name, app.commandLine.getSwitchValue(name)]),
        ),
        argv: process.argv.slice(1).map(redactSecrets),
        hwVideoEnv: process.env.INTERCOM_NO_HW_VIDEO ?? null,
        // HTTP/3 is off unless asked for (--enable-quic, INTERCOM_ENABLE_QUIC=1), see intercom.ts
        quic: app.commandLine.hasSwitch("disable-quic") ? "disabled" : "enabled",
        intercomVersion: getIntercomVersion() ?? null,
        gpuFeatureStatus,
    };
}

/**
 * Start the diagnostics log for this run and listen to every window there is and will be.
 * Call once the app is ready and known to be the primary instance.
 */
export function initDiagnostics(): void {
    if (log) return;
    try {
        log = new DiagnosticsLog(getDiagnosticsDir());
    } catch (e) {
        console.error("Diagnostics log disabled", e);
        return;
    }
    console.log(`Diagnostics log: ${log.path}`);
    logDiagnostics("app_start", appStartRecord());

    app.on("web-contents-created", (_ev, webContents) => attachDiagnostics(webContents));
    // The feature status is only final once the GPU process has reported
    app.once("gpu-info-update", () => {
        logDiagnostics("gpu", { gpuFeatureStatus: app.getGPUFeatureStatus() });
        app.getGPUInfo("basic")
            .then((info) => logDiagnostics("gpu_info", { info: summariseGpuInfo(info) }))
            .catch(() => undefined);
    });
    app.on("child-process-gone", (_ev, details) => {
        logDiagnostics("child_process_gone", { processType: details.type, reason: details.reason, name: details.name });
    });
    app.on("will-quit", () => {
        logDiagnostics("app_quit");
        log?.close();
    });
}

/** The devices and drivers out of Chromium's basic GPU info, which is otherwise long. */
export function summariseGpuInfo(info: unknown): Json {
    if (typeof info !== "object" || info === null) return {};
    const { gpuDevice, auxAttributes, machineModelName } = info as {
        gpuDevice?: Json[];
        auxAttributes?: Json;
        machineModelName?: string;
    };
    const aux = auxAttributes ?? {};
    return {
        devices: (gpuDevice ?? []).map((device) => ({
            active: device.active,
            vendorId: device.vendorId,
            deviceId: device.deviceId,
            driverVendor: device.driverVendor,
            driverVersion: device.driverVersion,
        })),
        glRenderer: aux.glRenderer,
        glVendor: aux.glVendor,
        glVersion: aux.glVersion,
        displayType: aux.displayType,
        hardwareSupportsVulkan: aux.hardwareSupportsVulkan,
        machineModelName,
    };
}

export function openDiagnosticsFolder(): void {
    const dir = getDiagnosticsDir();
    fs.mkdirSync(dir, { recursive: true });
    void shell.openPath(dir);
}

/**
 * Where a frame snapshot downloaded by Element Call is saved, or nothing for any other download.
 * Only a PNG made in the page itself (a blob) under the agreed name qualifies.
 */
export function snapshotSavePath(
    filename: string,
    url: string,
    dir: string = getDiagnosticsDir(),
    now: Date = new Date(),
): string | undefined {
    if (!url.startsWith("blob:")) return undefined;
    const match = /^intercom-snapshot-([A-Za-z0-9_][A-Za-z0-9_.-]{0,79})\.png$/.exec(filename);
    if (!match || match[1].includes("..")) return undefined;
    return path.join(dir, "snapshots", `${logFileStamp(now)}-${match[1]}.png`);
}

/**
 * Save a frame snapshot straight into the diagnostics folder, without a save dialog.
 * @returns whether the download was a snapshot and has been taken care of
 */
export function handleSnapshotDownload(item: DownloadItem): boolean {
    const filename = item.getFilename();
    if (!filename.startsWith(SNAPSHOT_FILE_PREFIX)) return false;
    const savePath = snapshotSavePath(filename, item.getURL());
    if (!savePath) return false;
    try {
        fs.mkdirSync(path.dirname(savePath), { recursive: true });
    } catch (e) {
        console.error("Failed to create the snapshot folder", e);
        return false;
    }
    item.setSavePath(savePath);
    item.once("done", (_ev, state) => {
        logDiagnostics("snapshot_saved", { file: path.basename(savePath), state, bytes: item.getReceivedBytes() });
    });
    return true;
}
