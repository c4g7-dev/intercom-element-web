/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import { fn, userEvent, within } from "storybook/test";

import type { Meta, StoryObj } from "@storybook/react-vite";
import { UserPanelView, type UserPanelViewActions, type UserPanelViewSnapshot } from "./UserPanelView";
import { useMockedViewModel } from "../../core/viewmodel";

type Props = UserPanelViewSnapshot & UserPanelViewActions;

const Wrapper = ({
    onToggleMute,
    onToggleDeafen,
    onOpenSettings,
    onOpenProfile,
    onToggleCamera,
    onToggleScreenShare,
    onOpenShareSettings,
    onLeaveCall,
    onStayInCall,
    onJumpToCall,
    onConnectionDetails,
    onOpenDiagnostics,
    width = 300,
    ...rest
}: Props & { width?: number }): JSX.Element => {
    const vm = useMockedViewModel(rest, {
        onToggleMute,
        onToggleDeafen,
        onOpenSettings,
        onOpenProfile,
        onToggleCamera,
        onToggleScreenShare,
        onOpenShareSettings,
        onLeaveCall,
        onStayInCall,
        onJumpToCall,
        onConnectionDetails,
        onOpenDiagnostics,
    });
    return (
        <div style={{ width }}>
            {/* A clock that stands still, so that a countdown looks the same every time it is drawn */}
            <UserPanelView vm={vm} now={storyNow} />
        </div>
    );
};

const STORY_TIME = 1_800_000_000_000;
const storyNow = (): number => STORY_TIME;

const call = {
    roomName: "Lounge",
    reconnecting: false,
    cameraOn: false,
    screenSharing: false,
    canShareScreen: true,
    controllable: true,
};

const meta = {
    title: "InterCom/UserPanelView",
    component: Wrapper,
    tags: ["autodocs"],
    args: {
        userId: "@ada:example.org",
        displayName: "Ada",
        presence: "online",
        muted: false,
        deafened: false,
        onToggleMute: fn(),
        onToggleDeafen: fn(),
        onOpenSettings: fn(),
        onOpenProfile: fn(),
        onToggleCamera: fn(),
        onToggleScreenShare: fn(),
        onOpenShareSettings: fn(),
        onLeaveCall: fn(),
        onStayInCall: fn(),
        onJumpToCall: fn(),
        onConnectionDetails: fn(),
        onOpenDiagnostics: fn(),
    },
} satisfies Meta<typeof Wrapper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InCall: Story = { args: { call } };

export const MutedAndSharing: Story = {
    args: { muted: true, deafened: true, call: { ...call, cameraOn: true, screenSharing: true } },
};

export const Reconnecting: Story = { args: { call: { ...call, reconnecting: true } } };

export const CallOfAnotherApp: Story = { args: { call: { ...call, controllable: false } } };

/** Muted by the user: the struck-through microphone, in red. */
export const Muted: Story = { args: { muted: true } };

/** No microphone to turn on: its own icon with a badge, and a button that says why and does nothing. */
export const NoMicrophone: Story = { args: { micUnavailable: "no-device" } };

export const MicrophoneBlocked: Story = { args: { micUnavailable: "no-permission" } };

/** In a call with neither a microphone nor a camera, as on a machine with no devices. */
export const InCallWithoutDevices: Story = {
    args: { micUnavailable: "no-device", call: { ...call, cameraUnavailable: "no-device" } },
};

export const InCallDevicesBlocked: Story = {
    args: { micUnavailable: "no-permission", call: { ...call, cameraUnavailable: "no-permission" } },
};

export const InCallCameraOn: Story = { args: { call: { ...call, cameraOn: true } } };

/** Where no screen can be captured, the share button says so and does nothing. */
export const InCallCannotShare: Story = { args: { call: { ...call, canShareScreen: false } } };

/** A minute of round-trip times around a value, the same every time it is drawn. */
const pings = (around: number, swing: number, spikes: Record<number, number> = {}): number[] =>
    Array.from(
        { length: 60 },
        (_, second) => spikes[second] ?? Math.round(around + swing * Math.sin(second / 2.3) * Math.cos(second / 7)),
    );

const goodPings = pings(31, 5, { 21: 58, 22: 44 });
const poorPings = pings(240, 60, { 12: 420, 13: 390, 40: 510, 41: 470, 42: 380 });
const mean = (values: number[]): number => Math.round(values.reduce((a, b) => a + b, 0) / values.length);

const openConnection: Story["play"] = async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByTestId("intercom-connection-trigger"));
};

/** The signal bars of a fair connection: two of them, amber. */
export const InCallFairConnection: Story = { args: { call: { ...call, quality: "fair" } } };

/** The details of a good connection, opened from the signal bars, while sharing a screen. */
export const ConnectionGood: Story = {
    args: {
        call: {
            ...call,
            screenSharing: true,
            quality: "good",
            connection: {
                pingMs: goodPings[59],
                averagePingMs: mean(goodPings),
                pingHistory: goodPings,
                lossOutPct: 0,
                lossInPct: 0.2,
                jitterMs: 4,
                server: "sfu.example.org",
                transport: "udp",
                encrypted: true,
                audio: { codec: "opus", bitrate: 32_000 },
                share: { width: 2560, height: 1440, fps: 30, bitrate: 3_200_000 },
            },
        },
    },
    play: openConnection,
};

/** A poor connection: one red bar, and what is wrong with it. */
export const ConnectionPoor: Story = {
    args: {
        call: {
            ...call,
            quality: "poor",
            connection: {
                pingMs: poorPings[59],
                averagePingMs: mean(poorPings),
                // The call joined half a minute ago
                pingHistory: poorPings.map((value, second) => (second < 8 ? null : value)),
                lossOutPct: 7.4,
                lossInPct: 12.1,
                jitterMs: 46,
                server: "a-media-server-with-a-long-name.eu-central.example.org",
                transport: "turn-tls",
                encrypted: false,
                audio: { codec: "opus", bitrate: 18_000 },
            },
        },
    },
    play: openConnection,
};

/** A call that tells nothing of its connection (not the InterCom build, or one from before). */
export const ConnectionWithoutDetails: Story = { args: { call }, play: openConnection };

/**
 * Left alone in a private call: the strip counts down to when the call leaves by itself, and
 * offers to stay (the countdown starts over) or to leave now.
 */
export const AloneInCall: Story = {
    args: { width: 360, call: { ...call, roomName: "Ben", quality: "good", aloneDeadline: STORY_TIME + 299_000 } },
};

/** The same in a narrow room list: the time alone, with the two buttons. */
export const AloneInCallNarrow: Story = {
    args: {
        width: 220,
        call: { ...call, roomName: "Ben", quality: "good", aloneDeadline: STORY_TIME + 42_000 },
    },
};
