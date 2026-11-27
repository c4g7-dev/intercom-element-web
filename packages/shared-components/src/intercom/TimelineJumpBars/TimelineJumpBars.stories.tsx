/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import { fn } from "storybook/test";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { JumpToPresentBar } from "./JumpToPresentBar";
import { UnreadSinceBar } from "./UnreadSinceBar";
import type { JumpToPresentMode } from "./jumpToPresent";

interface Props {
    mode: JumpToPresentMode;
    newMessages: number;
    highlight: boolean;
    unreadVisible: boolean;
    unreadCount: number | null;
    unreadSince: string | null;
    onJump: () => void;
    onJumpToUnread: () => void;
    onMarkAsRead: () => void;
}

/** Both bars over a timeline-sized box, as they sit in a room. */
const Wrapper = ({
    mode,
    newMessages,
    highlight,
    unreadVisible,
    unreadCount,
    unreadSince,
    onJump,
    onJumpToUnread,
    onMarkAsRead,
}: Props): JSX.Element => (
    <div style={{ position: "relative", width: 640, height: 280, background: "var(--cpd-color-bg-canvas-default)" }}>
        <UnreadSinceBar
            visible={unreadVisible}
            count={unreadCount}
            since={unreadSince}
            onJump={onJumpToUnread}
            onMarkAsRead={onMarkAsRead}
        />
        <JumpToPresentBar mode={mode} newMessages={newMessages} highlight={highlight} onJump={onJump} />
    </div>
);

const meta = {
    title: "InterCom/TimelineJumpBars",
    component: Wrapper,
    tags: ["autodocs"],
    args: {
        mode: "far",
        newMessages: 0,
        highlight: false,
        unreadVisible: false,
        unreadCount: 12,
        unreadSince: "14:32",
        onJump: fn(),
        onJumpToUnread: fn(),
        onMarkAsRead: fn(),
    },
} satisfies Meta<typeof Wrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Far back: the bar above the composer. */
export const FarBack: Story = {};

/** Far back, with messages that arrived meanwhile. */
export const FarBackWithNewMessages: Story = { args: { newMessages: 4 } };

/** A little way up: the small arrow. */
export const NearTheEnd: Story = { args: { mode: "near" } };

/** A little way up, with new messages, one of them a mention. */
export const NearTheEndWithMention: Story = { args: { mode: "near", newMessages: 2, highlight: true } };

/** Unread messages above the viewport: the bar along the top. */
export const UnreadAbove: Story = { args: { mode: "hidden", unreadVisible: true } };
