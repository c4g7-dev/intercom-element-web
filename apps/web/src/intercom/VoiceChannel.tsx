/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { useCreateAutoDisposedViewModel, VoiceParticipantsView } from "@element-hq/web-shared-components";
import VolumeOnSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/volume-on-solid";

import { VoiceChannelViewModel } from "../viewmodels/intercom/VoiceChannelViewModel";
import { isVideoRoom } from "../utils/video-rooms";
import { renderIntercomAvatar } from "./Avatar";

/** Whether a room is a voice channel: a room that is its call (a video room or a call room). */
export function isVoiceChannel(room: Room): boolean {
    return isVideoRoom(room);
}

/** The people in a voice channel's call, for the room list: shown under the room. */
export function VoiceChannelParticipants({ room }: { room: Room }): JSX.Element {
    const vm = useCreateAutoDisposedViewModel(
        () => new VoiceChannelViewModel({ room, userId: room.client.getSafeUserId() }),
    );
    return <VoiceParticipantsView vm={vm} renderAvatar={renderIntercomAvatar} />;
}

/** What stands for a voice channel in the room list where other rooms have their avatar. */
export function VoiceChannelIcon(): JSX.Element {
    return (
        <span className="mx_IntercomVoiceChannelIcon" aria-hidden="true">
            <VolumeOnSolidIcon width="20px" height="20px" />
        </span>
    );
}
