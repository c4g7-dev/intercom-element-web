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
    UpdateRailButtonView,
    type UpdateRailButtonViewActions,
    type UpdateRailButtonViewSnapshot,
} from "./UpdateRailButtonView";
import { useMockedViewModel } from "../../core/viewmodel";

type Props = UpdateRailButtonViewSnapshot & UpdateRailButtonViewActions & { expanded?: boolean };

const Wrapper = ({ onUpdate, onOpenReleasePage, expanded, ...rest }: Props): JSX.Element => {
    const vm = useMockedViewModel(rest, { onUpdate, onOpenReleasePage });
    return (
        <div style={{ width: expanded ? 200 : 64, padding: "200px 0 8px" }}>
            <UpdateRailButtonView vm={vm} expanded={expanded} />
        </div>
    );
};

const VERSION = "1.12.35-intercom.13";
const notes = [
    {
        version: VERSION,
        body: "- **Updates arrive within minutes.** Lattice asks every five minutes whether a release came out.\n- **An update button in the rail of spaces**, above the settings.",
    },
    { version: "1.12.35-intercom.12", body: "- **The way back to the newest messages is Discord's.**" },
];

const meta = {
    title: "InterCom/UpdateRailButtonView",
    component: Wrapper,
    tags: ["autodocs"],
    args: {
        state: "ready",
        version: VERSION,
        installWhenReady: false,
        notes,
        onUpdate: fn(),
        onOpenReleasePage: fn(),
    },
} satisfies Meta<typeof Wrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const Hidden: Story = { args: { state: "hidden", version: undefined, notes: [] } };

export const Available: Story = { args: { state: "available" } };

export const Downloading: Story = { args: { state: "downloading", percent: 41.9 } };

export const DownloadingUnknownSize: Story = { args: { state: "downloading", percent: undefined } };

export const DownloadingWillRestart: Story = { args: { state: "downloading", percent: 80, installWhenReady: true } };

export const Preparing: Story = { args: { state: "preparing" } };

export const Installing: Story = { args: { state: "installing" } };

export const Manual: Story = { args: { state: "manual" } };

export const Failed: Story = { args: { state: "failed" } };

export const WithoutNotes: Story = { args: { notes: [] } };

export const Expanded: Story = { args: { expanded: true } };
