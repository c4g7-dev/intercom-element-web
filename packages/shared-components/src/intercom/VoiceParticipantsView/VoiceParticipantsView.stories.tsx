/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import { fn } from "storybook/test";

import type { Meta, StoryObj } from "@storybook/react-vite";
import {
    VoiceParticipantsView,
    type VoiceParticipantsViewActions,
    type VoiceParticipantsViewSnapshot,
} from "./VoiceParticipantsView";
import { useMockedViewModel } from "../../core/viewmodel";

type Props = VoiceParticipantsViewSnapshot & VoiceParticipantsViewActions;

const Wrapper = ({ onJoin, ...rest }: Props): JSX.Element => {
    const vm = useMockedViewModel(rest, { onJoin });
    return (
        <div style={{ width: 280 }}>
            <VoiceParticipantsView vm={vm} />
        </div>
    );
};

const person = (
    id: string,
    name: string,
    state: Partial<Props["participants"][number]> = {},
): Props["participants"][number] => ({
    id,
    name,
    speaking: false,
    muted: false,
    deafened: false,
    live: false,
    ...state,
});

const meta = {
    title: "InterCom/VoiceParticipantsView",
    component: Wrapper,
    tags: ["autodocs"],
    args: {
        roomName: "Lounge",
        participants: [
            person("@ada:example.org", "Ada", { speaking: true }),
            person("@ben:example.org", "Ben", { muted: true }),
            person("@cy:example.org", "Cy with a rather long display name", { live: true }),
            person("@dee:example.org", "Dee", { muted: true, deafened: true }),
        ],
        onJoin: fn(),
    },
} satisfies Meta<typeof Wrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { participants: [] } };

/** Ben has just joined the call and Cy has just left it. */
export const ComingAndGoing: Story = {
    args: {
        participants: [
            person("@ada:example.org", "Ada"),
            person("@ben:example.org", "Ben", { transition: "joining" }),
            person("@cy:example.org", "Cy", { transition: "leaving" }),
        ],
    },
};
