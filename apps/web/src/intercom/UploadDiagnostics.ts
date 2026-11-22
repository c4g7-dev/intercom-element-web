/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Where the time of an upload goes. Every phase of sending a file (decoding, thumbnail, blurhash,
 * reading, encrypting, the HTTP requests, the event) is written to the console behind
 * `[intercom-diag] ` as an `upload_phase` record, which the desktop app writes to its
 * diagnostics log. A record holds sizes, a MIME type and durations: never a file name, a room or
 * a URL.
 */

const DIAG_PREFIX = "[intercom-diag] ";

let nextUpload = 1;

function now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function round(ms: number): number {
    return Math.round(ms * 10) / 10;
}

export class UploadTrace {
    private readonly upload = nextUpload++;
    private readonly started = now();
    private readonly phases: Record<string, number> = {};

    /**
     * @param bytes - size of the file being sent
     * @param mime - its MIME type
     */
    public constructor(
        private readonly bytes: number,
        private readonly mime: string,
    ) {}

    /** Writes one finished phase. */
    public mark(phase: string, ms: number, extra?: Record<string, string | number | boolean | undefined>): void {
        this.phases[phase] = round((this.phases[phase] ?? 0) + ms);
        this.write({ phase, ms: round(ms), at: round(now() - this.started), ...extra });
    }

    /** Runs `fn` and writes how long it took, also when it throws. */
    public async time<T>(
        phase: string,
        fn: () => Promise<T> | T,
        extra?: Record<string, string | number | boolean | undefined>,
    ): Promise<T> {
        const start = now();
        let failed = false;
        try {
            return await fn();
        } catch (e) {
            failed = true;
            throw e;
        } finally {
            this.mark(phase, now() - start, failed ? { ...extra, failed: true } : extra);
        }
    }

    /** Writes the closing record: the whole duration and every phase beside each other. */
    public finish(outcome: "sent" | "failed" | "cancelled", extra?: Record<string, string | number | boolean>): void {
        this.write({ phase: "total", ms: round(now() - this.started), outcome, phases: this.phases, ...extra });
    }

    private write(record: Record<string, unknown>): void {
        try {
            console.log(
                DIAG_PREFIX +
                    JSON.stringify({
                        type: "upload_phase",
                        t: Date.now(),
                        upload: this.upload,
                        bytes: this.bytes,
                        mime: this.mime,
                        ...record,
                    }),
            );
        } catch {
            // Diagnostics never get in the way of an upload
        }
    }
}

/** A trace and the name its phases get, for the parts of an upload that are files of their own. */
export interface UploadTracePart {
    trace: UploadTrace;
    /** e.g. `thumb_`, so that a thumbnail's phases are told from the file's */
    prefix: string;
}
