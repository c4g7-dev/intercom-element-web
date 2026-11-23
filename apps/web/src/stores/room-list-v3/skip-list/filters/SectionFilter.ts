/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type Room, KnownMembership } from "matrix-js-sdk/src/matrix";

import { type FilterKey, type MultiKeyFilter } from ".";
import DMRoomMap from "../../../../utils/DMRoomMap";
import { CHATS_TAG, VOICE_TAG } from "../../section";
import { isVideoRoom } from "../../../../utils/video-rooms";
import { DefaultTagID } from "../tag";

/**
 * Works out which section a room belongs to. A room belongs to exactly one section: the Invites
 * section while the invitation is pending, otherwise the section of the first tag it is tagged
 * with, or, when it has none of those tags, the People section if it is a direct message, the
 * Voice section if it is a voice channel (a room that is its call) and the Chats section otherwise.
 *
 * The People section is optional, see the "RoomList.showPeopleSection" setting. When it is absent
 * from the section tags, direct messages go to the Chats section like any other room.
 */
export class SectionFilter implements MultiKeyFilter {
    /**
     * Whether the People section is one of the sections being displayed.
     * Computed once because {@link keyFor} runs for every room.
     */
    private readonly hasPeopleSection: boolean;
    /** Whether the voice channels have a section of their own. */
    private readonly hasVoiceSection: boolean;

    /**
     * @param sectionTags All the section tags, in display order.
     */
    public constructor(private readonly sectionTags: string[]) {
        this.hasPeopleSection = sectionTags.includes(DefaultTagID.DM);
        this.hasVoiceSection = sectionTags.includes(VOICE_TAG);
    }

    public keyFor(room: Room): FilterKey | undefined {
        // The invite tag comes from the membership rather than from account data, so it is not in
        // room.tags. A pending invitation wins over every tag the user applied.
        if (room.getMyMembership() === KnownMembership.Invite) return DefaultTagID.Invite;

        // A tag the user applied wins over being a direct message. A room carrying the invite tag
        // without a pending invitation belongs to no section.
        const tag = this.sectionTags.find((sectionTag) => room.tags[sectionTag]);
        if (tag) return tag === DefaultTagID.Invite ? undefined : tag;

        const isDm = this.hasPeopleSection && !!DMRoomMap.shared().getUserIdForRoomId(room.roomId);
        if (isDm) return DefaultTagID.DM;
        // InterCom: a room that is its call is a voice channel
        return this.hasVoiceSection && isVideoRoom(room) ? VOICE_TAG : CHATS_TAG;
    }
}
