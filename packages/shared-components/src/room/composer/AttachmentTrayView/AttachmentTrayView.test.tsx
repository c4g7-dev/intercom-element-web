/*
 * Copyright 2026 The InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { act, render, screen, within } from "@test-utils";
import { composeStories } from "@storybook/react-vite";
import React from "react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import * as stories from "./AttachmentTrayView.stories";
import {
    type AttachmentTrayItem,
    AttachmentTrayView,
    type AttachmentTrayViewModel,
    type AttachmentTrayViewSnapshot,
} from "./AttachmentTrayView";

const { Default, Uploading, Failed, Empty } = composeStories(stories);

/** A view model whose snapshot can be changed by the test. */
class TestViewModel implements AttachmentTrayViewModel {
    private readonly listeners = new Set<() => void>();
    public onRemove = vi.fn();
    public onRetry = vi.fn();

    public constructor(private snapshot: AttachmentTrayViewSnapshot) {}

    public getSnapshot = (): AttachmentTrayViewSnapshot => this.snapshot;

    public subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    public setSnapshot(snapshot: AttachmentTrayViewSnapshot): void {
        this.snapshot = snapshot;
        this.listeners.forEach((listener) => listener());
    }
}

const item = (over: Partial<AttachmentTrayItem>): AttachmentTrayItem => ({
    id: "a",
    name: "cat.png",
    size: "12 KB",
    kind: "image",
    thumbnailUrl: "blob:cat",
    status: "pending",
    progress: 0,
    ...over,
});

describe("AttachmentTrayView", () => {
    it("renders nothing while there are no files", () => {
        render(<Empty />);
        expect(screen.queryByTestId("attachment-tray")).toBeNull();
    });

    it("shows pictures as thumbnails and other files as chips, each with its name and size", () => {
        render(<Default />);
        const cards = within(screen.getByRole("list", { name: "Attachments" })).getAllByRole("listitem");
        expect(cards).toHaveLength(4);

        expect(cards[0]).toHaveAttribute("data-kind", "image");
        expect(cards[0].querySelector("img")).toHaveAttribute("src", expect.stringContaining("data:image/svg+xml"));
        expect(within(cards[0]).getByText("harbour-at-dawn.jpg")).toBeInTheDocument();
        expect(within(cards[0]).getByText("2.4 MB")).toBeInTheDocument();

        expect(cards[3]).toHaveAttribute("data-kind", "file");
        expect(cards[3].querySelector("img")).toBeNull();
        expect(within(cards[3]).getByText("itinerary.pdf")).toBeInTheDocument();
        expect(within(cards[3]).getByText("312 KB")).toBeInTheDocument();
        // Nothing is on its way yet
        expect(screen.queryByRole("progressbar")).toBeNull();
    });

    it("shows a video by its first frame", () => {
        const vm = new TestViewModel({ items: [item({ kind: "video", name: "clip.mp4", thumbnailUrl: "blob:clip" })] });
        render(<AttachmentTrayView vm={vm} />);
        const video = screen.getByRole("listitem").querySelector("video");
        expect(video).toHaveAttribute("src", "blob:clip");
        expect(video).toHaveAttribute("preload", "metadata");
    });

    it("takes a file out with its remove button", async () => {
        const vm = new TestViewModel({ items: [item({}), item({ id: "b", name: "notes.txt", kind: "file" })] });
        render(<AttachmentTrayView vm={vm} />);

        await userEvent.click(screen.getByRole("button", { name: "Remove attachment notes.txt" }));
        expect(vm.onRemove).toHaveBeenCalledExactlyOnceWith("b");
        expect(screen.getByRole("button", { name: "Remove attachment cat.png" })).toBeInTheDocument();
    });

    it("shows how far each upload is", () => {
        render(<Uploading />);
        const bars = screen.getAllByRole("progressbar");
        expect(bars.map((bar) => bar.getAttribute("aria-valuenow"))).toEqual(["100", "62", "18", "0"]);
        expect(screen.getByRole("progressbar", { name: "Uploading ridge.png" })).toBeInTheDocument();
        expect(screen.getByText("62 %")).toBeInTheDocument();
        // An upload can still be stopped
        expect(screen.getByRole("button", { name: "Remove attachment ridge.png" })).toBeInTheDocument();
    });

    it("keeps the progress within its bounds", () => {
        const vm = new TestViewModel({ items: [item({ status: "uploading", progress: 1.7 })] });
        render(<AttachmentTrayView vm={vm} />);
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    });

    it("follows the view model", () => {
        const vm = new TestViewModel({ items: [item({ status: "uploading", progress: 0.25 })] });
        render(<AttachmentTrayView vm={vm} />);
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");

        act(() => vm.setSnapshot({ items: [item({ status: "uploading", progress: 0.5 })] }));
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");

        act(() => vm.setSnapshot({ items: [] }));
        expect(screen.queryByTestId("attachment-tray")).toBeNull();
    });

    it("says that an upload failed and sends it again on request", async () => {
        render(<Failed />);
        expect(screen.getAllByText("Upload failed")).toHaveLength(2);

        const vm = new TestViewModel({ items: [item({ status: "failed" })] });
        render(<AttachmentTrayView vm={vm} />);
        await userEvent.click(screen.getByRole("button", { name: "Retry upload of cat.png" }));
        expect(vm.onRetry).toHaveBeenCalledExactlyOnceWith("a");
        await userEvent.click(screen.getAllByRole("button", { name: "Remove attachment cat.png" })[0]);
        expect(vm.onRemove).toHaveBeenCalledExactlyOnceWith("a");
    });
});
