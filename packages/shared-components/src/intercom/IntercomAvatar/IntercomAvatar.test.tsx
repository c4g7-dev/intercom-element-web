/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React from "react";
import { fireEvent, render, screen } from "@test-utils";
import { describe, expect, it } from "vitest";

import { FallbackAvatar } from "./IntercomAvatar";

describe("FallbackAvatar", () => {
    const avatar = { id: "@ada:example.org", name: "Ada", size: "32px" };

    it("shows the picture", () => {
        const { container } = render(<FallbackAvatar {...avatar} url="https://example.org/ada.png" />);
        expect(container.querySelector("img")).toHaveAttribute("src", "https://example.org/ada.png");
    });

    it("shows the initial, not a broken picture, when the picture fails to load", () => {
        const { container } = render(<FallbackAvatar {...avatar} url="https://example.org/refused.png" />);

        fireEvent.error(container.querySelector("img")!);

        expect(container.querySelector("img")).toBeNull();
        expect(screen.getByText("A")).toBeInTheDocument();
    });

    it("tries a new picture again", () => {
        const { container, rerender } = render(<FallbackAvatar {...avatar} url="https://example.org/refused.png" />);
        fireEvent.error(container.querySelector("img")!);

        rerender(<FallbackAvatar {...avatar} url="https://example.org/ada.png" />);

        expect(container.querySelector("img")).toHaveAttribute("src", "https://example.org/ada.png");
    });
});
