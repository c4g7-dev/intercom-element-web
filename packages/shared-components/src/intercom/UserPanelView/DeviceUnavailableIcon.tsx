/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type ComponentType, type JSX, type SVGAttributes, useId } from "react";
import MicOnSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/mic-on-solid";
import VideoCallSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call-solid";

/**
 * A device's own icon with a "no entry" badge at its corner: a device that is not there to be
 * turned on, which is not the same as one that is muted (the struck-through icon).
 */
function withUnavailableBadge(
    Icon: ComponentType<SVGAttributes<SVGElement>>,
): (props: SVGAttributes<SVGElement>) => JSX.Element {
    return function DeviceUnavailableIcon(props): JSX.Element {
        // An ID that is safe inside url(): the one React gives has punctuation
        const maskId = `unavailable${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
        return (
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="1em"
                height="1em"
                viewBox="0 0 24 24"
                fill="currentColor"
                data-unavailable-badge
                {...props}
            >
                <mask id={maskId}>
                    <rect width="24" height="24" fill="#fff" />
                    <circle cx="18.5" cy="18.5" r="6.25" fill="#000" />
                </mask>
                <g mask={`url(#${maskId})`}>
                    <Icon width="24" height="24" />
                </g>
                <circle cx="18.5" cy="18.5" r="5" fill="var(--cpd-color-icon-critical-primary)" />
                <rect x="15.5" y="17.5" width="6" height="2" rx="1" fill="var(--cpd-color-icon-on-solid-primary)" />
            </svg>
        );
    };
}

export const MicUnavailableIcon = withUnavailableBadge(MicOnSolidIcon);
export const VideoUnavailableIcon = withUnavailableBadge(VideoCallSolidIcon);
