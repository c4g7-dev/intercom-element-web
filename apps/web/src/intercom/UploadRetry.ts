/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    HTTPError,
    MatrixError,
    type MatrixClient,
    type UploadOpts,
    type UploadResponse,
} from "matrix-js-sdk/src/matrix";

/**
 * An upload that fails is tried once more after a short wait before the user is told: a request
 * that died with its connection (a proxy restarting, a network change, HTTP/3 giving up) very
 * often goes through the second time. What the server refused for a reason (too large, not
 * allowed) is not tried again.
 *
 * Every failure is written to the diagnostics log as an `upload_failed` record with the HTTP
 * status, the kind of error and the protocol the request went over (h2, h3, http/1.1): never a
 * file name or a URL.
 *
 * An upload also has to look after the access token itself. On a homeserver that signs in through
 * OAuth (Matrix Authentication Service) the token lives for a few minutes and is renewed with a
 * refresh token. matrix-js-sdk does that for its ordinary requests, but `uploadContent` sends the
 * file with XMLHttpRequest and whatever token it has at that moment: with an expired one the
 * server answers 401 M_UNKNOWN_TOKEN and the upload failed, until some other request renewed the
 * token. So the token is renewed here: before an upload when it is about to run out, and after a
 * 401 M_UNKNOWN_TOKEN, followed by one more try. Each renewal is an `upload_token_refresh` record.
 */

const DIAG_PREFIX = "[intercom-diag] ";

/** How long to wait before the second try. */
export const UPLOAD_RETRY_DELAY_MS = 1500;

/** A token with less than this left is renewed before an upload starts. */
export const UPLOAD_TOKEN_MARGIN_MS = 60 * 1000;

/** The upload failed because the access token could not be renewed. */
export class UploadTokenRefreshError extends Error {
    public constructor(cause: unknown) {
        super("The access token expired and could not be renewed");
        this.name = "UploadTokenRefreshError";
        this.cause = cause;
    }
}

/** Whether the server refused a request because its access token is not (or no longer) valid. */
export function isExpiredTokenError(error: unknown): boolean {
    return error instanceof MatrixError && error.httpStatus === 401 && error.errcode === "M_UNKNOWN_TOKEN";
}

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

function write(type: string, record: Record<string, unknown>): void {
    try {
        console.log(DIAG_PREFIX + JSON.stringify({ type, t: Date.now(), ...record }));
    } catch {
        // Diagnostics never get in the way of an upload
    }
}

function writeFailure(record: Record<string, unknown>): void {
    write("upload_failed", record);
}

/**
 * The part of matrix-js-sdk that renews the access token. It is private there, so every use is
 * guarded: where it is not what is expected, nothing is renewed ahead of time and a 401 is
 * handled by {@link renewAfterRefusal}, which needs none of it.
 */
interface TokenManagerLike {
    latestTokenRefreshExpiry?: Date;
    _handleUnknownToken?: () => Promise<string>;
}

function tokenManagerOf(client: MatrixClient): TokenManagerLike | undefined {
    const manager = (client as unknown as { http?: { tokenManager?: TokenManagerLike } }).http?.tokenManager;
    return manager && typeof manager === "object" ? manager : undefined;
}

/**
 * Renews the access token before an upload when it is known to run out within
 * {@link UPLOAD_TOKEN_MARGIN_MS}: the server looks at the token when the file has arrived, which
 * for a large file is some time after the request began. Never throws: an upload that then is
 * refused is handled as any other.
 */
export async function renewTokenIfExpiring(client: MatrixClient, now = Date.now()): Promise<void> {
    const manager = tokenManagerOf(client);
    const expiry = manager?.latestTokenRefreshExpiry;
    if (!manager || !(expiry instanceof Date) || typeof manager._handleUnknownToken !== "function") return;
    const expiresInMs = expiry.getTime() - now;
    if (expiresInMs > UPLOAD_TOKEN_MARGIN_MS) return;
    const started = Date.now();
    let outcome: string;
    try {
        outcome = await manager._handleUnknownToken();
    } catch (e) {
        outcome = e instanceof Error ? e.name : "error";
    }
    write("upload_token_refresh", {
        reason: "expiring",
        expiresInMs: Math.round(expiresInMs),
        ok: outcome === "success",
        outcome,
        ms: Date.now() - started,
    });
}

/**
 * Renews the access token after the server refused an upload for it. An ordinary request is made
 * for that (`/account/whoami`): matrix-js-sdk answers its 401 by renewing the token and trying
 * again, and where the session is really over it says so to the app as it does for any request.
 * @throws UploadTokenRefreshError if the token could not be renewed
 */
async function renewAfterRefusal(client: MatrixClient): Promise<void> {
    const started = Date.now();
    try {
        await client.whoami();
        write("upload_token_refresh", { reason: "refused", ok: true, ms: Date.now() - started });
    } catch (e) {
        write("upload_token_refresh", {
            reason: "refused",
            ok: false,
            ...describeFailure(e),
            ms: Date.now() - started,
        });
        throw new UploadTokenRefreshError(e);
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
 * another try can mend, and with an access token that is renewed when it has run out or is about
 * to. An upload the user cancelled is not tried again.
 * @throws what the last try threw, or UploadTokenRefreshError when the token could not be renewed
 */
export async function uploadContentWithRetry(
    client: MatrixClient,
    body: Parameters<MatrixClient["uploadContent"]>[0],
    opts: UploadOpts,
    { delayMs = UPLOAD_RETRY_DELAY_MS, protocol = lastUploadProtocol }: RetryOptions = {},
): Promise<UploadResponse> {
    const signal = opts.abortController?.signal;
    await renewTokenIfExpiring(client);
    // Each kind of second try is made once: one for the connection, one for the token
    let retried = false;
    let renewed = false;
    for (let attempt = 1; ; attempt++) {
        try {
            return await client.uploadContent(body, opts);
        } catch (error) {
            const cancelled = signal?.aborted === true;
            const renew = !cancelled && !renewed && isExpiredTokenError(error);
            const retry = !cancelled && !renew && !retried && isRetryableUploadError(error);
            if (!cancelled) {
                writeFailure({
                    attempt,
                    bytes: (body as Blob).size,
                    ...describeFailure(error),
                    protocol: protocol() ?? null,
                    online: typeof navigator !== "undefined" ? navigator.onLine : null,
                    willRetry: renew || retry,
                    ...(renew ? { tokenRefresh: true } : {}),
                });
            }
            if (renew) {
                renewed = true;
                await renewAfterRefusal(client);
            } else if (retry) {
                retried = true;
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            } else {
                throw error;
            }
            if (signal?.aborted) throw error;
        }
    }
}
