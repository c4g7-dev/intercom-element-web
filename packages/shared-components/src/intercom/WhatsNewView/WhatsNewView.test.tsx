/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { render, screen } from "@test-utils";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { WhatsNewView } from "./WhatsNewView";

const RELEASES = "https://github.com/c4g7-dev/InterCom/releases";

describe("WhatsNewView", () => {
    it("shows what is new in the running release, with every release the update brought", () => {
        render(
            <WhatsNewView
                version="1.12.35-intercom.13"
                notes={[
                    { version: "1.12.35-intercom.13", body: "- **Updates arrive within minutes.**" },
                    { version: "1.12.35-intercom.12", body: "- Jump to present" },
                ]}
                releasesUrl={RELEASES}
                onDismiss={() => {}}
            />,
        );
        expect(screen.getByRole("heading", { name: "What's new in InterCom 1.12.35-intercom.13" })).toBeInTheDocument();
        expect(screen.getByRole("region", { name: "What's new in InterCom 1.12.35-intercom.13" })).toBeInTheDocument();
        expect(screen.getByText("Updates arrive within minutes.")).toBeInTheDocument();
        expect(screen.getByText("Jump to present")).toBeInTheDocument();
        const all = screen.getByRole("link", { name: "All release notes" });
        expect(all).toHaveAttribute("href", RELEASES);
        expect(all).toHaveAttribute("target", "_blank");
    });

    it("is put away with Got it, which has the focus", async () => {
        const onDismiss = vi.fn();
        render(
            <WhatsNewView
                version="1.12.35-intercom.13"
                notes={[{ version: "1.12.35-intercom.13", body: "- One change" }]}
                releasesUrl={RELEASES}
                onDismiss={onDismiss}
            />,
        );
        const gotIt = screen.getByRole("button", { name: "Got it" });
        expect(gotIt).toHaveFocus();
        await userEvent.setup().click(gotIt);
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });
});
