/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { HTTPError, type MatrixClient, type UploadOpts, type UploadResponse } from "matrix-js-sdk/src/matrix";
import { type FileType } from "matrix-js-sdk/src/http-api";

/**
 * An upload that fails is tried once more after a short wait before the user is told: a request
 * that died with its connection (a proxy restarting, a network change, HTTP/3 giving up) very
 * often goes through the second time. What the server refused for a reason (too large, not
 * allowed) is not tried again.
 *
 * Every failure is written to the diagnostics log as an `upload_failed` record with the HTTP
 * status, the kind of error and the protocol the request went over (h2, h3, http/1.1): never a
 * file name or a URL.
 */

const DIAG_PREFIX = "[intercom-diag] ";

/** How long to wait before the second try. */
export const UPLOAD_RETRY_DELAY_MS = 1500;

/** Whether an upload that failed like this is worth another try. */
export function isRetryableUploadError(error: unknown): boolean {
    if (error instanceof HTTPError && typeof error.httpStatus === "number") {
        const status = error.httpStatus;
        // The server answered: only "try again" kinds of answers are tried again
        return status >= 500 || status === 408 || status === 429;
    }
    if (error instanceof DOMException && error.name === "AbortError") return false;
    // No answer at all: the connection failed or timed out
    return true;
}

/**
 * The protocol the last upload request went over, as the browser reports it ("h2", "h3",
 * "http/1.1"), or undefined where it does not say.
 */
export function lastUploadProtocol(
    entries: readonly Pick<PerformanceResourceTiming, "name" | "nextHopProtocol">[] = resourceEntries(),
): string | undefined {
    for (let i = entries.length - 1; i >= 0; i--) {
        if (/\/_matrix\/media\/[^/]+\/upload/.test(entries[i].name)) return entries[i].nextHopProtocol || undefined;
    }
    return undefined;
}

function resourceEntries(): PerformanceResourceTiming[] {
    try {
        return performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    } catch {
        return [];
    }
}

function describeFailure(error: unknown): { status?: number; error: string } {
    if (error instanceof HTTPError) {
        return { status: error.httpStatus, error: (error as { errcode?: string }).errcode ?? error.name };
    }
    return { error: error instanceof Error ? error.name : typeof error };
}

function writeFailure(record: Record<string, unknown>): void {
    try {
        console.log(DIAG_PREFIX + JSON.stringify({ type: "upload_failed", t: Date.now(), ...record }));
    } catch {
        // Diagnostics never get in the way of an upload
    }
}

interface RetryOptions {
    /** How long to wait before the second try; for tests. */
    delayMs?: number;
    /** Stands in for the browser's list of requests; for tests. */
    protocol?: () => string | undefined;
}

/**
 * `MatrixClient.uploadContent`, tried a second time when the first try fails in a way that
 * another try can mend. An upload the user cancelled is not tried again.
 * @throws what the last try threw
 */
export async function uploadContentWithRetry(
    client: MatrixClient,
    body: FileType,
    opts: UploadOpts,
    { delayMs = UPLOAD_RETRY_DELAY_MS, protocol = lastUploadProtocol }: RetryOptions = {},
): Promise<UploadResponse> {
    const signal = opts.abortController?.signal;
    for (let attempt = 1; ; attempt++) {
        try {
            return await client.uploadContent(body, opts);
        } catch (error) {
            const cancelled = signal?.aborted === true;
            const willRetry = attempt === 1 && !cancelled && isRetryableUploadError(error);
            if (!cancelled) {
                writeFailure({
                    attempt,
                    bytes: (body as Blob).size,
                    ...describeFailure(error),
                    protocol: protocol() ?? null,
                    online: typeof navigator !== "undefined" ? navigator.onLine : null,
                    willRetry,
                });
            }
            if (!willRetry) throw error;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            if (signal?.aborted) throw error;
        }
    }
}
