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

import * as stories from "./UpdaterSettingsView.stories";
import {
    UpdaterSettingsView,
    type UpdaterSettingsViewActions,
    type UpdaterSettingsViewSnapshot,
} from "./UpdaterSettingsView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

const {
    UpToDate,
    NotOnLaunch,
    AutoCheckOff,
    NeverChecked,
    Downloading,
    Verifying,
    Unpacking,
    Installing,
    Ready,
    Manual,
    Failed,
    DevelopmentBuild,
    ReadyWithNotes,
} = composeStories(stories);

class TestViewModel extends MockViewModel<UpdaterSettingsViewSnapshot> implements UpdaterSettingsViewActions {
    public onAutoCheckChange = vi.fn();
    public onUpdateOnLaunchChange = vi.fn();
    public onFastCheckChange = vi.fn();
    public onShowWhatsNewChange = vi.fn();
    public onCheckNow = vi.fn();
    public onRestart = vi.fn();
    public onOpenReleasePage = vi.fn();
}

describe("UpdaterSettingsView", () => {
    it("shows the version, the channel and when it last looked", () => {
        render(<UpToDate />);
        expect(screen.getByText("1.12.35-intercom.5")).toBeInTheDocument();
        expect(screen.getByText("Stable")).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent("Lattice is up to date. Last checked today at 14:02.");
        expect(screen.getByRole("switch", { name: "Check for updates automatically" })).toBeChecked();
        expect(screen.getByRole("switch", { name: "Update automatically on launch" })).toBeChecked();
        expect(screen.queryByRole("button", { name: "Restart to update" })).toBeNull();
    });

    it("shows that a start does not install updates when that is off", () => {
        render(<NotOnLaunch />);
        expect(screen.getByRole("switch", { name: "Update automatically on launch" })).not.toBeChecked();
        expect(screen.getByRole("switch", { name: "Update automatically on launch" })).toBeEnabled();
    });

    it("has no update on launch without the automatic check", () => {
        render(<AutoCheckOff />);
        const onLaunch = screen.getByRole("switch", { name: "Update automatically on launch" });
        expect(onLaunch).not.toBeChecked();
        expect(onLaunch).toBeDisabled();
    });

    it("says so before the first check", () => {
        render(<NeverChecked />);
        expect(screen.getByRole("status")).toHaveTextContent("Not checked for updates yet.");
    });

    it("shows a download with its progress and no second check meanwhile", () => {
        render(<Downloading />);
        expect(screen.getByRole("status")).toHaveTextContent("Downloading Lattice 1.12.35-intercom.6… 42%");
        expect(screen.getByRole("progressbar")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Check now" })).toBeDisabled();
    });

    it.each([
        ["the checksum is checked", Verifying, "Verifying the checksum of Lattice 1.12.35-intercom.6…"],
        ["the update is unpacked", Unpacking, "Unpacking Lattice 1.12.35-intercom.6…"],
        ["the update is installed", Installing, "Installing Lattice 1.12.35-intercom.6 and restarting…"],
    ])("says so while %s, and starts no check meanwhile", (_what, Story, text) => {
        render(<Story />);
        expect(screen.getByRole("status")).toHaveTextContent(text);
        expect(screen.getByRole("button", { name: "Check now" })).toBeDisabled();
    });

    it("offers the restart when an update is ready", () => {
        render(<Ready />);
        expect(screen.getByRole("status")).toHaveTextContent(
            "Lattice 1.12.35-intercom.6 is ready. Restart to update.",
        );
        expect(screen.getByRole("button", { name: "Restart to update" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Release notes" })).toBeEnabled();
    });

    it("points at the release page where the app cannot replace itself", () => {
        render(<Manual />);
        expect(screen.getByRole("status").textContent).toContain("Lattice 1.12.35-intercom.6 is available.");
        expect(screen.queryByRole("button", { name: "Restart to update" })).toBeNull();
    });

    it("shows what went wrong", () => {
        render(<Failed />);
        expect(screen.getByRole("status")).toHaveTextContent("The update check failed: GitHub: HTTP 403");
        expect(screen.getByRole("button", { name: "Check now" })).toBeEnabled();
    });

    it("explains why a development build does not update, and offers nothing", () => {
        render(<DevelopmentBuild />);
        expect(screen.getByRole("note").textContent).toContain("not a release");
        expect(screen.queryByRole("switch")).toBeNull();
        expect(screen.queryByRole("button", { name: "Check now" })).toBeNull();
    });

    it("passes the controls on to the view model", async () => {
        const vm = new TestViewModel({
            supported: true,
            currentVersion: "1.12.35-intercom.5",
            autoCheck: true,
            updateOnLaunch: true,
            fastCheck: true,
            showWhatsNew: true,
            notes: [],
            phase: "ready",
            latestVersion: "1.12.35-intercom.6",
        });
        render(<UpdaterSettingsView vm={vm} />);
        const user = userEvent.setup();
        await user.click(screen.getByRole("switch", { name: "Check for updates automatically" }));
        expect(vm.onAutoCheckChange).toHaveBeenCalledWith(false);
        await user.click(screen.getByRole("switch", { name: "Update automatically on launch" }));
        expect(vm.onUpdateOnLaunchChange).toHaveBeenCalledWith(false);
        await user.click(screen.getByRole("switch", { name: "Check for updates every few minutes" }));
        expect(vm.onFastCheckChange).toHaveBeenCalledWith(false);
        await user.click(screen.getByRole("switch", { name: "Show what's new after updates" }));
        expect(vm.onShowWhatsNewChange).toHaveBeenCalledWith(false);
        await user.click(screen.getByRole("button", { name: "Check now" }));
        await user.click(screen.getByRole("button", { name: "Restart to update" }));
        await user.click(screen.getByRole("button", { name: "Release notes" }));
        expect(vm.onCheckNow).toHaveBeenCalledTimes(1);
        expect(vm.onRestart).toHaveBeenCalledTimes(1);
        expect(vm.onOpenReleasePage).toHaveBeenCalledTimes(1);
    });

    it("shows what is new in the release that is offered, every release since the running one", () => {
        render(<ReadyWithNotes />);
        const whatsNew = screen.getByRole("region", { name: "What's new in 1.12.35-intercom.7" });
        expect(within(whatsNew).getByRole("heading", { name: "1.12.35-intercom.6" })).toBeInTheDocument();
        expect(within(whatsNew).queryByRole("heading", { name: "1.12.35-intercom.7" })).toBeNull();
        expect(whatsNew.textContent).toContain("Updates arrive within minutes.");
        expect(whatsNew.textContent).toContain("Mute and deafen are one state for the whole app.");
    });

    it("shows no notes while nothing is offered, and cannot speed up a check that is off", () => {
        render(<UpToDate />);
        expect(screen.queryByRole("region")).toBeNull();
        expect(screen.getByRole("switch", { name: "Check for updates every few minutes" })).toBeChecked();
        expect(screen.getByRole("switch", { name: "Show what's new after updates" })).toBeChecked();
    });

    it("shows the frequent check as off, and locked, while the automatic check is off", () => {
        render(<AutoCheckOff />);
        const fast = screen.getByRole("switch", { name: "Check for updates every few minutes" });
        expect(fast).not.toBeChecked();
        expect(fast).toBeDisabled();
        // What is new does not depend on it
        expect(screen.getByRole("switch", { name: "Show what's new after updates" })).toBeEnabled();
    });
});
