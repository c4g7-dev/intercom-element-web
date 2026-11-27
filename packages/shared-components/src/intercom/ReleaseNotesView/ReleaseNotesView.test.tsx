/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { render, screen, within } from "@test-utils";
import React from "react";
import { describe, it, expect } from "vitest";

import { ReleaseNotesView } from "./ReleaseNotesView";

const HOSTILE = [
    "- **Bold** and `code` and [a link](https://example.org/page).",
    '- <img src="https://example.org/track.gif" onerror="alert(1)"> ![pic](https://example.org/pic.png)',
    "- [click](javascript:alert(1)) <script>alert(2)</script> <iframe src=https://example.org></iframe>",
    "",
    '<a href="https://example.org/raw">raw anchor</a>',
].join("\n");

describe("ReleaseNotesView", () => {
    it("draws the notes as lists and text", () => {
        render(<ReleaseNotesView notes={[{ version: "1.12.35-intercom.13", body: HOSTILE }]} />);
        const items = screen.getAllByRole("listitem");
        expect(items[0]).toHaveTextContent("Bold and code and a link.");
        expect(within(items[0]).getByText("Bold").tagName).toBe("STRONG");
        expect(within(items[0]).getByText("code").tagName).toBe("CODE");
        // One release: its version is the title of whatever shows it
        expect(screen.queryByRole("heading")).toBeNull();
    });

    it("puts no HTML of the notes on the page, loads no picture and runs nothing", () => {
        const { container } = render(<ReleaseNotesView notes={[{ version: "1.12.35-intercom.13", body: HOSTILE }]} />);
        expect(container.querySelector("img, script, iframe, video, style, object, embed")).toBeNull();
        expect(container.innerHTML).not.toMatch(/onerror|javascript:|track\.gif|pic\.png/);
        // The one link is the http(s) one of the Markdown, and it opens outside the app
        const links = screen.getAllByRole("link");
        expect(links).toHaveLength(1);
        expect(links[0]).toHaveAttribute("href", "https://example.org/page");
        expect(links[0]).toHaveAttribute("target", "_blank");
        expect(links[0]).toHaveAttribute("rel", "noreferrer noopener");
        // An anchor written as HTML is its words
        expect(screen.getByText("raw anchor").tagName).toBe("P");
    });

    it("heads each release with its version where there are several, newest first as given", () => {
        render(
            <ReleaseNotesView
                notes={[
                    { version: "1.12.35-intercom.13", body: "- Newest" },
                    { version: "1.12.35-intercom.12", body: "- Older" },
                ]}
            />,
        );
        expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual([
            "1.12.35-intercom.13",
            "1.12.35-intercom.12",
        ]);
        expect(
            within(screen.getByRole("region", { name: "1.12.35-intercom.12" })).getByRole("listitem"),
        ).toHaveTextContent("Older");
    });

    it("leaves the newest release without a heading where the title above names it", () => {
        render(
            <ReleaseNotesView
                titledByFirst
                notes={[
                    { version: "1.12.35-intercom.13", body: "- Newest" },
                    { version: "1.12.35-intercom.12", body: "- Older" },
                ]}
            />,
        );
        expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["1.12.35-intercom.12"]);
        expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });
});
