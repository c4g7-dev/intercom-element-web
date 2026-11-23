/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";

import DMRoomMap from "../utils/DMRoomMap";

/** Whether a room is a conversation with one person, which the room list shows with that person's face. */
export function isDirectMessage(room: Room): boolean {
    return Boolean(DMRoomMap.shared().getUserIdForRoomId(room.roomId));
}

/** What stands for a text channel in the room list where a conversation has its avatar: a "#". */
export function TextChannelIcon(): JSX.Element {
    return (
        <span className="mx_IntercomChannelIcon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path
                    d="M7.9 3.5 6.4 16.5M13.6 3.5l-1.5 13M3.6 7.4h13.3M3.1 12.6h13.3"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                />
            </svg>
        </span>
    );
}
