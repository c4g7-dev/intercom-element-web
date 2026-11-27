/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { describe, expect, it } from "vitest";

import { FAR_FROM_PRESENT_SCREENS, isFarFromPresent, jumpToPresentMode } from "./jumpToPresent";

describe("isFarFromPresent", () => {
    const viewport = 600;

    it("is one and a half screens", () => {
        expect(FAR_FROM_PRESENT_SCREENS).toBe(1.5);
    });

    it("is not far at the bottom or a little way up", () => {
        expect(isFarFromPresent(0, viewport)).toBe(false);
        expect(isFarFromPresent(120, viewport)).toBe(false);
        expect(isFarFromPresent(viewport, viewport)).toBe(false);
    });

    it("is not far at exactly one and a half screens, and far beyond them", () => {
        expect(isFarFromPresent(900, viewport)).toBe(false);
        expect(isFarFromPresent(901, viewport)).toBe(true);
        expect(isFarFromPresent(20_000, viewport)).toBe(true);
    });

    it("follows the height of the viewport", () => {
        expect(isFarFromPresent(901, 1200)).toBe(false);
        expect(isFarFromPresent(1801, 1200)).toBe(true);
    });

    it("is never far before the viewport has a height", () => {
        expect(isFarFromPresent(5000, 0)).toBe(false);
    });
});

describe("jumpToPresentMode", () => {
    it("shows nothing at the bottom of the live end", () => {
        expect(jumpToPresentMode(true, true, false)).toBe("hidden");
    });

    it("shows the small arrow a little way up", () => {
        expect(jumpToPresentMode(true, false, false)).toBe("near");
    });

    it("shows the bar far back", () => {
        expect(jumpToPresentMode(true, false, true)).toBe("far");
    });

    it("shows the bar whenever the newest messages are not loaded, however the list is scrolled", () => {
        expect(jumpToPresentMode(false, true, false)).toBe("far");
        expect(jumpToPresentMode(false, false, false)).toBe("far");
        expect(jumpToPresentMode(false, false, true)).toBe("far");
    });
});
