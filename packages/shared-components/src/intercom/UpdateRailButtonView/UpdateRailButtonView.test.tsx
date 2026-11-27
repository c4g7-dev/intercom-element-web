/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { render, screen, waitFor, within } from "@test-utils";
import { composeStories } from "@storybook/react-vite";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import * as stories from "./UpdateRailButtonView.stories";
import {
    UpdateRailButtonView,
    type UpdateRailButtonViewActions,
    type UpdateRailButtonViewSnapshot,
} from "./UpdateRailButtonView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

const {
    Ready,
    Hidden,
    Available,
    Downloading,
    DownloadingUnknownSize,
    DownloadingWillRestart,
    Preparing,
    Installing,
    Manual,
    Failed,
    WithoutNotes,
    Expanded,
} = composeStories(stories);

class TestViewModel extends MockViewModel<UpdateRailButtonViewSnapshot> implements UpdateRailButtonViewActions {
    public onUpdate = vi.fn();
    public onOpenReleasePage = vi.fn();
}

const V = "1.12.35-intercom.13";

describe("UpdateRailButtonView", () => {
    it("shows nothing while the app is up to date", () => {
        render(<Hidden />);
        expect(screen.queryByTestId("intercom-update-rail")).toBeNull();
        expect(screen.queryByRole("button")).toBeNull();
    });

    it.each([
        ["available", Available, `InterCom ${V} — Available`],
        ["downloading", Downloading, `InterCom ${V} — Downloading · 41 %`],
        ["downloading, size unknown", DownloadingUnknownSize, `InterCom ${V} — Downloading…`],
        ["preparing", Preparing, `InterCom ${V} — Verifying…`],
        ["ready", Ready, `InterCom ${V} — Ready to install`],
        ["manual", Manual, `InterCom ${V} — Available`],
        ["failed", Failed, `InterCom ${V} — The update failed`],
    ])("is a button with a red dot, named by version and state, when %s", (_name, Story, label) => {
        render(<Story />);
        expect(screen.getByRole("button", { name: label })).toBeEnabled();
        expect(screen.getByTestId("intercom-update-rail-dot")).toBeInTheDocument();
    });

    it("cannot be clicked while the app is about to start again", () => {
        render(<Installing />);
        expect(screen.getByRole("button", { name: `InterCom ${V} — Restarting to update…` })).toBeDisabled();
    });

    it("hands the click to the view model, whatever the state", async () => {
        const user = userEvent.setup();
        for (const state of ["available", "downloading", "preparing", "ready", "manual", "failed"] as const) {
            const vm = new TestViewModel({ state, version: V, installWhenReady: false, notes: [] });
            const { unmount } = render(<UpdateRailButtonView vm={vm} />);
            await user.click(screen.getByRole("button"));
            expect(vm.onUpdate).toHaveBeenCalledTimes(1);
            unmount();
        }
    });

    it("opens a card with the state, what a click does and what is new, when pointed at", async () => {
        const user = userEvent.setup();
        render(<Ready />);
        expect(screen.queryByRole("tooltip")).toBeNull();
        await user.hover(screen.getByRole("button"));
        const card = await screen.findByRole("tooltip");
        expect(card.textContent).toContain(`InterCom ${V}`);
        expect(card.textContent).toContain("Ready to install");
        expect(card.textContent).toContain("Click to restart and update");
        expect(card.textContent).toContain(`What's new in ${V}`);
        // Every release the update brings, newest first
        // The newest release is named by the title above
        expect(
            within(card)
                .getAllByRole("heading")
                .map((h) => h.textContent),
        ).toEqual(["1.12.35-intercom.12"]);
        expect(card.textContent).toContain("Updates arrive within minutes.");
        expect(screen.getByRole("button", { name: `InterCom ${V} — Ready to install` })).toHaveAttribute(
            "aria-describedby",
            card.id,
        );

        // It stays while the pointer is on it, and goes a moment after the pointer left
        await user.hover(card);
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(screen.getByRole("tooltip")).toBeInTheDocument();
        await user.unhover(card);
        await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    });

    it("opens the card for the keyboard too, and closes it with Escape", async () => {
        const user = userEvent.setup();
        render(<Ready />);
        await user.tab();
        expect(screen.getByRole("button")).toHaveFocus();
        expect(await screen.findByRole("tooltip")).toBeInTheDocument();
        await user.keyboard("{Escape}");
        expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("shows the download in the card, and says that the app restarts by itself once asked to", async () => {
        const user = userEvent.setup();
        const { unmount } = render(<Downloading />);
        await user.hover(screen.getByRole("button"));
        let card = await screen.findByRole("tooltip");
        expect(card.textContent).toContain("Downloading · 41 %");
        expect(within(card).getByRole("progressbar")).toHaveAttribute("value", "41");
        expect(card.textContent).toContain("Click to restart and update as soon as it is ready");
        unmount();

        render(<DownloadingWillRestart />);
        await user.hover(screen.getByRole("button"));
        card = await screen.findByRole("tooltip");
        expect(card.textContent).toContain("Downloading · 80 %");
        expect(card.textContent).toContain("InterCom restarts by itself when it is ready");
    });

    it("says what a click does for a release it cannot install, and after a failure", async () => {
        const user = userEvent.setup();
        const { unmount } = render(<Manual />);
        await user.hover(screen.getByRole("button"));
        expect((await screen.findByRole("tooltip")).textContent).toContain(
            "This install cannot update itself. Click for the release page",
        );
        unmount();
        render(<Failed />);
        await user.hover(screen.getByRole("button"));
        expect((await screen.findByRole("tooltip")).textContent).toContain("Click to try again");
    });

    it("leaves out what is new where there are no notes", async () => {
        const user = userEvent.setup();
        render(<WithoutNotes />);
        await user.hover(screen.getByRole("button"));
        const card = await screen.findByRole("tooltip");
        expect(card.textContent).toContain("Ready to install");
        expect(card.textContent).not.toContain("What's new");
    });

    it("carries its name beside the icon in the expanded rail", () => {
        render(<Expanded />);
        expect(screen.getByRole("button")).toHaveTextContent("Update");
    });
});
