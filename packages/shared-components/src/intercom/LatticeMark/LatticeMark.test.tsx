/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { render, screen } from "@test-utils";
import React from "react";
import { describe, it, expect } from "vitest";

import { LatticeMark } from "./LatticeMark";

describe("LatticeMark", () => {
    it("draws the tile with three bars and six dots while loading", () => {
        const { container } = render(<LatticeMark variant="loading" />);
        const mark = screen.getByTestId("lattice-mark");
        expect(mark).toHaveAttribute("data-variant", "loading");
        expect(mark).toHaveAttribute("viewBox", "0 0 512 512");
        expect(container.querySelectorAll("rect")).toHaveLength(4);
        expect(container.querySelectorAll("circle")).toHaveLength(6);
        expect(mark).toHaveAttribute("width", "48px");
    });

    it("draws a ring of eight dots around one while connecting, each lit a little later", () => {
        const { container } = render(<LatticeMark variant="connecting" size="96px" />);
        const circles = [...container.querySelectorAll("circle")];
        expect(circles).toHaveLength(9);
        const delays = circles.slice(0, 8).map((c) => parseFloat((c as SVGElement).style.animationDelay));
        expect(delays[0]).toBe(0);
        expect([...delays].sort((a, b) => a - b)).toEqual(delays);
        expect(delays[7]).toBeLessThan(2.4);
        expect(screen.getByTestId("lattice-mark")).toHaveAttribute("height", "96px");
    });

    it("draws three bars and no tile for somebody speaking, as tall as the text", () => {
        const { container } = render(<LatticeMark variant="speaking" />);
        expect(container.querySelectorAll("rect")).toHaveLength(3);
        expect(container.querySelectorAll("circle")).toHaveLength(0);
        expect(screen.getByTestId("lattice-mark")).toHaveAttribute("width", "1em");
    });

    it("is hidden from screen readers unless it is given a name", () => {
        const { rerender } = render(<LatticeMark variant="loading" />);
        expect(screen.getByTestId("lattice-mark")).toHaveAttribute("aria-hidden", "true");
        expect(screen.queryByRole("img")).not.toBeInTheDocument();

        rerender(<LatticeMark variant="connecting" label="Connecting…" />);
        expect(screen.getByRole("img", { name: "Connecting…" })).not.toHaveAttribute("aria-hidden");
    });
});
