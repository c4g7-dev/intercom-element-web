/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, type ReactNode, useState } from "react";
import { Avatar } from "@vector-im/compound-web";

/** What one of InterCom's avatars is drawn from. */
export interface IntercomAvatarSpec {
    /** The user's ID, which also picks the colour behind the initial */
    id: string;
    /** The name, whose first letter stands in for a missing picture */
    name: string;
    /** HTTP URL of the picture, if there is one */
    url?: string;
    /** Width and height, as CSS */
    size: string;
}

/**
 * Draws an avatar for the InterCom views. The app passes its own (Element's `BaseAvatar`), which
 * loads the picture the way every other avatar of the app does: it shows the initial when the
 * picture cannot be had (authenticated media refused, no connection yet) and tries again when the
 * client reconnects. Without one, {@link FallbackAvatar} is drawn.
 */
export type RenderIntercomAvatar = (avatar: IntercomAvatarSpec) => ReactNode;

/**
 * Compound's avatar, showing the initial instead of a broken picture when the picture fails to
 * load. A new URL is tried again. The fallback of the InterCom views when the app passes no
 * {@link RenderIntercomAvatar}.
 */
export function FallbackAvatar({ id, name, url, size }: Readonly<IntercomAvatarSpec>): JSX.Element {
    const [failedUrl, setFailedUrl] = useState<string | undefined>(undefined);
    return (
        <Avatar
            id={id}
            name={name}
            src={url && url !== failedUrl ? url : undefined}
            size={size}
            onError={() => setFailedUrl(url)}
        />
    );
}

/** Draws `avatar` with `render` if there is one, else with {@link FallbackAvatar}. */
export function renderIntercomAvatar(avatar: IntercomAvatarSpec, render?: RenderIntercomAvatar): ReactNode {
    return render ? render(avatar) : <FallbackAvatar {...avatar} />;
}
