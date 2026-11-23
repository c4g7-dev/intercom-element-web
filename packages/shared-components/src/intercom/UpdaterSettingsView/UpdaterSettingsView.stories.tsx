/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import { fn } from "storybook/test";

import type { Meta, StoryObj } from "@storybook/react-vite";
import {
    UpdaterSettingsView,
    type UpdaterSettingsViewActions,
    type UpdaterSettingsViewSnapshot,
} from "./UpdaterSettingsView";
import { useMockedViewModel } from "../../core/viewmodel";

type Props = UpdaterSettingsViewSnapshot & UpdaterSettingsViewActions;

const Wrapper = ({
    onAutoCheckChange,
    onUpdateOnLaunchChange,
    onCheckNow,
    onRestart,
    onOpenReleasePage,
    ...rest
}: Props): JSX.Element => {
    const vm = useMockedViewModel(rest, {
        onAutoCheckChange,
        onUpdateOnLaunchChange,
        onCheckNow,
        onRestart,
        onOpenReleasePage,
    });
    return <UpdaterSettingsView vm={vm} />;
};

const meta = {
    title: "InterCom/UpdaterSettingsView",
    component: Wrapper,
    tags: ["autodocs"],
    args: {
        supported: true,
        currentVersion: "1.12.35-intercom.5",
        autoCheck: true,
        updateOnLaunch: true,
        phase: "idle",
        lastChecked: "today at 14:02",
        onAutoCheckChange: fn(),
        onUpdateOnLaunchChange: fn(),
        onCheckNow: fn(),
        onRestart: fn(),
        onOpenReleasePage: fn(),
    },
} satisfies Meta<typeof Wrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UpToDate: Story = {};

/** Updates wait for "Restart to update": a start does not install them. */
export const NotOnLaunch: Story = { args: { updateOnLaunch: false } };

/** With the automatic check off nothing is asked of GitHub at a start either. */
export const AutoCheckOff: Story = { args: { autoCheck: false } };

export const NeverChecked: Story = { args: { lastChecked: undefined } };

export const Downloading: Story = {
    args: { phase: "downloading", latestVersion: "1.12.35-intercom.6", progress: 0.42 },
};

export const Verifying: Story = { args: { phase: "verifying", latestVersion: "1.12.35-intercom.6" } };

export const Unpacking: Story = { args: { phase: "unpacking", latestVersion: "1.12.35-intercom.6" } };

export const Installing: Story = { args: { phase: "installing", latestVersion: "1.12.35-intercom.6" } };

export const Ready: Story = { args: { phase: "ready", latestVersion: "1.12.35-intercom.6" } };

export const Manual: Story = { args: { phase: "manual", latestVersion: "1.12.35-intercom.6" } };

export const Failed: Story = { args: { phase: "error", error: "GitHub: HTTP 403" } };

export const DevelopmentBuild: Story = {
    args: { supported: false, reason: "no-version", currentVersion: undefined },
};
