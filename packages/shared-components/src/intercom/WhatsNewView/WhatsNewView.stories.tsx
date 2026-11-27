/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import { fn } from "storybook/test";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { WhatsNewView } from "./WhatsNewView";

const Wrapper = (props: React.ComponentProps<typeof WhatsNewView>): JSX.Element => (
    <div style={{ width: 560 }} data-testid="whats-new">
        <WhatsNewView {...props} />
    </div>
);

const meta = {
    title: "InterCom/WhatsNewView",
    component: Wrapper,
    tags: ["autodocs"],
    args: {
        version: "1.12.35-intercom.15",
        notes: [
            {
                version: "1.12.35-intercom.15",
                body:
                    "- **InterCom is now Lattice.** A new name and a new icon. You stay signed in, and your settings stay where they are.\n" +
                    "- **Attachments wait above the composer.** Paste, drop or add pictures and files, keep typing, and Enter sends them all.\n" +
                    "- **The mark moves where something is on its way**: while the app loads, while a call is joined, and beside whoever speaks.",
            },
            {
                version: "1.12.35-intercom.14",
                body: "- **The call's dialogs use the whole window.**\n- A connection card with ping, loss and transport.",
            },
        ],
        releasesUrl: "https://github.com/c4g7-dev/InterCom/releases",
        heading: true,
        onDismiss: fn(),
    },
} satisfies Meta<typeof Wrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
