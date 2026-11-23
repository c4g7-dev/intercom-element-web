/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Asking GitHub for InterCom's releases, quickly: a short list, a time limit, and the answer of
 * last time kept with its ETag, so that a check that finds nothing new is one small request
 * that GitHub answers with "304 Not Modified" and no body. Without Electron, for the tests;
 * intercom-updater.ts gives it `net.fetch` and a file in the profile.
 */

import { type GithubRelease, parseIntercomVersion, UPDATE_REPO } from "./intercom-updater-core.js";

/** How many releases a check asks for. A release is about 10 kB of JSON, most of it its notes. */
export const RELEASES_PAGE_SIZE = 5;
/** What is asked for when the short list holds no desktop release at all (Android ones only). */
export const RELEASES_FALLBACK_PAGE_SIZE = 30;
/** How long GitHub has to answer, headers and body. */
export const CHECK_TIMEOUT_MS = 8000;

export function releasesUrl(perPage: number): string {
    return `https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=${perPage}`;
}

/** The answer of the last check, as it is kept between checks and starts. */
export interface ReleaseCache {
    /** The URL the answer is of */
    url: string;
    etag: string;
    /** The releases, with the fields the updater reads and nothing else */
    releases: GithubRelease[];
}

/** What a check found, and how long it took. */
export interface ReleaseCheck {
    releases: GithubRelease[];
    /** The HTTP status of the (last) answer */
    status: number;
    /** Whether GitHub said that nothing changed and the kept answer was used */
    cached: boolean;
    /** Bytes of JSON read */
    bytes: number;
    /** Until the headers of the (last) answer were there */
    headersMs: number;
    /** The whole check */
    ms: number;
    /** Requests made: 2 when the short list had no desktop release, or the kept answer was unusable */
    requests: number;
}

/** A check that failed, with what is known of how. */
export class ReleaseCheckError extends Error {
    public constructor(
        message: string,
        public readonly status: number | undefined,
        public readonly ms: number,
        public readonly timedOut = false,
    ) {
        super(message);
        this.name = "ReleaseCheckError";
    }
}

export interface ReleaseCheckDeps {
    fetch: (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;
    readCache: () => Promise<ReleaseCache | undefined>;
    writeCache: (cache: ReleaseCache) => Promise<void>;
    now?: () => number;
    timeoutMs?: number;
    pageSize?: number;
}

/** The fields of the releases that the updater reads: what is kept between checks. */
export function trimReleases(releases: unknown): GithubRelease[] {
    if (!Array.isArray(releases)) return [];
    return releases
        .filter((r): r is GithubRelease => Boolean(r) && typeof r.tag_name === "string")
        .map((r) => ({
            tag_name: r.tag_name,
            html_url: r.html_url,
            draft: r.draft || undefined,
            prerelease: r.prerelease || undefined,
            assets: (Array.isArray(r.assets) ? r.assets : []).map((a) => ({
                name: a.name,
                browser_download_url: a.browser_download_url,
                size: a.size,
            })),
        }));
}

function isUsableCache(cache: ReleaseCache | undefined, url: string): cache is ReleaseCache {
    return (
        !!cache &&
        cache.url === url &&
        typeof cache.etag === "string" &&
        cache.etag.length > 0 &&
        Array.isArray(cache.releases)
    );
}

/**
 * The releases of the repository, newest first: from GitHub, or from the kept answer where
 * GitHub says it still holds.
 *
 * The short list is enough as long as it holds a desktop release: releases come newest first,
 * so the newest desktop release is on it. Where it holds Android releases only, the long list
 * is asked for.
 * @throws ReleaseCheckError when GitHub does not answer in time or answers with an error
 */
export async function fetchReleasesCached(deps: ReleaseCheckDeps): Promise<ReleaseCheck> {
    const now = deps.now ?? Date.now;
    const timeoutMs = deps.timeoutMs ?? CHECK_TIMEOUT_MS;
    const pageSize = deps.pageSize ?? RELEASES_PAGE_SIZE;
    const started = now();
    // One limit for the whole check, however many requests it takes
    const signal = AbortSignal.timeout(timeoutMs);
    let requests = 0;

    const ask = async (
        url: string,
        cache: ReleaseCache | undefined,
    ): Promise<Omit<ReleaseCheck, "ms" | "requests">> => {
        const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
        if (cache) headers["If-None-Match"] = cache.etag;
        requests++;
        const asked = now();
        let response: Response;
        let text = "";
        try {
            response = await deps.fetch(url, { headers, signal });
            if (response.status !== 304 && response.ok) text = await response.text();
        } catch (e) {
            if (signal.aborted) {
                throw new ReleaseCheckError(
                    `GitHub did not answer within ${Math.round(timeoutMs / 1000)} s`,
                    undefined,
                    now() - started,
                    true,
                );
            }
            const reason = e instanceof Error ? e.message : String(e);
            throw new ReleaseCheckError(`GitHub could not be reached (${reason})`, undefined, now() - started);
        }
        const headersMs = now() - asked;
        if (response.status === 304 && cache) {
            return { releases: cache.releases, status: 304, cached: true, bytes: 0, headersMs };
        }
        if (!response.ok) {
            const limited =
                (response.status === 403 || response.status === 429) &&
                response.headers.get("x-ratelimit-remaining") === "0";
            throw new ReleaseCheckError(
                `GitHub: HTTP ${response.status}${limited ? " (too many requests, try again in an hour)" : ""}`,
                response.status,
                now() - started,
            );
        }
        let releases: GithubRelease[];
        try {
            releases = trimReleases(JSON.parse(text));
        } catch {
            throw new ReleaseCheckError(
                "GitHub: the answer is not a list of releases",
                response.status,
                now() - started,
            );
        }
        const etag = response.headers.get("etag");
        // Kept for the next check; a profile that cannot be written to only costs the next one its shortcut
        if (etag) await deps.writeCache({ url, etag, releases }).catch(() => {});
        return { releases, status: response.status, cached: false, bytes: text.length, headersMs };
    };

    const kept = await deps.readCache().catch(() => undefined);
    const url = releasesUrl(pageSize);
    let answer = await ask(url, isUsableCache(kept, url) ? kept : undefined);
    const hasDesktop = answer.releases.some((r) => parseIntercomVersion(r.tag_name) && r.tag_name.startsWith("v"));
    if (!hasDesktop && answer.releases.length >= pageSize && pageSize < RELEASES_FALLBACK_PAGE_SIZE) {
        const longUrl = releasesUrl(RELEASES_FALLBACK_PAGE_SIZE);
        answer = await ask(longUrl, isUsableCache(kept, longUrl) ? kept : undefined);
    }
    return { ...answer, ms: now() - started, requests };
}
