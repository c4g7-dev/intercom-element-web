/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { LatticeMark } from "./LatticeMark";

const meta = {
    title: "InterCom/LatticeMark",
    component: LatticeMark,
    tags: ["autodocs"],
    args: { variant: "loading", size: "96px" },
} satisfies Meta<typeof LatticeMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};

export const Connecting: Story = { args: { variant: "connecting", label: "Connecting…" } };

export const Speaking: Story = {
    args: { variant: "speaking", size: undefined },
    render: (args): JSX.Element => (
        <span style={{ color: "var(--cpd-color-icon-success-primary)", font: "var(--cpd-font-body-md-regular)" }}>
            <LatticeMark {...args} /> Mira Okafor
        </span>
    ),
};
