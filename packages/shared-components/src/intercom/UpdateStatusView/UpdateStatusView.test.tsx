/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { render, screen, within } from "@test-utils";
import { composeStories } from "@storybook/react-vite";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import * as stories from "./UpdateStatusView.stories";
import {
    formatUpdateBytes,
    UpdateStatusView,
    type UpdateStatusViewActions,
    type UpdateStatusViewSnapshot,
} from "./UpdateStatusView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

const { Downloading, DownloadingWithSteps, Idle, Checking, Verifying, Unpacking, Ready, Installing, Manual, Failed } =
    composeStories(stories);

class TestViewModel extends MockViewModel<UpdateStatusViewSnapshot> implements UpdateStatusViewActions {
    public onToggleDetails = vi.fn();
    public onLater = vi.fn();
    public onRestart = vi.fn();
    public onRetry = vi.fn();
    public onOpenReleasePage = vi.fn();
}

const VERSION = "1.12.35-intercom.15";

describe("UpdateStatusView", () => {
    it("shows nothing while the updater is idle", () => {
        render(<Idle />);
        expect(screen.queryByTestId("intercom-update-status")).toBeNull();
    });

    it("shows a download in one line, with how far it is", () => {
        render(<Downloading />);
        expect(screen.getByRole("status")).toHaveTextContent(
            `Downloading ${VERSION} · 41 % · 78 MB / 186 MB · 12 MB/s`,
        );
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
        // The steps are hidden until asked for
        expect(screen.queryByRole("list")).toBeNull();
        expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    });

    it("leaves out what it does not know of a download", () => {
        const vm = new TestViewModel({
            phase: "downloading",
            latestVersion: VERSION,
            download: { done: 5_000_000, total: 0, bytesPerSecond: 0 },
            log: [],
            expanded: false,
        });
        render(<UpdateStatusView vm={vm} />);
        expect(screen.getByRole("status")).toHaveTextContent(`Downloading ${VERSION} · 5 MB`);
        expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    });

    it.each([
        ["checking", Checking, "Checking for updates…"],
        ["verifying", Verifying, "Verifying checksum…"],
        ["unpacking", Unpacking, "Unpacking…"],
        ["installing", Installing, "Restarting to update…"],
    ])("says what it does while %s, without a measure", (_phase, Story, text) => {
        render(<Story />);
        expect(screen.getByRole("status")).toHaveTextContent(text);
        expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
    });

    it("offers the restart when the update is ready", async () => {
        const vm = new TestViewModel({ phase: "ready", latestVersion: VERSION, log: [], expanded: false });
        render(<UpdateStatusView vm={vm} />);
        expect(screen.getByRole("status")).toHaveTextContent(`Lattice ${VERSION} is ready`);
        await userEvent.click(screen.getByRole("button", { name: "Update" }));
        expect(vm.onRestart).toHaveBeenCalledTimes(1);
        expect(vm.onToggleDetails).not.toHaveBeenCalled();
    });

    it("renders the ready and the manual state", () => {
        const { unmount } = render(<Ready />);
        expect(screen.getByRole("button", { name: "Update" })).toBeEnabled();
        unmount();
        render(<Manual />);
        expect(screen.getByRole("status")).toHaveTextContent(`Lattice ${VERSION} is available`);
        expect(screen.getByRole("button", { name: "Release page" })).toBeEnabled();
    });

    it("leads to the release page where the install cannot update itself", async () => {
        const vm = new TestViewModel({ phase: "manual", latestVersion: VERSION, log: [], expanded: false });
        render(<UpdateStatusView vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "Release page" }));
        expect(vm.onOpenReleasePage).toHaveBeenCalledTimes(1);
    });

    it("shows the last steps with their times when the line is clicked", async () => {
        const vm = new TestViewModel({
            phase: "verifying",
            latestVersion: VERSION,
            log: [{ time: "14:02:11", text: "Checking for updates…" }],
            expanded: false,
        });
        render(<UpdateStatusView vm={vm} />);
        const line = screen.getByRole("button", { name: "Verifying checksum…" });
        expect(line).toHaveAttribute("aria-expanded", "false");
        await userEvent.click(line);
        expect(vm.onToggleDetails).toHaveBeenCalledTimes(1);
    });

    it("says that the steps are shown", () => {
        const vm = new TestViewModel({
            phase: "verifying",
            latestVersion: VERSION,
            log: [],
            expanded: true,
        });
        render(<UpdateStatusView vm={vm} />);
        expect(screen.getByRole("button", { name: "Verifying checksum…" })).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByRole("list", { name: "Update steps" })).toHaveTextContent("Nothing yet");
    });

    it("lists the steps, oldest first", () => {
        render(<DownloadingWithSteps />);
        const items = within(screen.getByRole("list", { name: "Update steps" })).getAllByRole("listitem");
        expect(items.map((item) => item.textContent)).toEqual([
            "14:02:11 Checking for updates…",
            `14:02:12 Found ${VERSION}`,
            `14:02:19 Downloading ${VERSION} · 41 % · 78 MB / 186 MB · 12 MB/s`,
        ]);
    });

    it("keeps a failure in view, with a retry and its details", async () => {
        render(<Failed />);
        expect(screen.getByRole("status")).toHaveTextContent("The update failed");
        expect(screen.getByText("Error: Checksum mismatch for the download", { exact: false })).toBeInTheDocument();

        const vm = new TestViewModel({ phase: "error", latestVersion: VERSION, log: [], expanded: false });
        render(<UpdateStatusView vm={vm} />);
        await userEvent.click(screen.getAllByRole("button", { name: "Retry" }).at(-1)!);
        expect(vm.onRetry).toHaveBeenCalledTimes(1);
        await userEvent.click(screen.getAllByRole("button", { name: "Details" }).at(-1)!);
        expect(vm.onToggleDetails).toHaveBeenCalledTimes(1);
    });
});

describe("formatUpdateBytes", () => {
    it.each([
        [0, "0 B"],
        [999, "999 B"],
        [1500, "1.5 kB"],
        [78_000_000, "78 MB"],
        [2_150_000_000, "2.2 GB"],
        [NaN, "0 B"],
    ])("%d is %s", (bytes, text) => {
        expect(formatUpdateBytes(bytes)).toBe(text);
    });

    it("is one card for an update that is offered: the mark, a line of what is new, Later and Update", async () => {
        const vm = new TestViewModel({
            phase: "ready",
            latestVersion: VERSION,
            log: [],
            expanded: false,
            summary: "Attachments wait above the composer.",
        });
        render(<UpdateStatusView vm={vm} />);
        expect(screen.getByTestId("lattice-mark")).toHaveAttribute("data-variant", "still");
        expect(screen.getByTestId("intercom-update-summary")).toHaveTextContent("Attachments wait above the composer.");
        // The whole line is there for whoever points at it, where the card cuts it off
        expect(screen.getByTestId("intercom-update-summary")).toHaveAttribute(
            "title",
            "Attachments wait above the composer.",
        );
        await userEvent.click(screen.getByRole("button", { name: "Later" }));
        expect(vm.onLater).toHaveBeenCalledTimes(1);
        expect(vm.onRestart).not.toHaveBeenCalled();
    });

    it("has the bar of the download inside the card, and the mark moving, while something is on its way", () => {
        render(<Downloading />);
        const card = screen.getByTestId("intercom-update-status");
        expect(card).toContainElement(screen.getByRole("progressbar"));
        expect(screen.getByTestId("lattice-mark")).toHaveAttribute("data-variant", "loading");
        expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
        expect(screen.queryByTestId("intercom-update-summary")).toBeNull();
    });

    it("offers Later beside the release page for an install that cannot replace itself", async () => {
        const vm = new TestViewModel({ phase: "manual", latestVersion: VERSION, log: [], expanded: false });
        render(<UpdateStatusView vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "Release page" }));
        expect(vm.onOpenReleasePage).toHaveBeenCalledTimes(1);
        expect(screen.getByRole("button", { name: "Later" })).toBeInTheDocument();
    });
});
