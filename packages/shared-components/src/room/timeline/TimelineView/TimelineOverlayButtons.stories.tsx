/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { TimelineOverlayButtons } from "./TimelineOverlayButtons";
import type { ImmediateScroll, TimelineViewActions, TimelineViewSnapshot } from "./types";

// The overlay takes an already-split snapshot + actions (not a ViewModel), so the
// story flattens them into props — this lets interaction tests override a single
// action (e.g. onJumpToLive) without rebuilding the whole object.
type OverlayStoryProps = TimelineViewSnapshot &
    TimelineViewActions & { scrollNow: ImmediateScroll; farFromBottom?: boolean };

const TimelineOverlayButtonsWrapper = ({
    onStartReached,
    onEndReached,
    onAnchorReached,
    onVisibleRangeChanged,
    onAtBottomStateChange,
    onJumpToReadMarker,
    onMarkAllAsRead,
    onJumpToLive,
    scrollNow,
    farFromBottom,
    ...snapshot
}: OverlayStoryProps): JSX.Element => {
    const vm: TimelineViewActions = {
        onStartReached,
        onEndReached,
        onAnchorReached,
        onVisibleRangeChanged,
        onAtBottomStateChange,
        onJumpToReadMarker,
        onMarkAllAsRead,
        onJumpToLive,
    };
    return <TimelineOverlayButtons snapshot={snapshot} vm={vm} scrollNow={scrollNow} farFromBottom={farFromBottom} />;
};

const meta = {
    title: "Timeline/TimelineOverlayButtons",
    component: TimelineOverlayButtonsWrapper,
    tags: ["autodocs"],
    args: {
        // Snapshot defaults: scrolled up off the live end so the jump-to-bottom shows.
        items: [],
        atLiveEnd: false,
        pendingAnchor: null,
        highlightedEventId: null,
        isAtBottom: false,
        canJumpToReadMarker: false,
        numUnreadMessages: 0,
        hasHighlights: false,
        // Actions.
        onStartReached: fn(),
        onEndReached: fn(),
        onAnchorReached: fn(),
        onVisibleRangeChanged: fn(),
        onAtBottomStateChange: fn(),
        onJumpToReadMarker: fn(),
        onMarkAllAsRead: fn(),
        onJumpToLive: fn(),
        scrollNow: fn(),
    },
    // The overlay absolutely fills its positioned parent; give it a sized box to sit in.
    decorators: [
        (Story) => (
            <div style={{ position: "relative", width: "360px", height: "260px", border: "1px solid #ccc" }}>
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof TimelineOverlayButtonsWrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Off the live end: the bar "You're viewing older messages" with "Jump to present". */
export const JumpToBottom: Story = {};

/** The bar counting the messages that arrived while away. */
export const JumpToBottomWithUnread: Story = {
    args: { numUnreadMessages: 5 },
};

/** Scrolled up a little at the live end: the small arrow, here with a mention among the new messages. */
export const JumpToBottomWithHighlight: Story = {
    args: { atLiveEnd: true, numUnreadMessages: 3, hasHighlights: true },
};

/** Read marker above the viewport: the unread bar along the top. */
export const UnreadMarkerAbove: Story = {
    args: {
        atLiveEnd: true,
        isAtBottom: true,
        canJumpToReadMarker: "above",
        unreadSinceCount: 12,
        unreadSinceTime: "14:32",
    },
};

/** Read marker below the viewport: the unread bar points down. */
export const UnreadMarkerBelow: Story = {
    args: { atLiveEnd: true, isAtBottom: true, canJumpToReadMarker: "below", unreadSinceCount: 2 },
};
