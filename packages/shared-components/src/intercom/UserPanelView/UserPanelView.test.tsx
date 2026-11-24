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

import * as stories from "./UserPanelView.stories";
import { UserPanelView, type UserPanelViewActions, type UserPanelViewSnapshot } from "./UserPanelView";
import { MockViewModel } from "../../core/viewmodel/MockViewModel";

const { Default, InCall, MutedAndSharing, Reconnecting, CallOfAnotherApp } = composeStories(stories);

class TestViewModel extends MockViewModel<UserPanelViewSnapshot> implements UserPanelViewActions {
    public onToggleMute = vi.fn();
    public onToggleDeafen = vi.fn();
    public onOpenSettings = vi.fn();
    public onOpenProfile = vi.fn();
    public onToggleCamera = vi.fn();
    public onToggleScreenShare = vi.fn();
    public onLeaveCall = vi.fn();
    public onJumpToCall = vi.fn();
}

const base: UserPanelViewSnapshot = {
    userId: "@ada:example.org",
    displayName: "Ada",
    presence: "online",
    muted: false,
    deafened: false,
};
const call = { roomName: "Lounge", reconnecting: false, cameraOn: false, screenSharing: false, controllable: true };

describe("UserPanelView", () => {
    it("shows who you are, with mute and deafen there while there is no call", () => {
        render(<Default />);
        expect(screen.getByRole("button", { name: "Ada: your profile" }).textContent).toMatch(/AdaOnline$/);
        expect(screen.getByRole("button", { name: "Mute" })).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByRole("button", { name: "Deafen" })).toHaveAttribute("aria-pressed", "false");
        // The settings are in the rail of spaces: no button for them here without an update
        expect(screen.queryByRole("button", { name: /^Settings/ })).toBeNull();
        expect(screen.queryByTestId("intercom-call-strip")).toBeNull();
    });

    it("shows the user's ID where there is no presence", () => {
        render(<UserPanelView vm={new TestViewModel({ ...base, presence: undefined })} />);
        expect(screen.getByText("@ada:example.org")).toBeInTheDocument();
    });

    it("shows the call strip while in a call", () => {
        render(<InCall />);
        expect(screen.getByRole("status")).toHaveTextContent("Voice connected");
        expect(screen.getByText("Lounge")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Mute" })).toBeEnabled();
        expect(screen.getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "false");
        expect(screen.getByRole("button", { name: "Share screen" })).toHaveAttribute("aria-pressed", "false");
    });

    it("shows what is off and what is on", () => {
        render(<MutedAndSharing />);
        // Deafened is muted too, and the microphone button says what pressing it does then
        expect(screen.getByRole("button", { name: "Unmute and undeafen" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Undeafen" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: "Stop sharing" })).toHaveAttribute("aria-pressed", "true");
    });

    it("says when the call is reconnecting", () => {
        render(<Reconnecting />);
        expect(screen.getByRole("status")).toHaveTextContent("Reconnecting…");
    });

    it("offers only to leave a call it cannot control", () => {
        render(<CallOfAnotherApp />);
        expect(screen.getByRole("button", { name: "Leave the call" })).toBeEnabled();
        expect(screen.queryByRole("button", { name: "Camera" })).toBeNull();
        // Mute is the app's own and works whatever the call is
        expect(screen.getByRole("button", { name: "Mute" })).toBeEnabled();
    });

    it("shows mute and deafen without a call, and lets them be changed", async () => {
        const vm = new TestViewModel({ ...base, muted: true, deafened: false });
        render(<UserPanelView vm={vm} />);
        const unmute = screen.getByRole("button", { name: "Unmute" });
        expect(unmute).toBeEnabled();
        expect(unmute).toHaveAttribute("aria-pressed", "true");
        expect(unmute).toHaveAttribute("data-state", "muted");
        const deafen = screen.getByRole("button", { name: "Deafen" });
        expect(deafen).toHaveAttribute("aria-pressed", "false");
        const user = userEvent.setup();
        await user.click(unmute);
        await user.click(deafen);
        expect(vm.onToggleMute).toHaveBeenCalledTimes(1);
        expect(vm.onToggleDeafen).toHaveBeenCalledTimes(1);
    });

    it("passes every button on to the view model", async () => {
        const vm = new TestViewModel({ ...base, call });
        render(<UserPanelView vm={vm} />);
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", { name: "Mute" }));
        await user.click(screen.getByRole("button", { name: "Deafen" }));
        await user.click(screen.getByRole("button", { name: "Ada: your profile" }));
        await user.click(screen.getByRole("button", { name: "Camera" }));
        await user.click(screen.getByRole("button", { name: "Share screen" }));
        await user.click(screen.getByRole("button", { name: "Leave the call" }));
        await user.click(screen.getByText("Lounge"));
        for (const action of [
            vm.onToggleMute,
            vm.onToggleDeafen,
            vm.onOpenProfile,
            vm.onToggleCamera,
            vm.onToggleScreenShare,
            vm.onLeaveCall,
            vm.onJumpToCall,
        ]) {
            expect(action).toHaveBeenCalledTimes(1);
        }
    });
});

describe("UserPanelView, with an update of the app", () => {
    it("puts a dot on the settings button while an update waits for a restart", async () => {
        const vm = new TestViewModel(base);
        const { rerender } = render(<UserPanelView vm={vm} />);
        expect(screen.queryByTestId("intercom-update-dot")).toBeNull();
        expect(screen.queryByRole("button", { name: /^Settings/ })).toBeNull();

        rerender(<UserPanelView vm={vm} updateReady />);
        expect(screen.getByTestId("intercom-update-dot")).toBeInTheDocument();
        // The button says so too, and still opens the settings
        await userEvent.click(screen.getByRole("button", { name: "Settings (an update is ready)" }));
        expect(vm.onOpenSettings).toHaveBeenCalledTimes(1);
    });
});
