/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { render, screen } from "test-utils-rtl";
import { describe, expect, it } from "vitest";

import { LatticeLoading } from "./LatticeLoading";

describe("LatticeLoading", () => {
    it("is the loading mark, found where a spinner is looked for", () => {
        render(<LatticeLoading />);
        const bar = screen.getByRole("progressbar", { name: "Loading…" });
        expect(bar).toBe(screen.getByTestId("spinner"));
        expect(screen.getByTestId("lattice-mark")).toHaveAttribute("data-variant", "loading");
    });

    it("says what is going on while a call is joined", () => {
        render(<LatticeLoading variant="connecting" message="Connecting" />);
        expect(screen.getByRole("progressbar", { name: "Connecting" })).toBeInTheDocument();
        expect(screen.getByText("Connecting")).toBeInTheDocument();
        expect(screen.getByTestId("lattice-mark")).toHaveAttribute("data-variant", "connecting");
    });
});
