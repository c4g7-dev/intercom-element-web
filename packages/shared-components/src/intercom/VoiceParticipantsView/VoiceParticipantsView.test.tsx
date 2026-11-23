/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { render, screen } from "@test-utils";
import { composeStories } from "@storybook/react-vite";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import * as stories from "./VoiceParticipantsView.stories";
import {
    VoiceParticipantsView,
    type VoiceParticipantsViewActions,
    type VoiceParticipantsViewSnapshot,
} from "./VoiceParticipantsView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

const { Default, Empty, ComingAndGoing } = composeStories(stories);

describe("VoiceParticipantsView", () => {
    it("lists who is in the call with what is on and off", () => {
        render(<Default />);
        const list = screen.getByRole("list", { name: "In the call of Lounge" });
        const rows = [...list.querySelectorAll("li")];
        expect(rows.map((row) => row.querySelector("[title]")?.getAttribute("title"))).toEqual([
            "Ada",
            "Ben",
            "Cy with a rather long display name",
            "Dee",
        ]);
        // The ring is on whoever talks
        expect(rows.map((row) => row.querySelector("[data-speaking]")?.getAttribute("data-speaking"))).toEqual([
            "true",
            "false",
            "false",
            "false",
        ]);
        expect(rows[1].querySelector('[aria-label="Muted"]')).not.toBeNull();
        expect(rows[2].textContent).toContain("LIVE");
        // Deafened says more than muted, so it is shown alone
        expect(rows[3].querySelector('[aria-label="Deafened"]')).not.toBeNull();
        expect(rows[3].querySelector('[aria-label="Muted"]')).toBeNull();
        expect(rows[0].querySelector("svg")).toBeNull();
    });

    it("renders nothing while nobody is in the call", () => {
        const { container } = render(<Empty />);
        expect(container.querySelector("ul")).toBeNull();
    });

    it("marks who just joined and who is leaving", () => {
        render(<ComingAndGoing />);
        const rows = [...screen.getByRole("list").querySelectorAll("li")];
        expect(rows.map((row) => row.getAttribute("data-transition"))).toEqual([null, "joining", "leaving"]);
        expect(rows[1].querySelector("button")?.getAttribute("title")).toBe("Ben joined");
        expect(rows[2].querySelector("button")?.getAttribute("title")).toBe("Cy left");
        // The two are told apart by their style, too
        expect(rows[1].className).not.toBe(rows[2].className);
        expect(rows[0].className).toBe("");
    });

    it("joins when somebody in the list is clicked", async () => {
        const onJoin = vi.fn();
        class TestViewModel
            extends MockViewModel<VoiceParticipantsViewSnapshot>
            implements VoiceParticipantsViewActions
        {
            public onJoin = onJoin;
        }
        const vm = new TestViewModel({
            roomName: "Lounge",
            participants: [{ id: "@a:x", name: "Ada", speaking: false, muted: false, deafened: false, live: false }],
        });
        render(<VoiceParticipantsView vm={vm} />);
        await userEvent.click(screen.getByText("Ada"));
        expect(onJoin).toHaveBeenCalledTimes(1);
    });
});
