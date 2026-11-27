/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useEffect, useState } from "react";
import { type IntercomAvatarSpec, type RenderIntercomAvatar } from "@element-hq/web-shared-components";

import BaseAvatar from "../components/views/avatars/BaseAvatar";

/** After how long a picture that failed to load is tried again, in ms; the last repeats. */
export const AVATAR_RETRY_DELAYS_MS = [3_000, 10_000, 30_000, 120_000];

/**
 * A number that changes when a picture that failed to load can be had after all: the picture is
 * tried again in the background after {@link AVATAR_RETRY_DELAYS_MS} until it loads. Used as the
 * key of the avatar, which then loads it anew.
 */
function useRecoveryKey(url: string | undefined): number {
    const [key, setKey] = useState(0);
    useEffect(() => {
        if (!url) return;
        let stopped = false;
        let attempt = 0;
        let timer: number | undefined;
        const tryAgain = (): void => {
            const image = new Image();
            image.onload = (): void => {
                if (!stopped) setKey((k) => k + 1);
            };
            image.onerror = (): void => {
                if (stopped) return;
                timer = window.setTimeout(
                    tryAgain,
                    AVATAR_RETRY_DELAYS_MS[Math.min(attempt++, AVATAR_RETRY_DELAYS_MS.length - 1)],
                );
            };
            image.src = url;
        };
        // Only for a picture that failed: the avatar itself loads it first
        const first = new Image();
        first.onerror = (): void => {
            if (!stopped) timer = window.setTimeout(tryAgain, AVATAR_RETRY_DELAYS_MS[attempt++]);
        };
        first.src = url;
        return (): void => {
            stopped = true;
            window.clearTimeout(timer);
            first.onerror = null;
        };
    }, [url]);
    return key;
}

/**
 * An avatar of InterCom's views (the user panel, the people in a voice channel), drawn as Element
 * draws every other avatar: through `BaseAvatar`, from the same URL of the same media helper, which
 * the service worker (web) or the main process (desktop) authenticates. `BaseAvatar` shows the
 * initial while the picture cannot be had and loads it again when the client reconnects; a
 * picture refused once (by an access token about to be renewed, before the network is up) is in
 * addition tried again a little later, so that it does not stay missing until a reconnect.
 */
export function IntercomAvatar({ id, name, url, size }: Readonly<IntercomAvatarSpec>): JSX.Element {
    const recoveryKey = useRecoveryKey(url);
    return <BaseAvatar key={recoveryKey} idName={id} name={name} url={url} size={size} altText="" />;
}

/** Draws the avatars of InterCom's views with {@link IntercomAvatar}. */
export const renderIntercomAvatar: RenderIntercomAvatar = (avatar) => <IntercomAvatar {...avatar} />;
