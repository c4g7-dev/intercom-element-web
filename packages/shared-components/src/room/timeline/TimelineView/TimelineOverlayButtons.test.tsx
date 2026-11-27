/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { render, screen } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { TimelineOverlayButtons } from "./TimelineOverlayButtons";
import type { TimelineViewActions, TimelineViewSnapshot } from "./types";

const baseSnapshot: TimelineViewSnapshot = {
    items: [],
    atLiveEnd: true,
    pendingAnchor: null,
    highlightedEventId: null,
    isAtBottom: true,
    canJumpToReadMarker: false,
    numUnreadMessages: 0,
    hasHighlights: false,
};

// vi.fn() carries a constructable signature that trips assignability to the
// action method types, so cast the record of spies to the interface.
function makeActions(): TimelineViewActions {
    return {
        onStartReached: vi.fn(),
        onEndReached: vi.fn(),
        onAnchorReached: vi.fn(),
        onVisibleRangeChanged: vi.fn(),
        onAtBottomStateChange: vi.fn(),
        onJumpToReadMarker: vi.fn(),
        onMarkAllAsRead: vi.fn(),
        onJumpToLive: vi.fn(),
    } as unknown as TimelineViewActions;
}

// The jump controls must be exposed to AT/keyboard (the overlay is not aria-hidden),
// so plain role queries (which exclude hidden elements) are expected to find them.
const button = (name: string): HTMLElement => screen.getByRole("button", { name });
const queryButton = (name: string): HTMLElement | null => screen.queryByRole("button", { name });

const JUMP_TO_PRESENT = "Jump to present";
const MARK_AS_READ = "Mark as read";
const dock = (): HTMLElement => screen.getByTestId("jump-to-present");

describe("<TimelineOverlayButtons />", () => {
    it("renders no buttons at the live bottom with no read marker", () => {
        const actions = makeActions();
        render(<TimelineOverlayButtons snapshot={baseSnapshot} vm={actions} scrollNow={vi.fn()} />);

        expect(screen.queryByRole("button")).toBeNull();
        expect(dock()).toHaveAttribute("data-mode", "hidden");
    });

    // InterCom: Discord's way back to the present, see intercom/TimelineJumpBars
    describe("jump to present", () => {
        it("is the bar when the live end is not loaded", () => {
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, atLiveEnd: false }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                />,
            );
            expect(dock()).toHaveAttribute("data-mode", "far");
            expect(screen.getByTestId("jump-to-present-status")).toHaveTextContent("You're viewing older messages");
            expect(button(JUMP_TO_PRESENT)).toBeInTheDocument();
        });

        it("is the small arrow at the live end, scrolled up a little", () => {
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, atLiveEnd: true, isAtBottom: false }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                />,
            );
            expect(dock()).toHaveAttribute("data-mode", "near");
            expect(screen.queryByTestId("jump-to-present-status")).toBeNull();
            expect(button(JUMP_TO_PRESENT)).toBeInTheDocument();
        });

        it("is the bar at the live end when scrolled far up", () => {
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, atLiveEnd: true, isAtBottom: false }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                    farFromBottom
                />,
            );
            expect(dock()).toHaveAttribute("data-mode", "far");
        });

        it("calls onJumpToLive with the imperative scroll handle when clicked", async () => {
            const user = userEvent.setup();
            const actions = makeActions();
            const scrollNow = vi.fn();
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, isAtBottom: false }}
                    vm={actions}
                    scrollNow={scrollNow}
                    farFromBottom
                />,
            );

            await user.click(button(JUMP_TO_PRESENT));

            expect(actions.onJumpToLive).toHaveBeenCalledWith(scrollNow);
        });

        it("counts the messages that arrived while away", () => {
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, isAtBottom: false, numUnreadMessages: 7 }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                    farFromBottom
                />,
            );
            expect(screen.getByTestId("jump-to-present-status")).toHaveTextContent("7 new messages");
        });

        it("counts the unread messages below the view when there are more of them", () => {
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, isAtBottom: false, numUnreadMessages: 2, unreadBelowCount: 30 }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                    farFromBottom
                />,
            );
            expect(screen.getByTestId("jump-to-present-status")).toHaveTextContent("30 new messages");
        });

        it("puts the count on the arrow a little way up, marked when one mentions the reader", () => {
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, isAtBottom: false, numUnreadMessages: 1, hasHighlights: true }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                />,
            );
            const pill = button("Jump to present, 1 new message");
            expect(pill).toHaveTextContent("1");
            expect(pill).toHaveAttribute("data-highlight");
        });
    });

    describe("unread bar", () => {
        it("says how many are unread since when, while the marker is above the viewport", () => {
            render(
                <TimelineOverlayButtons
                    snapshot={{
                        ...baseSnapshot,
                        canJumpToReadMarker: "above",
                        unreadSinceCount: 12,
                        unreadSinceTime: "14:32",
                    }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                />,
            );
            expect(button("12 new messages since 14:32")).toBeInTheDocument();
            expect(button(MARK_AS_READ)).toBeInTheDocument();
        });

        it("shows the bar when the marker is below the viewport", () => {
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, canJumpToReadMarker: "below", unreadSinceCount: 2 }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                />,
            );
            expect(button("2 new messages")).toBeInTheDocument();
            expect(button(MARK_AS_READ)).toBeInTheDocument();
        });

        it("is not shown when nothing after the marker is unread", () => {
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, canJumpToReadMarker: "above", unreadSinceCount: 0 }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                />,
            );
            expect(queryButton(MARK_AS_READ)).toBeNull();
        });

        it("is shown when the count is not known", () => {
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, canJumpToReadMarker: "above", unreadSinceCount: null }}
                    vm={makeActions()}
                    scrollNow={vi.fn()}
                />,
            );
            expect(button("New messages")).toBeInTheDocument();
        });

        it("calls onJumpToReadMarker with the scroll handle and onMarkAllAsRead on click", async () => {
            const user = userEvent.setup();
            const actions = makeActions();
            const scrollNow = vi.fn();
            render(
                <TimelineOverlayButtons
                    snapshot={{ ...baseSnapshot, canJumpToReadMarker: "above", unreadSinceCount: 3 }}
                    vm={actions}
                    scrollNow={scrollNow}
                />,
            );

            await user.click(button("3 new messages"));
            expect(actions.onJumpToReadMarker).toHaveBeenCalledWith(scrollNow);

            await user.click(button(MARK_AS_READ));
            expect(actions.onMarkAllAsRead).toHaveBeenCalledTimes(1);
        });
    });
});
