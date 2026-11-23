/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";

import {
    fetchReleasesCached,
    type ReleaseCache,
    ReleaseCheckError,
    releasesUrl,
    RELEASES_FALLBACK_PAGE_SIZE,
    RELEASES_PAGE_SIZE,
    trimReleases,
} from "./intercom-updater-check.js";
import { selectUpdate } from "./intercom-updater-core.js";

const PAGE = "https://github.com/c4g7-dev/InterCom/releases";

/** A release as the GitHub API gives it: with much that the updater does not read. */
function release(tag: string, files: string[] = []): Record<string, unknown> {
    return {
        tag_name: tag,
        html_url: `${PAGE}/tag/${tag}`,
        draft: false,
        prerelease: false,
        body: "Release notes ".repeat(500),
        author: { login: "somebody" },
        assets: files.map((name) => ({
            name,
            browser_download_url: `${PAGE}/download/${tag}/${name}`,
            size: 1234,
            download_count: 7,
            uploader: { login: "somebody" },
        })),
    };
}

const desktop = (n: number): Record<string, unknown> =>
    release(`v1.12.35-intercom.${n}`, [
        `InterCom-1.12.35-intercom.${n}-linux-x64.tar.gz`,
        `InterCom-Setup-1.12.35-intercom.${n}-x64.exe`,
        "SHA256SUMS",
    ]);
const android = (n: number): Record<string, unknown> =>
    release(`android-v26.11.1-intercom.${n}`, [`InterCom-Android-26.11.1-intercom.${n}-arm64-v8a.apk`]);

interface Harness {
    fetch: ReturnType<typeof vi.fn>;
    cache: { value?: ReleaseCache };
    check: () => ReturnType<typeof fetchReleasesCached>;
}

function harness(respond: (url: string, headers: Record<string, string>) => Response | Promise<Response>): Harness {
    const cache: { value?: ReleaseCache } = {};
    const fetch = vi.fn(async (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) =>
        respond(url, init.headers),
    );
    let clock = 0;
    return {
        fetch,
        cache,
        check: () =>
            fetchReleasesCached({
                fetch,
                readCache: async () => cache.value,
                writeCache: async (value) => void (cache.value = value),
                // Every look at the clock is 10 ms after the last
                now: () => (clock += 10),
            }),
    };
}

describe("fetchReleasesCached", () => {
    it("asks for a short list and keeps the answer with its ETag, without what is not read", async () => {
        const list = [desktop(6), android(3), desktop(5)];
        const h = harness(() => new Response(JSON.stringify(list), { headers: { etag: 'W/"one"' } }));
        const check = await h.check();

        expect(h.fetch).toHaveBeenCalledTimes(1);
        expect(h.fetch.mock.calls[0][0]).toBe(releasesUrl(RELEASES_PAGE_SIZE));
        expect(h.fetch.mock.calls[0][1].headers).toEqual({ Accept: "application/vnd.github+json" });
        expect(check).toMatchObject({ status: 200, cached: false, requests: 1, bytes: JSON.stringify(list).length });
        expect(check.ms).toBeGreaterThan(0);
        expect(check.releases.map((r) => r.tag_name)).toEqual([
            "v1.12.35-intercom.6",
            "android-v26.11.1-intercom.3",
            "v1.12.35-intercom.5",
        ]);

        expect(h.cache.value).toMatchObject({ url: releasesUrl(RELEASES_PAGE_SIZE), etag: 'W/"one"' });
        const kept = JSON.stringify(h.cache.value);
        expect(kept).not.toContain("Release notes");
        expect(kept).not.toContain("somebody");
        expect(kept.length).toBeLessThan(3000);
    });

    it("sends the ETag the next time and uses the kept answer when nothing changed", async () => {
        const h = harness((_url, headers) =>
            headers["If-None-Match"] === 'W/"one"'
                ? new Response(null, { status: 304 })
                : new Response(JSON.stringify([desktop(6), android(3)]), { headers: { etag: 'W/"one"' } }),
        );
        const first = await h.check();
        const second = await h.check();

        expect(h.fetch.mock.calls[1][1].headers["If-None-Match"]).toBe('W/"one"');
        expect(second).toMatchObject({ status: 304, cached: true, bytes: 0, requests: 1 });
        expect(second.releases).toEqual(first.releases);
        // What the updater makes of the kept answer is what it makes of GitHub's
        const update = selectUpdate(second.releases, "1.12.35-intercom.5", "linux", "x64");
        expect(update).toMatchObject({
            version: "1.12.35-intercom.6",
            asset: { name: "InterCom-1.12.35-intercom.6-linux-x64.tar.gz" },
            sumsUrl: `${PAGE}/download/v1.12.35-intercom.6/SHA256SUMS`,
        });
    });

    it("takes a new answer when the releases changed", async () => {
        let list = [desktop(6)];
        let etag = 'W/"one"';
        const h = harness((_url, headers) =>
            headers["If-None-Match"] === etag
                ? new Response(null, { status: 304 })
                : new Response(JSON.stringify(list), { headers: { etag } }),
        );
        await h.check();
        list = [desktop(7), desktop(6)];
        etag = 'W/"two"';
        const check = await h.check();
        expect(check).toMatchObject({ status: 200, cached: false });
        expect(check.releases[0].tag_name).toBe("v1.12.35-intercom.7");
        expect(h.cache.value!.etag).toBe('W/"two"');
    });

    it("does not send the ETag of an answer it cannot use", async () => {
        const h = harness(() => new Response(JSON.stringify([desktop(6)]), { headers: { etag: 'W/"new"' } }));
        // Kept by a build that asked for another list
        h.cache.value = { url: releasesUrl(30), etag: 'W/"old"', releases: [] };
        await h.check();
        expect(h.fetch.mock.calls[0][1].headers["If-None-Match"]).toBeUndefined();
        // Something that is not a kept answer at all
        h.cache.value = { url: releasesUrl(RELEASES_PAGE_SIZE), etag: "" } as unknown as ReleaseCache;
        await h.check();
        expect(h.fetch.mock.calls[1][1].headers["If-None-Match"]).toBeUndefined();
    });

    it("asks for the long list when the short one holds Android releases only", async () => {
        const short = [1, 2, 3, 4, 5].map(android);
        const long = [...short, desktop(6), desktop(5)];
        const h = harness(
            (url) =>
                new Response(JSON.stringify(url === releasesUrl(RELEASES_PAGE_SIZE) ? short : long), {
                    headers: { etag: 'W/"x"' },
                }),
        );
        const check = await h.check();
        expect(h.fetch.mock.calls.map((call) => call[0])).toEqual([
            releasesUrl(RELEASES_PAGE_SIZE),
            releasesUrl(RELEASES_FALLBACK_PAGE_SIZE),
        ]);
        expect(check.requests).toBe(2);
        expect(selectUpdate(check.releases, "1.12.35-intercom.5", "linux", "x64")?.version).toBe("1.12.35-intercom.6");
    });

    it("is content with a short list that is all there is", async () => {
        const h = harness(() => new Response(JSON.stringify([android(1), android(2)])));
        const check = await h.check();
        expect(check.requests).toBe(1);
        // Nothing to keep without an ETag
        expect(h.cache.value).toBeUndefined();
    });

    it("says what GitHub answered when it refuses", async () => {
        const h = harness(() => new Response("no", { status: 500 }));
        await expect(h.check()).rejects.toMatchObject({ message: "GitHub: HTTP 500", status: 500, timedOut: false });

        const limited = harness(
            () => new Response("limit", { status: 403, headers: { "x-ratelimit-remaining": "0" } }),
        );
        const error = await limited.check().catch((e) => e);
        expect(error).toBeInstanceOf(ReleaseCheckError);
        expect(error.message).toBe("GitHub: HTTP 403 (too many requests, try again in an hour)");
    });

    it("says so when the answer is not a list of releases", async () => {
        const h = harness(() => new Response("<html>"));
        await expect(h.check()).rejects.toThrow("GitHub: the answer is not a list of releases");
    });

    it("says so when GitHub cannot be reached", async () => {
        const h = harness(() => {
            throw new Error("net::ERR_INTERNET_DISCONNECTED");
        });
        await expect(h.check()).rejects.toMatchObject({
            message: "GitHub could not be reached (net::ERR_INTERNET_DISCONNECTED)",
            timedOut: false,
        });
    });

    it("gives up after the time limit", async () => {
        const fetch = vi.fn(
            (_url: string, init: { signal?: AbortSignal }) =>
                new Promise<Response>((_resolve, reject) => {
                    init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
                }),
        );
        const started = Date.now();
        const error = await fetchReleasesCached({
            fetch,
            readCache: async () => undefined,
            writeCache: async () => {},
            timeoutMs: 50,
        }).catch((e) => e);
        expect(error).toBeInstanceOf(ReleaseCheckError);
        expect(error).toMatchObject({ timedOut: true, message: "GitHub did not answer within 0 s" });
        expect(Date.now() - started).toBeLessThan(2000);
    });

    it("checks without a kept answer when the profile cannot be read or written", async () => {
        const fetch = vi.fn(async () => new Response(JSON.stringify([desktop(6)]), { headers: { etag: 'W/"x"' } }));
        const check = await fetchReleasesCached({
            fetch,
            readCache: async () => {
                throw new Error("ENOENT");
            },
            writeCache: async () => {
                throw new Error("EACCES");
            },
        });
        expect(check.releases).toHaveLength(1);
    });
});

describe("trimReleases", () => {
    it("keeps the fields the updater reads and leaves out what is not a release", () => {
        expect(trimReleases("nonsense")).toEqual([]);
        expect(trimReleases([null, { name: "no tag" }, { ...desktop(6), draft: true }])).toEqual([
            {
                tag_name: "v1.12.35-intercom.6",
                html_url: `${PAGE}/tag/v1.12.35-intercom.6`,
                draft: true,
                prerelease: undefined,
                assets: [
                    "InterCom-1.12.35-intercom.6-linux-x64.tar.gz",
                    "InterCom-Setup-1.12.35-intercom.6-x64.exe",
                    "SHA256SUMS",
                ].map((name) => ({
                    name,
                    browser_download_url: `${PAGE}/download/v1.12.35-intercom.6/${name}`,
                    size: 1234,
                })),
            },
        ]);
    });
});
