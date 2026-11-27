/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";

/** How good the connection to the call is, as the call judges it. */
export type UserPanelConnectionQuality = "good" | "fair" | "poor";

/** What the signal bars show: the quality, or that the connection is being re-established. */
export type SignalLevel = UserPanelConnectionQuality | "reconnecting";

/**
 * The level the bars show. A call that does not tell how good its connection is (not the
 * InterCom build, or one from before) is connected, which is all that is known: all bars.
 */
export function signalLevel(reconnecting: boolean, quality: UserPanelConnectionQuality | undefined): SignalLevel {
    return reconnecting ? "reconnecting" : (quality ?? "good");
}

const LIT: Record<SignalLevel, number> = { good: 3, fair: 2, poor: 1, reconnecting: 1 };

/** Three bars: all of them lit for a good connection, two for a fair one, one for a poor or a lost one. */
export function SignalBars({ level, className }: { level: SignalLevel; className?: string }): JSX.Element {
    return (
        <svg
            className={className}
            width="18"
            height="18"
            viewBox="0 0 18 18"
            aria-hidden="true"
            data-level={level}
            data-lit={LIT[level]}
        >
            {[0, 1, 2].map((bar) => (
                <rect
                    key={bar}
                    x={2 + bar * 5}
                    y={11 - bar * 4}
                    width="3.5"
                    height={5 + bar * 4}
                    rx="1"
                    fill="currentColor"
                    opacity={bar < LIT[level] ? 1 : 0.28}
                />
            ))}
        </svg>
    );
}
