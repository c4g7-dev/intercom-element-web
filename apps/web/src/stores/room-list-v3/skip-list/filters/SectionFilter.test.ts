/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnownMembership } from "matrix-js-sdk/src/types";
import { type Room } from "matrix-js-sdk/src/matrix";

import { SectionFilter } from "./SectionFilter";
import { CHATS_TAG, VOICE_TAG } from "../../section";
import { DefaultTagID } from "../tag";
import DMRoomMap from "../../../../utils/DMRoomMap";

const CUSTOM = "element.io.section.work";
const WITH_VOICE = [
    DefaultTagID.Invite,
    DefaultTagID.Favourite,
    DefaultTagID.DM,
    CUSTOM,
    CHATS_TAG,
    VOICE_TAG,
    DefaultTagID.LowPriority,
];

function room(
    opts: { voice?: "call" | "video"; dm?: boolean; tags?: string[]; membership?: string } = {},
): Room & { isDm: boolean } {
    return {
        roomId: "!room:x",
        isDm: opts.dm === true,
        tags: Object.fromEntries((opts.tags ?? []).map((tag) => [tag, {}])),
        getMyMembership: () => opts.membership ?? KnownMembership.Join,
        isCallRoom: () => opts.voice === "call",
        isElementVideoRoom: () => opts.voice === "video",
    } as unknown as Room & { isDm: boolean };
}

describe("SectionFilter", () => {
    let current: { isDm: boolean };

    beforeEach(() => {
        vi.spyOn(DMRoomMap, "shared").mockReturnValue({
            getUserIdForRoomId: () => (current.isDm ? "@ben:x" : undefined),
        } as unknown as DMRoomMap);
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const keyFor = (filter: SectionFilter, r: Room & { isDm: boolean }): string | undefined => {
        current = r;
        return filter.keyFor(r);
    };

    it("puts a room that is its call among the voice channels, and other rooms among the text ones", () => {
        const filter = new SectionFilter(WITH_VOICE);
        expect(keyFor(filter, room({ voice: "call" }))).toBe(VOICE_TAG);
        expect(keyFor(filter, room({ voice: "video" }))).toBe(VOICE_TAG);
        expect(keyFor(filter, room())).toBe(CHATS_TAG);
    });

    it("lets an invitation, a tag of the user's and being a direct message come first", () => {
        const filter = new SectionFilter(WITH_VOICE);
        expect(keyFor(filter, room({ voice: "call", membership: KnownMembership.Invite }))).toBe(DefaultTagID.Invite);
        expect(keyFor(filter, room({ voice: "call", tags: [DefaultTagID.Favourite] }))).toBe(DefaultTagID.Favourite);
        expect(keyFor(filter, room({ voice: "call", tags: [CUSTOM] }))).toBe(CUSTOM);
        expect(keyFor(filter, room({ voice: "call", tags: [DefaultTagID.LowPriority] }))).toBe(
            DefaultTagID.LowPriority,
        );
        expect(keyFor(filter, room({ voice: "call", dm: true }))).toBe(DefaultTagID.DM);
    });

    it("keeps voice channels with the other rooms where there is no voice section", () => {
        const filter = new SectionFilter(WITH_VOICE.filter((tag) => tag !== VOICE_TAG));
        expect(keyFor(filter, room({ voice: "call" }))).toBe(CHATS_TAG);
    });
});
