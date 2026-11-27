/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { render, screen } from "@test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { UnreadSinceBar } from "./UnreadSinceBar";

const liveRegion = (container: HTMLElement): HTMLElement => container.querySelector('[aria-live="polite"]')!;

describe("<UnreadSinceBar />", () => {
    const props = { onJump: vi.fn(), onMarkAsRead: vi.fn() };

    it("shows nothing while hidden, but keeps its live region", () => {
        const { container } = render(<UnreadSinceBar visible={false} count={3} since="14:32" {...props} />);

        expect(screen.queryByRole("button")).toBeNull();
        expect(liveRegion(container)).toBeEmptyDOMElement();
    });

    it("counts the new messages and says since when", () => {
        const { container } = render(<UnreadSinceBar visible count={12} since="14:32" {...props} />);

        expect(screen.getByRole("button", { name: "12 new messages since 14:32" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Mark as read" })).toBeInTheDocument();
        expect(liveRegion(container)).toHaveTextContent("12 new messages since 14:32");
    });

    it("says one new message in the singular", () => {
        render(<UnreadSinceBar visible count={1} since="Tue 09:05" {...props} />);

        expect(screen.getByRole("button", { name: "1 new message since Tue 09:05" })).toBeInTheDocument();
    });

    it("leaves out what it does not know", () => {
        const { rerender } = render(<UnreadSinceBar visible count={5} since={null} {...props} />);
        expect(screen.getByRole("button", { name: "5 new messages" })).toBeInTheDocument();

        rerender(<UnreadSinceBar visible count={null} since="14:32" {...props} />);
        expect(screen.getByRole("button", { name: "New messages since 14:32" })).toBeInTheDocument();

        rerender(<UnreadSinceBar visible count={null} since={null} {...props} />);
        expect(screen.getByRole("button", { name: "New messages" })).toBeInTheDocument();
    });

    it("jumps to the first unread message, and marks as read", async () => {
        const user = userEvent.setup();
        const onJump = vi.fn();
        const onMarkAsRead = vi.fn();
        render(<UnreadSinceBar visible count={2} since="14:32" onJump={onJump} onMarkAsRead={onMarkAsRead} />);

        await user.click(screen.getByRole("button", { name: "2 new messages since 14:32" }));
        expect(onJump).toHaveBeenCalledTimes(1);
        expect(onMarkAsRead).not.toHaveBeenCalled();

        await user.click(screen.getByRole("button", { name: "Mark as read" }));
        expect(onMarkAsRead).toHaveBeenCalledTimes(1);
    });

    it("announces the bar when it appears", () => {
        const { container, rerender } = render(<UnreadSinceBar visible={false} count={2} since="14:32" {...props} />);
        const region = liveRegion(container);

        rerender(<UnreadSinceBar visible count={2} since="14:32" {...props} />);

        expect(liveRegion(container)).toBe(region);
        expect(region).toHaveTextContent("2 new messages since 14:32");
    });
});
