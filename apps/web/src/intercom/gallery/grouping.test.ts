/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";
import { EventType, MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";

import { findGalleries, GALLERY_MAX_GAP_MS, galleryLayout, isGalleryImage } from "./grouping";

const T0 = new Date(2026, 5, 1, 12, 0, 0).getTime();
let counter = 0;

function image(sender: string, ts: number, content: Record<string, unknown> = {}): MatrixEvent {
    return new MatrixEvent({
        type: EventType.RoomMessage,
        event_id: `$img${counter++}`,
        room_id: "!room:example.org",
        sender,
        origin_server_ts: ts,
        content: { msgtype: MsgType.Image, body: "a.png", url: "mxc://example.org/a", ...content },
    });
}

function text(sender: string, ts: number): MatrixEvent {
    return new MatrixEvent({
        type: EventType.RoomMessage,
        event_id: `$txt${counter++}`,
        room_id: "!room:example.org",
        sender,
        origin_server_ts: ts,
        content: { msgtype: MsgType.Text, body: "hello" },
    });
}

const shown = (events: MatrixEvent[]): { event: MatrixEvent; shouldShow: boolean }[] =>
    events.map((event) => ({ event, shouldShow: true }));

describe("isGalleryImage", () => {
    it("takes plain and encrypted picture messages, and nothing else", () => {
        expect(isGalleryImage(image("@a:x", T0))).toBe(true);
        expect(isGalleryImage(image("@a:x", T0, { url: undefined, file: { url: "mxc://example.org/e" } }))).toBe(true);
        expect(isGalleryImage(text("@a:x", T0))).toBe(false);
        expect(isGalleryImage(image("@a:x", T0, { url: undefined }))).toBe(false);
        expect(isGalleryImage(image("@a:x", T0, { "m.relates_to": { "m.in_reply_to": { event_id: "$other" } } }))).toBe(
            false,
        );
    });
});

describe("findGalleries", () => {
    it("groups pictures in a row from one sender under the first of them", () => {
        const events = [image("@a:x", T0), image("@a:x", T0 + 1000), image("@a:x", T0 + 2000)];
        const galleries = findGalleries(shown(events));
        expect([...galleries.keys()]).toEqual([events[0].getId()]);
        expect(galleries.get(events[0].getId()!)).toEqual(events);
    });

    it("leaves a single picture alone", () => {
        expect(findGalleries(shown([image("@a:x", T0), text("@a:x", T0 + 1000)])).size).toBe(0);
    });

    it("is broken by text, by another sender and by more than two minutes", () => {
        const a = [image("@a:x", T0), image("@a:x", T0 + 1000)];
        const b = [image("@b:x", T0 + 2000), image("@b:x", T0 + 3000)];
        const late = image("@b:x", T0 + 3000 + GALLERY_MAX_GAP_MS + 1);
        const c = [image("@a:x", T0 + 10 * 60_000), image("@a:x", T0 + 10 * 60_000 + 500)];
        const galleries = findGalleries(shown([...a, ...b, late, text("@a:x", T0 + 9 * 60_000), ...c]));
        expect([...galleries.values()]).toEqual([a, b, c]);
    });

    it("looks through events that have no tile, but not through ones that have", () => {
        const first = image("@a:x", T0);
        const second = image("@a:x", T0 + 1000);
        const hidden = { event: text("@a:x", T0 + 500), shouldShow: false };
        expect(
            findGalleries([{ event: first, shouldShow: true }, hidden, { event: second, shouldShow: true }]).size,
        ).toBe(1);
        expect(
            findGalleries([
                { event: first, shouldShow: true },
                { ...hidden, shouldShow: true },
                { event: second, shouldShow: true },
            ]).size,
        ).toBe(0);
    });

    it("lets only the first picture have a caption", () => {
        const captioned = { body: "look at this", filename: "a.png" };
        const first = image("@a:x", T0, captioned);
        const second = image("@a:x", T0 + 1000);
        const third = image("@a:x", T0 + 2000, captioned);
        const fourth = image("@a:x", T0 + 3000);
        const galleries = findGalleries(shown([first, second, third, fourth]));
        expect([...galleries.values()]).toEqual([
            [first, second],
            [third, fourth],
        ]);
    });

    it("keeps an excluded event out, which splits what is around it", () => {
        const events = [image("@a:x", T0), image("@a:x", T0 + 1), image("@a:x", T0 + 2), image("@a:x", T0 + 3)];
        const galleries = findGalleries(shown(events), new Set([events[1].getId()!]));
        expect([...galleries.values()]).toEqual([[events[2], events[3]]]);
    });
});

describe("galleryLayout", () => {
    it("fills rows of three, with what does not fill a row first and larger", () => {
        expect(galleryLayout(2)).toEqual({ visible: 2, spans: [3, 3] });
        expect(galleryLayout(3)).toEqual({ visible: 3, spans: [2, 2, 2] });
        expect(galleryLayout(4)).toEqual({ visible: 4, spans: [3, 3, 3, 3] });
        expect(galleryLayout(5)).toEqual({ visible: 5, spans: [3, 3, 2, 2, 2] });
        expect(galleryLayout(7).spans).toEqual([6, 2, 2, 2, 2, 2, 2]);
    });

    it("shows at most nine and every row adds up to six columns", () => {
        expect(galleryLayout(14).visible).toBe(9);
        for (let count = 1; count <= 12; count++) {
            const { spans } = galleryLayout(count);
            expect(spans.reduce((a, b) => a + b, 0) % 6).toBe(0);
        }
    });
});
