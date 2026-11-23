/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import { fn } from "storybook/test";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { UpdateStatusView, type UpdateStatusViewActions, type UpdateStatusViewSnapshot } from "./UpdateStatusView";
import { useMockedViewModel } from "../../core/viewmodel";

type Props = UpdateStatusViewSnapshot & UpdateStatusViewActions;

const Wrapper = ({ onToggleDetails, onRestart, onRetry, onOpenReleasePage, ...rest }: Props): JSX.Element => {
    const vm = useMockedViewModel(rest, { onToggleDetails, onRestart, onRetry, onOpenReleasePage });
    return (
        <div style={{ width: 320 }}>
            <UpdateStatusView vm={vm} />
        </div>
    );
};

const VERSION = "1.12.35-intercom.7";
const steps = [
    { time: "14:02:11", text: "Checking for updates…" },
    { time: "14:02:12", text: `Found ${VERSION}` },
    { time: "14:02:19", text: `Downloading ${VERSION} · 41 % · 78 MB / 186 MB · 12 MB/s` },
];

const meta = {
    title: "InterCom/UpdateStatusView",
    component: Wrapper,
    tags: ["autodocs"],
    args: {
        phase: "downloading",
        latestVersion: VERSION,
        download: { done: 78_000_000, total: 186_000_000, bytesPerSecond: 12_000_000 },
        log: steps,
        expanded: false,
        onToggleDetails: fn(),
        onRestart: fn(),
        onRetry: fn(),
        onOpenReleasePage: fn(),
    },
} satisfies Meta<typeof Wrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Downloading: Story = {};

export const DownloadingWithSteps: Story = { args: { expanded: true } };

export const Idle: Story = { args: { phase: "idle", latestVersion: undefined, download: undefined, log: [] } };

export const Checking: Story = {
    args: { phase: "checking", latestVersion: undefined, download: undefined, log: steps.slice(0, 1) },
};

export const Verifying: Story = { args: { phase: "verifying", download: undefined } };

export const Unpacking: Story = { args: { phase: "unpacking", download: undefined } };

export const Ready: Story = {
    args: {
        phase: "ready",
        download: undefined,
        log: [...steps, { time: "14:02:31", text: `${VERSION} is ready: restart to update` }],
    },
};

export const Installing: Story = { args: { phase: "installing", download: undefined } };

export const Manual: Story = { args: { phase: "manual", download: undefined } };

export const Failed: Story = {
    args: {
        phase: "error",
        download: undefined,
        expanded: true,
        log: [...steps, { time: "14:02:25", text: "Error: Checksum mismatch for the download" }],
    },
};
