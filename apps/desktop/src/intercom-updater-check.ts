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

/** The most of a release's notes that is kept: more than any release has had, and a bound on what one could send. */
export const NOTES_MAX_CHARS = 20000;
/** How long the releases feed, a few kB, may take. */
export const PROBE_TIMEOUT_MS = 8000;
/** The longest a rate limit is waited out before the next automatic check, whatever GitHub says. */
export const MAX_RATE_LIMIT_WAIT_MS = 2 * 60 * 60 * 1000;
/** What is waited after a refusal that says nothing about when to come back. */
export const DEFAULT_RATE_LIMIT_WAIT_MS = 15 * 60 * 1000;

export function releasesUrl(perPage: number): string {
    return `https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=${perPage}`;
}

/**
 * The Atom feed of the releases: the same list as a page of github.com, not of the API. It is
 * what the frequent look asks, because it does not count against the API's limit of 60 requests
 * an hour for an address without a login, which an unchanged ("304") answer of the API does.
 */
export const RELEASES_FEED_URL = `https://github.com/${UPDATE_REPO}/releases.atom`;

/** The answer of the last check, as it is kept between checks and starts. */
export interface ReleaseCache {
    /** The URL the answer is of */
    url: string;
    etag: string;
    /** The releases, with the fields the updater reads and nothing else */
    releases: GithubRelease[];
    /** Whether the releases were kept with their notes; an answer kept by 1.12.35-intercom.12 or older has none and is asked for anew */
    notes?: boolean;
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
        /** Where GitHub refused for too many requests: when it may be asked again, in ms since the epoch */
        public readonly retryAt?: number,
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
            body: typeof r.body === "string" && r.body ? r.body.slice(0, NOTES_MAX_CHARS) : undefined,
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
        cache.notes === true &&
        Array.isArray(cache.releases)
    );
}

/**
 * When GitHub may be asked again after it refused for too many requests, or undefined if the
 * answer is no such refusal. GitHub says it with `Retry-After` (seconds; the secondary limits)
 * or with `x-ratelimit-remaining: 0` and `x-ratelimit-reset` (a time in seconds since the epoch;
 * the hourly limit). A 429, or a 403 with one of the two, is such a refusal; one that names no
 * time is given {@link DEFAULT_RATE_LIMIT_WAIT_MS}, and none more than {@link MAX_RATE_LIMIT_WAIT_MS}.
 */
export function rateLimitRetryAt(
    status: number,
    headers: { get(name: string): string | null },
    now: number,
): number | undefined {
    if (status !== 403 && status !== 429) return undefined;
    const retryAfter = Number(headers.get("retry-after"));
    const exhausted = headers.get("x-ratelimit-remaining") === "0";
    const reset = Number(headers.get("x-ratelimit-reset")) * 1000;
    let wait: number | undefined;
    if (headers.get("retry-after") !== null && Number.isFinite(retryAfter) && retryAfter >= 0) {
        wait = retryAfter * 1000;
    } else if (exhausted && Number.isFinite(reset) && reset > 0) {
        // A second more than GitHub says, for clocks that differ a little
        wait = reset - now + 1000;
    } else if (status === 429 || exhausted) {
        wait = DEFAULT_RATE_LIMIT_WAIT_MS;
    }
    if (wait === undefined) return undefined;
    return now + Math.min(MAX_RATE_LIMIT_WAIT_MS, Math.max(1000, wait));
}

/** What a look at the releases feed found. */
export interface FeedProbe {
    /** Whether the feed differs from the one seen last, or there was none to compare with: the releases are then asked for */
    changed: boolean;
    status: number;
    /** The feed's ETag, to send next time; the last one where the answer has none */
    etag?: string;
    ms: number;
}

/**
 * Asks whether the releases feed changed since the answer with `etag`: one small request, which
 * GitHub answers with "304 Not Modified" and no body while nothing was released.
 * @throws ReleaseCheckError when GitHub does not answer in time, or answers with an error
 */
export async function probeReleasesFeed(deps: {
    fetch: ReleaseCheckDeps["fetch"];
    etag?: string;
    now?: () => number;
    timeoutMs?: number;
}): Promise<FeedProbe> {
    const now = deps.now ?? Date.now;
    const timeoutMs = deps.timeoutMs ?? PROBE_TIMEOUT_MS;
    const started = now();
    const signal = AbortSignal.timeout(timeoutMs);
    const headers: Record<string, string> = { Accept: "application/atom+xml" };
    if (deps.etag) headers["If-None-Match"] = deps.etag;
    let response: Response;
    try {
        response = await deps.fetch(RELEASES_FEED_URL, { headers, signal });
        // The feed itself is not read: that it changed is all it is asked for
        if (response.status !== 304) await response.body?.cancel().catch(() => {});
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
    const ms = now() - started;
    if (response.status === 304) return { changed: false, status: 304, etag: deps.etag, ms };
    if (!response.ok) {
        throw new ReleaseCheckError(
            `GitHub: HTTP ${response.status}`,
            response.status,
            ms,
            false,
            rateLimitRetryAt(response.status, response.headers, now()),
        );
    }
    const etag = response.headers.get("etag") ?? undefined;
    return { changed: !deps.etag || etag !== deps.etag, status: response.status, etag, ms };
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
            const retryAt = rateLimitRetryAt(response.status, response.headers, now());
            const minutes = retryAt === undefined ? 0 : Math.max(1, Math.round((retryAt - now()) / 60000));
            throw new ReleaseCheckError(
                `GitHub: HTTP ${response.status}${retryAt === undefined ? "" : ` (too many requests, try again in ${minutes} min)`}`,
                response.status,
                now() - started,
                false,
                retryAt,
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
        if (etag) await deps.writeCache({ url, etag, releases, notes: true }).catch(() => {});
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
