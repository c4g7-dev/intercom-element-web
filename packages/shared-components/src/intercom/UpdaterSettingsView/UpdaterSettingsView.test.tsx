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

import * as stories from "./UpdaterSettingsView.stories";
import {
    UpdaterSettingsView,
    type UpdaterSettingsViewActions,
    type UpdaterSettingsViewSnapshot,
} from "./UpdaterSettingsView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

const { UpToDate, NeverChecked, Downloading, Ready, Manual, Failed, DevelopmentBuild } = composeStories(stories);

class TestViewModel extends MockViewModel<UpdaterSettingsViewSnapshot> implements UpdaterSettingsViewActions {
    public onAutoCheckChange = vi.fn();
    public onCheckNow = vi.fn();
    public onRestart = vi.fn();
    public onOpenReleasePage = vi.fn();
}

describe("UpdaterSettingsView", () => {
    it("shows the version, the channel and when it last looked", () => {
        render(<UpToDate />);
        expect(screen.getByText("1.12.35-intercom.5")).toBeInTheDocument();
        expect(screen.getByText("Stable")).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent("InterCom is up to date. Last checked today at 14:02.");
        expect(screen.getByRole("switch", { name: "Check for updates automatically" })).toBeChecked();
        expect(screen.queryByRole("button", { name: "Restart to update" })).toBeNull();
    });

    it("says so before the first check", () => {
        render(<NeverChecked />);
        expect(screen.getByRole("status")).toHaveTextContent("Not checked for updates yet.");
    });

    it("shows a download with its progress and no second check meanwhile", () => {
        render(<Downloading />);
        expect(screen.getByRole("status")).toHaveTextContent("Downloading InterCom 1.12.35-intercom.6… 42%");
        expect(screen.getByRole("progressbar")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Check now" })).toBeDisabled();
    });

    it("offers the restart when an update is ready", () => {
        render(<Ready />);
        expect(screen.getByRole("status")).toHaveTextContent(
            "InterCom 1.12.35-intercom.6 is ready. Restart to update.",
        );
        expect(screen.getByRole("button", { name: "Restart to update" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Release notes" })).toBeEnabled();
    });

    it("points at the release page where the app cannot replace itself", () => {
        render(<Manual />);
        expect(screen.getByRole("status").textContent).toContain("InterCom 1.12.35-intercom.6 is available.");
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
            phase: "ready",
            latestVersion: "1.12.35-intercom.6",
        });
        render(<UpdaterSettingsView vm={vm} />);
        const user = userEvent.setup();
        await user.click(screen.getByRole("switch"));
        expect(vm.onAutoCheckChange).toHaveBeenCalledWith(false);
        await user.click(screen.getByRole("button", { name: "Check now" }));
        await user.click(screen.getByRole("button", { name: "Restart to update" }));
        await user.click(screen.getByRole("button", { name: "Release notes" }));
        expect(vm.onCheckNow).toHaveBeenCalledTimes(1);
        expect(vm.onRestart).toHaveBeenCalledTimes(1);
        expect(vm.onOpenReleasePage).toHaveBeenCalledTimes(1);
    });
});
