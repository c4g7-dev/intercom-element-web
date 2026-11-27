/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { describe, expect, it } from "vitest";

import { isSafeNotesLink, NOTES_MAX_LENGTH, parseReleaseNotes } from "./releaseNotes";

const text = (markdown: string): string => JSON.stringify(parseReleaseNotes(markdown));

describe("parseReleaseNotes", () => {
    it("reads a list as the changelog writes it: items over several lines, with bold, code and links", () => {
        const blocks = parseReleaseNotes(
            [
                "- **The Linux self-update installs.** After .8 fixed removing install",
                "  directories, the check went through `original-fs`.",
                "- See [UPDATES.md](https://github.com/c4g7-dev/InterCom/blob/main/docs/UPDATES.md) for more.",
            ].join("\n"),
        );
        expect(blocks).toEqual([
            {
                type: "list",
                ordered: false,
                items: [
                    {
                        depth: 0,
                        inline: [
                            { text: "The Linux self-update installs.", strong: true },
                            { text: " After .8 fixed removing install directories, the check went through " },
                            { text: "original-fs", code: true },
                            { text: "." },
                        ],
                    },
                    {
                        depth: 0,
                        inline: [
                            { text: "See " },
                            {
                                text: "UPDATES.md",
                                href: "https://github.com/c4g7-dev/InterCom/blob/main/docs/UPDATES.md",
                            },
                            { text: " for more." },
                        ],
                    },
                ],
            },
        ]);
    });

    it("leaves out pictures, the table that holds them and the caption under it", () => {
        const blocks = parseReleaseNotes(
            [
                "| Far back | Unread above |",
                "| --- | --- |",
                "| ![the bar](https://raw.githubusercontent.com/x/y/a.png) | ![the top](https://example.org/b.png) |",
                "",
                "<sub>Taken against a made-up homeserver: the people and messages do not exist.</sub>",
                "",
                "- A change ![inline](https://example.org/c.png)with a picture in it.",
            ].join("\n"),
        );
        expect(blocks).toEqual([
            {
                type: "list",
                ordered: false,
                items: [{ depth: 0, inline: [{ text: "A change with a picture in it." }] }],
            },
        ]);
        expect(JSON.stringify(blocks)).not.toContain("example.org");
        expect(JSON.stringify(blocks)).not.toContain("raw.githubusercontent.com");
    });

    it("flattens a table of text: a row is a line, its cells parted by a dot", () => {
        expect(
            parseReleaseNotes("| Platform | File |\n| --- | --- |\n| Linux | `tar.gz` |\n| Windows | ![icon](x.png) |"),
        ).toEqual([
            { type: "paragraph", inline: [{ text: "Platform · File" }] },
            { type: "paragraph", inline: [{ text: "Linux · " }, { text: "tar.gz", code: true }] },
            { type: "paragraph", inline: [{ text: "Windows" }] },
        ]);
    });

    it("never keeps HTML: tags are taken out and what they enclosed is text", () => {
        const out = text(
            '<script>alert(1)</script> <img src=x onerror="alert(2)"> <b onclick="x()">bold</b> <a href="javascript:alert(3)">here</a> <!-- hidden --> &lt;i&gt; &amp;',
        );
        expect(out).not.toMatch(/<script|<img|onerror|onclick|<a |<b|hidden/);
        expect(parseReleaseNotes("<b>bold</b> &lt;i&gt; &amp; done")).toEqual([
            { type: "paragraph", inline: [{ text: "bold <i> & done" }] },
        ]);
        // What an entity decodes to is text, not a tag to take out again or to draw
        expect(parseReleaseNotes("&lt;img src=x onerror=alert(1)&gt;")).toEqual([
            { type: "paragraph", inline: [{ text: "<img src=x onerror=alert(1)>" }] },
        ]);
    });

    it("keeps words in angle brackets that are no HTML", () => {
        expect(parseReleaseNotes('The card says "InterCom <version>", for <b>every</b> <VERSION> and a < b.')).toEqual([
            {
                type: "paragraph",
                inline: [{ text: 'The card says "InterCom <version>", for every <VERSION> and a < b.' }],
            },
        ]);
        // Whatever the case and the attributes, an element of HTML goes
        expect(
            text('<IMG SRC=x onerror=alert(1)> <ScRiPt src="//example.org/x.js"></sCrIpT> <svg/onload=alert(1)>'),
        ).not.toMatch(/img|script|svg|onerror|onload/i);
    });

    it("keeps only http(s) links as links", () => {
        const hrefs = (markdown: string): Array<string | undefined> =>
            parseReleaseNotes(markdown).flatMap((b) => ("inline" in b ? b.inline.map((run) => run.href) : []));
        expect(hrefs("[a](javascript:alert(1))")).toEqual([undefined, undefined]);
        expect(hrefs("[a](data:text/html,x) [b](file:///etc/passwd) [c](vector://x) [d](/relative)")).toEqual(
            Array(7).fill(undefined),
        );
        expect(hrefs("[ok](https://example.org/a) and https://example.org/b.")).toEqual([
            "https://example.org/a",
            undefined,
            "https://example.org/b",
            undefined,
        ]);
        expect(isSafeNotesLink("https://example.org")).toBe(true);
        expect(isSafeNotesLink("http://example.org")).toBe(true);
        expect(isSafeNotesLink("JaVaScRiPt:alert(1)")).toBe(false);
        expect(isSafeNotesLink(" javascript:alert(1)")).toBe(false);
        expect(isSafeNotesLink("intercom://vector/webapp")).toBe(false);
        expect(isSafeNotesLink("not a url")).toBe(false);
    });

    it("reads headings, paragraphs, numbered and nested lists, code and rules", () => {
        const blocks = parseReleaseNotes(
            [
                "## Fixes",
                "",
                "One paragraph",
                "over two lines, with *emphasis* and snake_case_names kept.",
                "",
                "1. First",
                "2. Second",
                "   - Under the second",
                "",
                "---",
                "",
                "```sh",
                "sha256sum -c SHA256SUMS <b>",
                "```",
            ].join("\n"),
        );
        expect(blocks).toEqual([
            { type: "heading", inline: [{ text: "Fixes" }] },
            {
                type: "paragraph",
                inline: [
                    { text: "One paragraph over two lines, with " },
                    { text: "emphasis", emphasis: true },
                    { text: " and snake_case_names kept." },
                ],
            },
            {
                type: "list",
                ordered: true,
                items: [
                    { depth: 0, inline: [{ text: "First" }] },
                    { depth: 0, inline: [{ text: "Second" }] },
                    { depth: 1, inline: [{ text: "Under the second" }] },
                ],
            },
            // Code is text as it stands, tags and all: it is drawn as text
            { type: "code", text: "sha256sum -c SHA256SUMS <b>" },
        ]);
    });

    it("keeps a list together over empty lines between its items", () => {
        const blocks = parseReleaseNotes("- one\n\n- two\n\nAfter the list");
        expect(blocks.map((b) => b.type)).toEqual(["list", "paragraph"]);
        expect(blocks[0]).toMatchObject({ items: [{ inline: [{ text: "one" }] }, { inline: [{ text: "two" }] }] });
    });

    it("reads no more than it is meant to, and nothing of nothing", () => {
        expect(parseReleaseNotes("")).toEqual([]);
        expect(parseReleaseNotes(undefined as unknown as string)).toEqual([]);
        const long = parseReleaseNotes("word ".repeat(NOTES_MAX_LENGTH));
        expect(JSON.stringify(long).length).toBeLessThan(NOTES_MAX_LENGTH + 200);
    });
});
