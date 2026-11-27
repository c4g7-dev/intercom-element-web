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

import { JumpToPresentBar } from "./JumpToPresentBar";

const liveRegion = (container: HTMLElement): HTMLElement => container.querySelector('[aria-live="polite"]')!;
// The bar's text as drawn (screen readers get it from the live region instead)
const status = (): string | null => screen.queryByTestId("jump-to-present-status")?.textContent ?? null;

describe("<JumpToPresentBar />", () => {
    it("shows nothing at the newest message, but keeps its live region", () => {
        const { container } = render(<JumpToPresentBar mode="hidden" newMessages={0} onJump={vi.fn()} />);

        expect(screen.queryByRole("button")).toBeNull();
        expect(liveRegion(container)).toBeEmptyDOMElement();
        expect(screen.getByTestId("jump-to-present")).toHaveAttribute("data-mode", "hidden");
    });

    it("far back: says the reader views older messages and offers to jump to the present", async () => {
        const user = userEvent.setup();
        const onJump = vi.fn();
        const { container } = render(<JumpToPresentBar mode="far" newMessages={0} onJump={onJump} />);

        expect(status()).toBe("You're viewing older messages");
        expect(liveRegion(container)).toHaveTextContent("You're viewing older messages");

        await user.click(screen.getByRole("button", { name: "Jump to present" }));
        expect(onJump).toHaveBeenCalledTimes(1);
    });

    it("far back with new messages: counts them instead", () => {
        const { container } = render(<JumpToPresentBar mode="far" newMessages={4} onJump={vi.fn()} />);

        expect(status()).toBe("4 new messages");
        expect(liveRegion(container)).toHaveTextContent("4 new messages");
    });

    it("says one new message in the singular", () => {
        render(<JumpToPresentBar mode="far" newMessages={1} onJump={vi.fn()} />);

        expect(status()).toBe("1 new message");
    });

    it("a little way up: a small arrow only, which says nothing until something new arrives", async () => {
        const user = userEvent.setup();
        const onJump = vi.fn();
        const { container } = render(<JumpToPresentBar mode="near" newMessages={0} onJump={onJump} />);

        expect(status()).toBeNull();
        expect(liveRegion(container)).toBeEmptyDOMElement();

        await user.click(screen.getByRole("button", { name: "Jump to present" }));
        expect(onJump).toHaveBeenCalledTimes(1);
    });

    it("a little way up with new messages: the arrow carries the count", () => {
        const { container } = render(<JumpToPresentBar mode="near" newMessages={3} highlight onJump={vi.fn()} />);

        const pill = screen.getByRole("button", { name: "Jump to present, 3 new messages" });
        expect(pill).toHaveTextContent("3");
        expect(pill).toHaveAttribute("data-highlight");
        expect(liveRegion(container)).toHaveTextContent("3 new messages");
    });

    it("announces the bar when it appears and when its count changes", () => {
        const { container, rerender } = render(<JumpToPresentBar mode="hidden" newMessages={0} onJump={vi.fn()} />);
        const region = liveRegion(container);

        rerender(<JumpToPresentBar mode="far" newMessages={0} onJump={vi.fn()} />);
        expect(region).toHaveTextContent("You're viewing older messages");

        rerender(<JumpToPresentBar mode="far" newMessages={2} onJump={vi.fn()} />);
        // The same element: a live region that is replaced is not announced
        expect(liveRegion(container)).toBe(region);
        expect(region).toHaveTextContent("2 new messages");
    });
});
