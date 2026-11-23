/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import { fn } from "storybook/test";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { UserPanelView, type UserPanelViewActions, type UserPanelViewSnapshot } from "./UserPanelView";
import { useMockedViewModel } from "../../core/viewmodel";

type Props = UserPanelViewSnapshot & UserPanelViewActions;

const Wrapper = ({
    onToggleMute,
    onToggleDeafen,
    onOpenSettings,
    onOpenProfile,
    onToggleCamera,
    onToggleScreenShare,
    onLeaveCall,
    onJumpToCall,
    ...rest
}: Props): JSX.Element => {
    const vm = useMockedViewModel(rest, {
        onToggleMute,
        onToggleDeafen,
        onOpenSettings,
        onOpenProfile,
        onToggleCamera,
        onToggleScreenShare,
        onLeaveCall,
        onJumpToCall,
    });
    return (
        <div style={{ width: 300 }}>
            <UserPanelView vm={vm} />
        </div>
    );
};

const call = { roomName: "Lounge", reconnecting: false, cameraOn: false, screenSharing: false, controllable: true };

const meta = {
    title: "InterCom/UserPanelView",
    component: Wrapper,
    tags: ["autodocs"],
    args: {
        userId: "@ada:example.org",
        displayName: "Ada",
        presence: "online",
        muted: false,
        deafened: false,
        onToggleMute: fn(),
        onToggleDeafen: fn(),
        onOpenSettings: fn(),
        onOpenProfile: fn(),
        onToggleCamera: fn(),
        onToggleScreenShare: fn(),
        onLeaveCall: fn(),
        onJumpToCall: fn(),
    },
} satisfies Meta<typeof Wrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InCall: Story = { args: { call } };

export const MutedAndSharing: Story = {
    args: { muted: true, deafened: true, call: { ...call, cameraOn: true, screenSharing: true } },
};

export const Reconnecting: Story = { args: { call: { ...call, reconnecting: true } } };

export const CallOfAnotherApp: Story = { args: { call: { ...call, controllable: false } } };
