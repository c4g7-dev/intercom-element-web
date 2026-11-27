/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { act, fireEvent, render, screen } from "test-utils-rtl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubClient } from "test-utils/test-utils";

import { AVATAR_RETRY_DELAYS_MS, IntercomAvatar } from "./Avatar";

/** The pictures the component tries in the background, which the test lets load or fail. */
const probes: { src: string; onload: (() => void) | null; onerror: (() => void) | null }[] = [];
class FakeImage {
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    public constructor() {
        probes.push(this as unknown as (typeof probes)[number]);
    }
    public set src(value: string) {
        (this as unknown as { url: string }).url = value;
    }
}

describe("IntercomAvatar", () => {
    const url = "https://example.org/_matrix/media/v3/thumbnail/example.org/nora?width=32";
    const img = (): HTMLImageElement | null => document.querySelector("img");

    beforeEach(() => {
        stubClient();
        probes.length = 0;
        vi.useFakeTimers();
        vi.stubGlobal("Image", FakeImage);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("shows the picture, as Element's avatars do", () => {
        render(<IntercomAvatar id="@nora:example.org" name="Nora" url={url} size="32px" />);
        expect(img()).toHaveAttribute("src", url);
    });

    it("shows the initial, not a broken picture, when the picture is refused", () => {
        render(<IntercomAvatar id="@nora:example.org" name="Nora" url={url} size="32px" />);

        fireEvent.error(img()!);

        expect(img()).toBeNull();
        expect(screen.getByText("N")).toBeInTheDocument();
    });

    it("tries a refused picture again a little later, and shows it once it can be had", () => {
        render(<IntercomAvatar id="@nora:example.org" name="Nora" url={url} size="32px" />);
        fireEvent.error(img()!);
        // The background check fails as well
        act(() => probes[0].onerror!());

        // Still refused at the first try again
        act(() => {
            vi.advanceTimersByTime(AVATAR_RETRY_DELAYS_MS[0]);
        });
        expect(probes).toHaveLength(2);
        act(() => probes[1].onerror!());
        expect(img()).toBeNull();

        // Then it loads
        act(() => {
            vi.advanceTimersByTime(AVATAR_RETRY_DELAYS_MS[1]);
        });
        act(() => probes[2].onload!());
        expect(img()).toHaveAttribute("src", url);
    });

    it("tries nothing again for a picture that loaded", () => {
        render(<IntercomAvatar id="@nora:example.org" name="Nora" url={url} size="32px" />);
        act(() => probes[0].onload?.());

        act(() => {
            vi.advanceTimersByTime(AVATAR_RETRY_DELAYS_MS.at(-1)! * 3);
        });
        expect(probes).toHaveLength(1);
    });

    it("draws the initial without a picture", () => {
        render(<IntercomAvatar id="@nora:example.org" name="Nora" size="32px" />);
        expect(img()).toBeNull();
        expect(screen.getByText("N")).toBeInTheDocument();
        expect(probes).toHaveLength(0);
    });
});
