/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { useCallback, type JSX } from "react";

import type { ImmediateScroll, TimelineViewActions, TimelineViewSnapshot } from "./types";
import { JumpToPresentBar, UnreadSinceBar, jumpToPresentMode } from "../../../intercom/TimelineJumpBars";
import styles from "./TimelineOverlayButtons.module.css";

interface TimelineOverlayButtonsProps {
    snapshot: TimelineViewSnapshot;
    vm: TimelineViewActions;
    /** Imperative scroll-to-anchor handle from the parent View; the VM invokes it
     * when the target is already loaded, else falls back to a pendingAnchor load. */
    scrollNow: ImmediateScroll;
    /**
     * InterCom: whether the reader is far above the end of the loaded list (see
     * `isFarFromPresent`), which the View measures; decides between the bar and the arrow.
     */
    farFromBottom?: boolean;
}

/**
 * Absolutely-positioned overlay on top of the timeline list. InterCom shows the way back to the
 * newest messages and to the unread ones as Discord does:
 * - **Unread bar** along the top, while the read marker is out of view (`canJumpToReadMarker`):
 *   "12 new messages since 14:32", which scrolls to the marker, and "Mark as read".
 * - **Jump to present** at the bottom, while not at the live bottom: a bar "You're viewing older
 *   messages" with "Jump to present" when far back or off the live end, a small arrow when only a
 *   little way up (see `jumpToPresentMode`).
 */
export function TimelineOverlayButtons({
    snapshot,
    vm,
    scrollNow,
    farFromBottom = false,
}: TimelineOverlayButtonsProps): JSX.Element {
    const readMarkerDirection = snapshot.canJumpToReadMarker;
    // Nothing unread after the marker (only our own messages, or events without a tile): no bar
    const showUnread = readMarkerDirection !== false && snapshot.unreadSinceCount !== 0;
    const mode = jumpToPresentMode(snapshot.atLiveEnd, snapshot.isAtBottom, farFromBottom);

    const onJumpToReadMarkerClick = useCallback(() => vm.onJumpToReadMarker(scrollNow), [vm, scrollNow]);
    const onJumpToLiveClick = useCallback(() => vm.onJumpToLive(scrollNow), [vm, scrollNow]);
    const onMarkAllAsReadClick = useCallback(() => vm.onMarkAllAsRead(), [vm]);

    return (
        // Non-interactive layer (pointer-events:none) so clicks fall through to the list;
        // only the bars re-enable them. Must NOT be aria-hidden — these are AT-reachable.
        <div className={styles.overlay}>
            <UnreadSinceBar
                visible={showUnread}
                count={snapshot.unreadSinceCount ?? null}
                since={snapshot.unreadSinceTime ?? null}
                direction={readMarkerDirection === "below" ? "below" : "above"}
                onJump={onJumpToReadMarkerClick}
                onMarkAsRead={onMarkAllAsReadClick}
            />
            <JumpToPresentBar
                mode={mode}
                // What arrived while away, or the unread below the view, which it is part of when
                // there is a read marker
                newMessages={Math.max(snapshot.numUnreadMessages, snapshot.unreadBelowCount ?? 0)}
                highlight={snapshot.hasHighlights}
                onJump={onJumpToLiveClick}
            />
        </div>
    );
}
