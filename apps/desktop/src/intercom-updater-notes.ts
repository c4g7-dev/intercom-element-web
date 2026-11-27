/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * The release notes the app shows: which releases' notes belong to an update that is offered
 * ("What's new in …") and which to the one that was just installed, and whether those are to be
 * shown at this start. Without Electron; the notes come from the releases the last check kept
 * (intercom-updater-check.ts), so they are there without a connection too.
 */

import {
    compareIntercomVersions,
    type GithubRelease,
    isReleaseUrl,
    parseIntercomVersion,
    UPDATE_REPO,
} from "./intercom-updater-core.js";

/** The notes of one release. */
export interface ReleaseNotes {
    /** e.g. `1.12.35-intercom.13` */
    version: string;
    /** The notes as Markdown; the window shows them as text and lists, never as HTML */
    body: string;
    /** The release's page */
    url: string;
}

/** The most releases whose notes are shown at once. */
export const NOTES_MAX_RELEASES = 10;

/**
 * The notes of the desktop releases newer than `after` and not newer than `upTo`, newest first.
 * Drafts, pre-releases, Android's releases and releases without notes are left out.
 * @param after - the version that is passed; undefined for no lower bound
 * @param upTo - the newest version wanted; undefined for no upper bound
 */
export function selectNotes(
    releases: GithubRelease[] | undefined,
    after: string | undefined,
    upTo: string | undefined,
): ReleaseNotes[] {
    if (!Array.isArray(releases)) return [];
    const low = parseIntercomVersion(after);
    const high = parseIntercomVersion(upTo);
    if ((after !== undefined && !low) || (upTo !== undefined && !high)) return [];
    const seen = new Set<string>();
    return releases
        .filter((r) => r && !r.draft && !r.prerelease && typeof r.tag_name === "string" && r.tag_name.startsWith("v"))
        .map((r) => ({ release: r, version: parseIntercomVersion(r.tag_name) }))
        .filter(
            ({ release, version }) =>
                version !== undefined &&
                typeof release.body === "string" &&
                release.body.trim() !== "" &&
                (!low || compareIntercomVersions(version, low) > 0) &&
                (!high || compareIntercomVersions(version, high) <= 0),
        )
        .sort((a, b) => compareIntercomVersions(b.version!, a.version!))
        .filter(({ release }) => !seen.has(release.tag_name) && seen.add(release.tag_name))
        .slice(0, NOTES_MAX_RELEASES)
        .map(({ release }) => ({
            version: release.tag_name.slice(1),
            body: release.body!,
            url: isReleaseUrl(release.html_url)
                ? release.html_url
                : `https://github.com/${UPDATE_REPO}/releases/tag/${release.tag_name}`,
        }));
}

/** What decides whether "What's new" is shown after an update. */
export interface WhatsNewInput {
    /** The release that runs */
    current: string | undefined;
    /** The release whose notes were last shown or passed over; undefined if none ever was */
    lastSeen: string | undefined;
    /** Whether the user wants to be shown what is new */
    enabled: boolean;
    /** Whether an older InterCom has used this profile: where none has, this is a first install and nothing is "new" */
    profileUsedBefore: boolean;
    /** The releases the last check kept */
    releases: GithubRelease[] | undefined;
}

export interface WhatsNewDecision {
    /** The notes to show now, newest first; empty for nothing to show */
    notes: ReleaseNotes[];
    /**
     * The version to remember as seen without showing anything: on a first install, with the
     * setting off, or after going back to an older release. Undefined where nothing is to be
     * remembered yet: either the notes are shown first, or they are not there yet.
     */
    markSeen?: string;
}

/**
 * Whether, and which, notes are shown once after the app became a newer release: those of every
 * release after the one last seen, up to the one that runs. A profile that never saw any
 * (updated from 1.12.35-intercom.12 or older) is shown the running release's only.
 *
 * Notes that are not there yet (the release was installed by hand and no check has run) are
 * waited for: nothing is shown and nothing remembered, and the question is asked again.
 */
export function whatsNew(input: WhatsNewInput): WhatsNewDecision {
    const current = parseIntercomVersion(input.current);
    if (!current || !input.current) return { notes: [] };
    const last = parseIntercomVersion(input.lastSeen);
    if (last && compareIntercomVersions(last, current) === 0) return { notes: [] };
    if (!input.enabled || (!last && !input.profileUsedBefore) || (last && compareIntercomVersions(last, current) > 0)) {
        return { notes: [], markSeen: input.current };
    }
    // Without a version seen before, "everything up to this one" would be the whole history
    const notes = last
        ? selectNotes(input.releases, input.lastSeen, input.current)
        : selectNotes(input.releases, undefined, input.current).filter((n) => n.version === input.current);
    return { notes };
}
