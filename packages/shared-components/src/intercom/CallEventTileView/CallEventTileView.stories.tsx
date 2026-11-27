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
    CallEventTileView,
    type CallEventTileViewActions,
    type CallEventTileViewSnapshot,
    type CallTilePerson,
} from "./CallEventTileView";
import { useMockedViewModel } from "../../core/viewmodel";

type Props = Omit<CallEventTileViewSnapshot, "startedAt"> &
    CallEventTileViewActions & {
        /** For how long the call has been running, in seconds: the story counts on from there */
        runningForSeconds?: number;
    };

const Wrapper = ({ onButton, runningForSeconds, ...rest }: Props): JSX.Element => {
    const [shownAt] = React.useState(() => Date.now());
    const startedAt = runningForSeconds === undefined ? undefined : shownAt - runningForSeconds * 1000;
    const vm = useMockedViewModel({ ...rest, startedAt }, { onButton });
    return (
        <div style={{ width: 660 }}>
            <CallEventTileView vm={vm} />
        </div>
    );
};

const person = (name: string): CallTilePerson => ({
    id: `@${name.split(" ")[0].toLowerCase()}:example.org`,
    name,
});
const ada = person("Ada");
const ben = person("Ben");
const cy = person("Cy");
const dee = person("Dee Marlow");
const finn = person("Finn");
const gus = person("Gus");

const meta = {
    title: "InterCom/CallEventTileView",
    component: Wrapper,
    tags: ["autodocs"],
    args: {
        state: "ongoing",
        video: false,
        outgoing: false,
        startedByName: "Ada",
        time: "21:21",
        participants: [ada, ben],
        runningForSeconds: 6,
        joined: false,
        buttons: ["join"],
        onButton: fn(),
    },
} satisfies Meta<typeof Wrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A running call with two people in it, which the user can join. */
export const Ongoing: Story = {};

/** A running call with more people than get an avatar: four are shown, the rest counted. */
export const OngoingSixPeople: Story = {
    args: {
        startedByName: "Dee Marlow",
        participants: [dee, ada, ben, cy, finn, gus],
        runningForSeconds: 4 * 60 + 12,
    },
};

/** A running call the user is in: it says so, and offers to leave. */
export const OngoingJoined: Story = {
    args: {
        participants: [ada, ben, cy],
        runningForSeconds: 72 * 60 + 3,
        joined: true,
        buttons: ["leave"],
    },
};

/** A call that rings and nobody has answered yet. */
export const Ringing: Story = {
    args: {
        state: "ringing",
        startedByName: "Ben",
        participants: [],
        runningForSeconds: undefined,
        buttons: ["decline", "accept"],
    },
};

/** A call that is over, with how long it took. */
export const Ended: Story = {
    args: { state: "ended", participants: [], runningForSeconds: undefined, durationMs: 6_000, buttons: [] },
};

/** A call that was not answered. */
export const Missed: Story = {
    args: {
        state: "missed",
        startedByName: "Finn",
        participants: [],
        runningForSeconds: undefined,
        buttons: ["call_back"],
    },
};

/** A call that was turned down. */
export const Declined: Story = {
    args: { state: "declined", startedByName: "Cy", participants: [], runningForSeconds: undefined, buttons: [] },
};

/** A video call: the camera instead of the phone. */
export const OngoingVideo: Story = { args: { video: true, outgoing: true, participants: [ada] } };
