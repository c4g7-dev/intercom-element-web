/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { ConnectionError, HTTPError, MatrixError, type MatrixClient } from "matrix-js-sdk/src/matrix";

import {
    isExpiredTokenError,
    isRetryableUploadError,
    lastUploadProtocol,
    renewTokenIfExpiring,
    UploadTokenRefreshError,
    uploadContentWithRetry,
} from "./UploadRetry";

function clientWith(uploadContent: unknown): MatrixClient {
    return { uploadContent } as unknown as MatrixClient;
}

const blob = new Blob(["picture"]);
const ok = { content_uri: "mxc://server/file" };
const options = { delayMs: 0, protocol: (): string => "h3" };

describe("isRetryableUploadError", () => {
    it("tries again what another try can mend", () => {
        expect(isRetryableUploadError(new ConnectionError("fetch failed"))).toBe(true);
        expect(isRetryableUploadError(new TypeError("Failed to fetch"))).toBe(true);
        expect(isRetryableUploadError(new HTTPError("Bad gateway", 502))).toBe(true);
        expect(isRetryableUploadError(new HTTPError("Timeout", 408))).toBe(true);
        expect(isRetryableUploadError(new HTTPError("Slow down", 429))).toBe(true);
    });

    it("leaves alone what the server refused", () => {
        expect(isRetryableUploadError(new MatrixError({ errcode: "M_TOO_LARGE" }, 413))).toBe(false);
        expect(isRetryableUploadError(new HTTPError("Forbidden", 403))).toBe(false);
        expect(isRetryableUploadError(new DOMException("Aborted", "AbortError"))).toBe(false);
    });
});

describe("lastUploadProtocol", () => {
    it("reads the protocol of the latest upload request", () => {
        const entries = [
            { name: "https://hs/_matrix/media/v3/upload?filename=a.png", nextHopProtocol: "h2" },
            { name: "https://hs/_matrix/client/v3/sync", nextHopProtocol: "h2" },
            { name: "https://hs/_matrix/media/v3/upload", nextHopProtocol: "h3" },
            { name: "https://hs/_matrix/client/v1/media/download/hs/x", nextHopProtocol: "http/1.1" },
        ];
        expect(lastUploadProtocol(entries)).toBe("h3");
        expect(lastUploadProtocol(entries.slice(1, 2))).toBeUndefined();
        expect(
            lastUploadProtocol([{ name: "https://hs/_matrix/media/v3/upload", nextHopProtocol: "" }]),
        ).toBeUndefined();
    });
});

describe("uploadContentWithRetry", () => {
    let log: MockInstance<typeof console.log>;
    const records = (): Record<string, unknown>[] =>
        log.mock.calls
            .map(([line]) => String(line))
            .filter((line) => line.startsWith("[intercom-diag] "))
            .map((line) => JSON.parse(line.slice("[intercom-diag] ".length)));

    beforeEach(() => {
        log = vi.spyOn(console, "log").mockImplementation(() => {});
    });
    afterEach(() => {
        log.mockRestore();
    });

    it("uploads once when that works, and writes nothing", async () => {
        const upload = vi.fn().mockResolvedValue(ok);
        await expect(uploadContentWithRetry(clientWith(upload), blob, {}, options)).resolves.toBe(ok);
        expect(upload).toHaveBeenCalledTimes(1);
        expect(records()).toEqual([]);
    });

    it("tries a second time after a connection failure, and logs the first", async () => {
        const upload = vi.fn().mockRejectedValueOnce(new ConnectionError("fetch failed")).mockResolvedValue(ok);
        const opts = { abortController: new AbortController() };
        await expect(uploadContentWithRetry(clientWith(upload), blob, opts, options)).resolves.toBe(ok);
        expect(upload).toHaveBeenCalledTimes(2);
        expect(upload).toHaveBeenLastCalledWith(blob, opts);
        expect(records()).toEqual([
            expect.objectContaining({
                type: "upload_failed",
                attempt: 1,
                bytes: blob.size,
                error: "ConnectionError",
                protocol: "h3",
                willRetry: true,
            }),
        ]);
        expect(JSON.stringify(records())).not.toContain("mxc://");
    });

    it("gives up after the second failure, with both logged", async () => {
        const second = new HTTPError("Bad gateway", 502);
        const upload = vi.fn().mockRejectedValueOnce(new ConnectionError("x")).mockRejectedValue(second);
        await expect(uploadContentWithRetry(clientWith(upload), blob, {}, options)).rejects.toBe(second);
        expect(upload).toHaveBeenCalledTimes(2);
        expect(records()).toEqual([
            expect.objectContaining({ attempt: 1, willRetry: true }),
            expect.objectContaining({ attempt: 2, status: 502, willRetry: false }),
        ]);
    });

    it("does not try again what the server refused", async () => {
        const tooLarge = new MatrixError({ errcode: "M_TOO_LARGE" }, 413);
        const upload = vi.fn().mockRejectedValue(tooLarge);
        await expect(uploadContentWithRetry(clientWith(upload), blob, {}, options)).rejects.toBe(tooLarge);
        expect(upload).toHaveBeenCalledTimes(1);
        expect(records()).toEqual([
            expect.objectContaining({ attempt: 1, status: 413, error: "M_TOO_LARGE", willRetry: false }),
        ]);
    });

    it("does not try again, nor log, an upload the user cancelled", async () => {
        const abortController = new AbortController();
        const upload = vi.fn().mockImplementation(async () => {
            abortController.abort();
            throw new DOMException("Aborted", "AbortError");
        });
        await expect(uploadContentWithRetry(clientWith(upload), blob, { abortController }, options)).rejects.toThrow();
        expect(upload).toHaveBeenCalledTimes(1);
        expect(records()).toEqual([]);
    });

    it("does not start the second try when the user cancels during the wait", async () => {
        const abortController = new AbortController();
        const upload = vi.fn().mockRejectedValue(new ConnectionError("x"));
        const pending = uploadContentWithRetry(
            clientWith(upload),
            blob,
            { abortController },
            { ...options, delayMs: 20 },
        );
        await Promise.resolve();
        abortController.abort();
        await expect(pending).rejects.toThrow();
        expect(upload).toHaveBeenCalledTimes(1);
    });

    describe("with an access token that runs out", () => {
        const expired = (): MatrixError =>
            new MatrixError({ errcode: "M_UNKNOWN_TOKEN", error: "Token is not active" }, 401);

        /**
         * A client whose uploads are sent with the token it has at that moment, as matrix-js-sdk
         * does, and whose ordinary requests renew a token the server refuses.
         */
        function oauthClient(serverAccepts: () => string, refresh: () => Promise<string>) {
            const http = { opts: { accessToken: "old" } };
            const uploadContent = vi.fn(async () => {
                if (http.opts.accessToken !== serverAccepts()) throw expired();
                return ok;
            });
            const whoami = vi.fn(async () => {
                if (http.opts.accessToken !== serverAccepts()) http.opts.accessToken = await refresh();
                return { user_id: "@ada:hs" };
            });
            return { client: { uploadContent, whoami, http } as unknown as MatrixClient, uploadContent, whoami };
        }

        it("knows the answer to an expired token from other refusals", () => {
            expect(isExpiredTokenError(expired())).toBe(true);
            expect(isExpiredTokenError(new MatrixError({ errcode: "M_FORBIDDEN" }, 403))).toBe(false);
            expect(isExpiredTokenError(new MatrixError({ errcode: "M_MISSING_TOKEN" }, 401))).toBe(false);
            expect(isExpiredTokenError(new HTTPError("Unauthorized", 401))).toBe(false);
        });

        it("renews an expired token and uploads again with the new one", async () => {
            const refresh = vi.fn().mockResolvedValue("new");
            const { client, uploadContent, whoami } = oauthClient(() => "new", refresh);
            await expect(uploadContentWithRetry(client, blob, {}, options)).resolves.toBe(ok);
            expect(uploadContent).toHaveBeenCalledTimes(2);
            expect(whoami).toHaveBeenCalledTimes(1);
            expect(refresh).toHaveBeenCalledTimes(1);
            expect(records()).toEqual([
                expect.objectContaining({
                    type: "upload_failed",
                    status: 401,
                    error: "M_UNKNOWN_TOKEN",
                    willRetry: true,
                    tokenRefresh: true,
                }),
                expect.objectContaining({ type: "upload_token_refresh", reason: "refused", ok: true }),
            ]);
            expect(JSON.stringify(records())).not.toContain("new");
        });

        it("does not wait before the try that follows a renewed token", async () => {
            const { client } = oauthClient(() => "new", vi.fn().mockResolvedValue("new"));
            const started = Date.now();
            await uploadContentWithRetry(client, blob, {}, { ...options, delayMs: 5000 });
            expect(Date.now() - started).toBeLessThan(1000);
        });

        it("fails with a clear error when the token cannot be renewed", async () => {
            const refresh = vi.fn().mockRejectedValue(new ConnectionError("fetch failed"));
            const { client, uploadContent } = oauthClient(() => "new", refresh);
            const failure = await uploadContentWithRetry(client, blob, {}, options).catch((e) => e);
            expect(failure).toBeInstanceOf(UploadTokenRefreshError);
            expect(failure.cause).toBeInstanceOf(ConnectionError);
            expect(uploadContent).toHaveBeenCalledTimes(1);
            expect(records()).toEqual([
                expect.objectContaining({ type: "upload_failed", status: 401, tokenRefresh: true }),
                expect.objectContaining({
                    type: "upload_token_refresh",
                    reason: "refused",
                    ok: false,
                    error: "ConnectionError",
                }),
            ]);
        });

        it("renews only once: a token refused again is the failure", async () => {
            // The server takes neither the old token nor the renewed one
            const { client, uploadContent, whoami } = oauthClient(() => "other", vi.fn().mockResolvedValue("new"));
            await expect(uploadContentWithRetry(client, blob, {}, options)).rejects.toBeInstanceOf(MatrixError);
            expect(uploadContent).toHaveBeenCalledTimes(2);
            expect(whoami).toHaveBeenCalledTimes(1);
        });

        it("still tries once more for the connection after the token was renewed", async () => {
            const upload = vi
                .fn()
                .mockRejectedValueOnce(expired())
                .mockRejectedValueOnce(new ConnectionError("x"))
                .mockResolvedValue(ok);
            const client = { uploadContent: upload, whoami: vi.fn().mockResolvedValue({}) } as unknown as MatrixClient;
            await expect(uploadContentWithRetry(client, blob, {}, options)).resolves.toBe(ok);
            expect(upload).toHaveBeenCalledTimes(3);
        });

        it("does not renew for an upload the user cancelled", async () => {
            const abortController = new AbortController();
            const whoami = vi.fn();
            const uploadContent = vi.fn(async () => {
                abortController.abort();
                throw expired();
            });
            const client = { uploadContent, whoami } as unknown as MatrixClient;
            await expect(uploadContentWithRetry(client, blob, { abortController }, options)).rejects.toThrow();
            expect(whoami).not.toHaveBeenCalled();
        });

        describe("before the upload", () => {
            const managed = (expiresInMs: number | undefined, outcome: () => Promise<string>) => {
                const handle = vi.fn(outcome);
                const tokenManager = {
                    latestTokenRefreshExpiry:
                        expiresInMs === undefined ? undefined : new Date(Date.now() + expiresInMs),
                    _handleUnknownToken: handle,
                };
                const upload = vi.fn().mockResolvedValue(ok);
                const client = { uploadContent: upload, http: { tokenManager } } as unknown as MatrixClient;
                return { client, handle, upload };
            };

            it("renews a token that is about to run out, then uploads", async () => {
                const order: string[] = [];
                const { client, handle, upload } = managed(5000, async () => {
                    order.push("refresh");
                    return "success";
                });
                upload.mockImplementation(async () => {
                    order.push("upload");
                    return ok;
                });
                await expect(uploadContentWithRetry(client, blob, {}, options)).resolves.toBe(ok);
                expect(handle).toHaveBeenCalledTimes(1);
                expect(order).toEqual(["refresh", "upload"]);
                expect(records()).toEqual([
                    expect.objectContaining({ type: "upload_token_refresh", reason: "expiring", ok: true }),
                ]);
            });

            it("leaves a token alone that has time left, or whose end is not known", async () => {
                const fresh = managed(4 * 60 * 1000, async () => "success");
                await uploadContentWithRetry(fresh.client, blob, {}, options);
                expect(fresh.handle).not.toHaveBeenCalled();

                const unknown = managed(undefined, async () => "success");
                await uploadContentWithRetry(unknown.client, blob, {}, options);
                expect(unknown.handle).not.toHaveBeenCalled();
                expect(records()).toEqual([]);
            });

            it("uploads all the same when renewing ahead of time fails", async () => {
                const { client, upload } = managed(-1000, async () => {
                    throw new Error("offline");
                });
                await expect(uploadContentWithRetry(client, blob, {}, options)).resolves.toBe(ok);
                expect(upload).toHaveBeenCalledTimes(1);
                expect(records()).toEqual([expect.objectContaining({ type: "upload_token_refresh", ok: false })]);
            });

            it("does nothing with a client that has no token manager", async () => {
                await expect(renewTokenIfExpiring({} as MatrixClient)).resolves.toBeUndefined();
            });
        });
    });
});
