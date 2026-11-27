/*
 * Copyright 2026 The InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import { fn } from "storybook/test";

import type { Meta, StoryObj } from "@storybook/react-vite";
import {
    type AttachmentTrayItem,
    AttachmentTrayView,
    type AttachmentTrayViewActions,
    type AttachmentTrayViewSnapshot,
} from "./AttachmentTrayView";
import { useMockedViewModel } from "../../../core/viewmodel";

type Props = AttachmentTrayViewSnapshot & AttachmentTrayViewActions;

const Wrapper = ({ onRemove, onRetry, ...rest }: Props): JSX.Element => {
    const vm = useMockedViewModel(rest, { onRemove, onRetry });
    return (
        <div style={{ width: 640 }}>
            <AttachmentTrayView vm={vm} />
        </div>
    );
};

/** A drawn picture, so that the stories need no files: two tones and a sun. */
function picture(sky: string, ground: string): string {
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120">` +
        `<rect width="160" height="120" fill="${sky}"/>` +
        `<circle cx="118" cy="38" r="16" fill="#fff" fill-opacity="0.85"/>` +
        `<path d="M0 120V84l38-30 34 26 30-18 58 40v18z" fill="${ground}"/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const pictures: AttachmentTrayItem[] = [
    {
        id: "1",
        name: "harbour-at-dawn.jpg",
        size: "2.4 MB",
        kind: "image",
        thumbnailUrl: picture("#5b6ee1", "#1d2149"),
        status: "pending",
        progress: 0,
    },
    {
        id: "2",
        name: "ridge.png",
        size: "880 KB",
        kind: "image",
        thumbnailUrl: picture("#e0915a", "#5a2f2a"),
        status: "pending",
        progress: 0,
    },
    {
        id: "3",
        name: "a-very-long-name-for-a-picture-of-the-lake.webp",
        size: "1.1 MB",
        kind: "image",
        thumbnailUrl: picture("#4fa58d", "#143c33"),
        status: "pending",
        progress: 0,
    },
];

const file: AttachmentTrayItem = {
    id: "4",
    name: "itinerary.pdf",
    size: "312 KB",
    kind: "file",
    status: "pending",
    progress: 0,
};

const meta = {
    title: "Composer/AttachmentTrayView",
    component: Wrapper,
    tags: ["autodocs"],
    args: {
        items: [...pictures, file],
        onRemove: fn(),
        onRetry: fn(),
    },
} satisfies Meta<typeof Wrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three pictures and a file, waiting for the message. */
export const Default: Story = {};

export const OnlyFiles: Story = {
    args: { items: [file, { ...file, id: "5", name: "notes.txt", size: "4 KB" }] },
};

/** The message was sent: each file says how far its upload is. */
export const Uploading: Story = {
    args: {
        items: [
            { ...pictures[0], status: "uploading", progress: 1 },
            { ...pictures[1], status: "uploading", progress: 0.62 },
            { ...pictures[2], status: "uploading", progress: 0.18 },
            { ...file, status: "uploading", progress: 0 },
        ],
    },
};

/** One upload failed: it stays, and can be sent again or taken out. */
export const Failed: Story = {
    args: {
        items: [pictures[0], { ...pictures[1], status: "failed" }, { ...file, status: "failed" }],
    },
};

export const Empty: Story = { args: { items: [] } };
