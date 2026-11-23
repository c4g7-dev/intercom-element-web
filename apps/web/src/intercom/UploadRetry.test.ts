/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionError, HTTPError, MatrixError, type MatrixClient } from "matrix-js-sdk/src/matrix";

import { isRetryableUploadError, lastUploadProtocol, uploadContentWithRetry } from "./UploadRetry";

function clientWith(uploadContent: ReturnType<typeof vi.fn>): MatrixClient {
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
        expect(lastUploadProtocol([{ name: "https://hs/_matrix/media/v3/upload", nextHopProtocol: "" }])).toBeUndefined();
    });
});

describe("uploadContentWithRetry", () => {
    let log: ReturnType<typeof vi.spyOn>;
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
        const pending = uploadContentWithRetry(clientWith(upload), blob, { abortController }, { ...options, delayMs: 20 });
        await Promise.resolve();
        abortController.abort();
        await expect(pending).rejects.toThrow();
        expect(upload).toHaveBeenCalledTimes(1);
    });
});
