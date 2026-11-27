/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import { type GithubRelease } from "./intercom-updater-core.js";
import { NOTES_MAX_RELEASES, selectNotes, whatsNew } from "./intercom-updater-notes.js";

const PAGE = "https://github.com/c4g7-dev/InterCom/releases";
const v = (n: number): string => `1.12.35-intercom.${n}`;

function release(n: number, extra: Partial<GithubRelease> = {}): GithubRelease {
    return { tag_name: `v${v(n)}`, html_url: `${PAGE}/tag/v${v(n)}`, body: `- Notes of .${n}`, ...extra };
}

/** As GitHub lists them: newest first, Android's among them */
const RELEASES: GithubRelease[] = [
    release(14, { draft: true }),
    release(13),
    { tag_name: "android-v26.11.1-intercom.7", html_url: `${PAGE}/tag/android-v26.11.1-intercom.7`, body: "Android" },
    release(12),
    release(11),
    release(10, { body: "  " }),
    release(9, { prerelease: true }),
    release(8),
];

describe("selectNotes", () => {
    it("gives the notes of every release after the running one up to the offered one, newest first", () => {
        expect(selectNotes(RELEASES, v(10), v(13))).toEqual([
            { version: v(13), body: "- Notes of .13", url: `${PAGE}/tag/v${v(13)}` },
            { version: v(12), body: "- Notes of .12", url: `${PAGE}/tag/v${v(12)}` },
            { version: v(11), body: "- Notes of .11", url: `${PAGE}/tag/v${v(11)}` },
        ]);
        expect(selectNotes(RELEASES, v(12), v(13)).map((n) => n.version)).toEqual([v(13)]);
        expect(selectNotes(RELEASES, v(13), v(13))).toEqual([]);
    });

    it("leaves out drafts, pre-releases, Android's releases and releases without notes", () => {
        expect(selectNotes(RELEASES, v(7), undefined).map((n) => n.version)).toEqual([v(13), v(12), v(11), v(8)]);
    });

    it("sorts by version, whatever order the releases come in, and takes each once", () => {
        const mixed = [release(11), release(13), release(12), release(13)];
        expect(selectNotes(mixed, v(10), v(13)).map((n) => n.version)).toEqual([v(13), v(12), v(11)]);
    });

    it("compares the Element version before the InterCom revision", () => {
        const next: GithubRelease = { tag_name: "v1.13.0-intercom.1", html_url: "", body: "- New base" };
        expect(selectNotes([next, release(13)], v(13), "1.13.0-intercom.1")).toEqual([
            { version: "1.13.0-intercom.1", body: "- New base", url: `${PAGE}/tag/v1.13.0-intercom.1` },
        ]);
    });

    it("shows at most ten releases and nothing for versions it cannot read", () => {
        const many = Array.from({ length: 30 }, (_, i) => release(i + 1));
        expect(selectNotes(many, undefined, undefined)).toHaveLength(NOTES_MAX_RELEASES);
        expect(selectNotes(many, undefined, undefined)[0].version).toBe(v(30));
        expect(selectNotes(RELEASES, "nonsense", v(13))).toEqual([]);
        expect(selectNotes(RELEASES, v(10), "1.2.3")).toEqual([]);
        expect(selectNotes(undefined, v(10), v(13))).toEqual([]);
    });

    it("links to the release's own page only", () => {
        const odd = release(13, { html_url: "https://example.org/elsewhere" });
        expect(selectNotes([odd], v(12), v(13))[0].url).toBe(`${PAGE}/tag/v${v(13)}`);
    });
});

describe("whatsNew", () => {
    const base = { current: v(13), enabled: true, profileUsedBefore: true, releases: RELEASES };

    it("shows the notes of every release since the one last seen, once", () => {
        const decision = whatsNew({ ...base, lastSeen: v(11) });
        expect(decision.notes.map((n) => n.version)).toEqual([v(13), v(12)]);
        // Remembered only when the user has seen them
        expect(decision.markSeen).toBeUndefined();
        // Seen: not again, at this start or the next
        expect(whatsNew({ ...base, lastSeen: v(13) })).toEqual({ notes: [] });
    });

    it("shows the running release's notes to a profile that never saw any (updated from .12 or older)", () => {
        const decision = whatsNew({ ...base, lastSeen: undefined });
        expect(decision.notes.map((n) => n.version)).toEqual([v(13)]);
        expect(decision.markSeen).toBeUndefined();
    });

    it("shows nothing on a first install, and remembers the release as seen", () => {
        expect(whatsNew({ ...base, lastSeen: undefined, profileUsedBefore: false })).toEqual({
            notes: [],
            markSeen: v(13),
        });
    });

    it("shows nothing with the setting off, and does not show it later either", () => {
        expect(whatsNew({ ...base, lastSeen: v(12), enabled: false })).toEqual({ notes: [], markSeen: v(13) });
    });

    it("waits for notes that are not there yet", () => {
        expect(whatsNew({ ...base, lastSeen: v(12), releases: undefined })).toEqual({ notes: [] });
        expect(whatsNew({ ...base, lastSeen: v(12), releases: [release(12)] })).toEqual({ notes: [] });
    });

    it("shows nothing after going back to an older release, or in a build that is no release", () => {
        expect(whatsNew({ ...base, current: v(12), lastSeen: v(13) })).toEqual({ notes: [], markSeen: v(12) });
        expect(whatsNew({ ...base, current: undefined, lastSeen: v(12) })).toEqual({ notes: [] });
    });
});
