/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { EventStatus, EventType, MatrixEvent, MsgType } from "matrix-js-sdk/src/matrix";
import { decryptExistingEvent, mkDecryptionFailureMatrixEvent } from "matrix-js-sdk/src/testing";
import { DecryptionFailureCode } from "matrix-js-sdk/src/crypto-api";

import {
    analyseGalleries,
    findGalleries,
    logGalleryDecisions,
    GALLERY_BATCH_FIELD,
    GALLERY_MAX_GAP_MS,
    galleryBatchId,
    galleryLayout,
    isGalleryImage,
} from "./grouping";

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

describe("findGalleries with events as an encrypted room has them", () => {
    const file = { url: "mxc://example.org/e", key: {}, iv: "iv", hashes: {}, v: "v2" };
    const plain = (name: string): Record<string, unknown> => ({
        msgtype: MsgType.Image,
        body: name,
        file,
        info: { mimetype: "image/png", size: 279490, w: 1600, h: 900 },
    });

    /** An event as /sync delivers it in an encrypted room: not decrypted yet. */
    function undecrypted(sender: string, ts: number): MatrixEvent {
        return new MatrixEvent({
            type: EventType.RoomMessageEncrypted,
            event_id: `$enc${counter++}`,
            room_id: "!room:example.org",
            sender,
            origin_server_ts: ts,
            content: { algorithm: "m.megolm.v1.aes-sha2", ciphertext: "AwgA", session_id: "s", device_id: "D" },
        });
    }

    it("groups pictures once they are decrypted, and not before", async () => {
        const events = [undecrypted("@a:x", T0), undecrypted("@a:x", T0 + 1000), undecrypted("@a:x", T0 + 2000)];
        expect(events.some(isGalleryImage)).toBe(false);
        expect(findGalleries(shown(events)).size).toBe(0);

        // Decrypted one after the other, as the Decrypted events arrive: every pass sees more
        await decryptExistingEvent(events[0], { plainType: EventType.RoomMessage, plainContent: plain("01.png") });
        await decryptExistingEvent(events[1], { plainType: EventType.RoomMessage, plainContent: plain("02.png") });
        expect([...findGalleries(shown(events)).values()]).toEqual([[events[0], events[1]]]);
        await decryptExistingEvent(events[2], { plainType: EventType.RoomMessage, plainContent: plain("03.png") });
        expect([...findGalleries(shown(events)).values()]).toEqual([events]);
    });

    it("leaves a picture that cannot be decrypted out", async () => {
        const first = undecrypted("@a:x", T0);
        const second = undecrypted("@a:x", T0 + 1000);
        await decryptExistingEvent(first, { plainType: EventType.RoomMessage, plainContent: plain("01.png") });
        await decryptExistingEvent(second, { plainType: EventType.RoomMessage, plainContent: plain("02.png") });
        const failed = await mkDecryptionFailureMatrixEvent({
            code: DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID,
            msg: "no key",
            roomId: "!room:example.org",
            sender: "@a:x",
        });
        expect(findGalleries(shown([first, failed, second])).size).toBe(0);
    });

    it("groups local echoes: encrypted for sending, with and without having been sent", () => {
        const echo = (i: number, status: EventStatus | null): MatrixEvent => {
            const event = new MatrixEvent({
                type: EventType.RoomMessage,
                event_id: `~!room:example.org:m${counter++}.${i}`,
                room_id: "!room:example.org",
                sender: "@a:x",
                origin_server_ts: T0 + i * 1000,
                content: plain(`0${i}-alle-funktionen.png`),
            });
            // What the client does to an event it sends into an encrypted room
            event.makeEncrypted(
                EventType.RoomMessageEncrypted,
                { algorithm: "m.megolm.v1.aes-sha2", ciphertext: "AwgA" },
                "curve",
                "ed",
            );
            event.setStatus(status);
            return event;
        };
        const events = [
            echo(1, null),
            echo(2, EventStatus.SENT),
            echo(3, EventStatus.SENDING),
            echo(4, EventStatus.ENCRYPTING),
        ];
        expect(events.every(isGalleryImage)).toBe(true);
        expect([...findGalleries(shown(events)).values()]).toEqual([events]);

        // The echo of the server arrives: the same event, with the ID and the content of the server
        events[2].handleRemoteEcho({
            type: EventType.RoomMessageEncrypted,
            event_id: "$fromserver",
            room_id: "!room:example.org",
            sender: "@a:x",
            origin_server_ts: T0 + 3500,
            content: { algorithm: "m.megolm.v1.aes-sha2", ciphertext: "AwgA" },
        });
        expect([...findGalleries(shown(events)).values()]).toEqual([events]);
    });
});

describe("pictures of one batch", () => {
    const batch = (index: number): Record<string, unknown> => ({
        [GALLERY_BATCH_FIELD]: { id: "batch1", index, count: 3 },
    });

    it("are one gallery however long their uploads took", () => {
        const slow = GALLERY_MAX_GAP_MS * 3;
        const events = [
            image("@a:x", T0, batch(0)),
            image("@a:x", T0 + slow, batch(1)),
            image("@a:x", T0 + 2 * slow, batch(2)),
        ];
        expect(galleryBatchId(events[0])).toBe("batch1");
        expect([...findGalleries(shown(events)).values()]).toEqual([events]);
        // Without the mark the same pictures are too far apart
        const unmarked = [image("@a:x", T0), image("@a:x", T0 + slow)];
        expect(findGalleries(shown(unmarked)).size).toBe(0);
    });

    it("are still parted by a message between them and by another sender", () => {
        const first = image("@a:x", T0, batch(0));
        const second = image("@a:x", T0 + 1000, batch(1));
        expect(findGalleries(shown([first, text("@a:x", T0 + 500), second])).size).toBe(0);
        expect(findGalleries(shown([first, image("@b:x", T0 + 1000, batch(1))])).size).toBe(0);
    });

    it("takes no mark that is not a string", () => {
        expect(galleryBatchId(image("@a:x", T0, { [GALLERY_BATCH_FIELD]: { id: 7 } }))).toBeUndefined();
        expect(galleryBatchId(image("@a:x", T0, { [GALLERY_BATCH_FIELD]: "x" }))).toBeUndefined();
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

describe("pictures sent while a call is on, with what a real room has around them", () => {
    const state = (type: string, sender: string, ts: number, content: Record<string, unknown> = {}): MatrixEvent =>
        new MatrixEvent({
            type,
            state_key: `_${sender}_DEVICE_m.call`,
            event_id: `$state${counter++}`,
            room_id: "!room:example.org",
            sender,
            origin_server_ts: ts,
            content,
        });
    const message = (type: string, sender: string, ts: number, content: Record<string, unknown> = {}): MatrixEvent =>
        new MatrixEvent({
            type,
            event_id: `$other${counter++}`,
            room_id: "!room:example.org",
            sender,
            origin_server_ts: ts,
            content,
        });
    const batch = (index: number): Record<string, unknown> => ({
        [GALLERY_BATCH_FIELD]: { id: "batch1", index, count: 4 },
        "m.mentions": {},
        "info": { mimetype: "image/png", size: 1656715, w: 2560, h: 1440 },
        "url": undefined,
        "file": { url: "mxc://example.org/enc", v: "v2" },
    });
    const pictures = (): MatrixEvent[] => [0, 1, 2, 3].map((i) => image("@a:x", T0 + i * 250, batch(i)));
    const ids = (events: MatrixEvent[]): string[] => events.map((ev) => ev.getId()!);

    /** What has no tile in a room: memberships of the call, its keys, reactions, edits, receipts of a call */
    const untiled = (ts: number): MatrixEvent[] => [
        state("org.matrix.msc3401.call.member", "@a:x", ts, { application: "m.call", device_id: "DEVICE" }),
        state("org.matrix.msc3401.call.member", "@b:x", ts, {}),
        message("org.matrix.msc4143.rtc.member", "@b:x", ts, { application: { type: "m.call" } }),
        message("io.element.call.encryption_keys", "@b:x", ts, { keys: [] }),
        message("m.reaction", "@b:x", ts, { "m.relates_to": { rel_type: "m.annotation", event_id: "$x", key: "+" } }),
        message("m.room.redaction", "@b:x", ts, {}),
        message(EventType.RoomMessage, "@b:x", ts, {
            "msgtype": MsgType.Text,
            "body": "* edited",
            "m.new_content": { msgtype: MsgType.Text, body: "edited" },
            "m.relates_to": { rel_type: "m.replace", event_id: "$x" },
        }),
    ];

    it("groups them with the call's events between every two of them", () => {
        const [a, b, c, d] = pictures();
        const timeline = [
            { event: a, shouldShow: true },
            ...untiled(T0 + 100).map((event) => ({ event, shouldShow: false })),
            { event: b, shouldShow: true },
            ...untiled(T0 + 300).map((event) => ({ event, shouldShow: false })),
            { event: c, shouldShow: true },
            ...untiled(T0 + 600).map((event) => ({ event, shouldShow: false })),
            { event: d, shouldShow: true },
        ];
        expect([...findGalleries(timeline).values()].map(ids)).toEqual([ids([a, b, c, d])]);
    });

    it("groups them with hidden events shown, when those are all that lies between", () => {
        const [a, b, c, d] = pictures();
        const timeline = [
            { event: a, shouldShow: true },
            ...untiled(T0 + 100).map((event) => ({ event, shouldShow: true, hiddenByDefault: true })),
            { event: b, shouldShow: true },
            { event: c, shouldShow: true },
            ...untiled(T0 + 600).map((event) => ({ event, shouldShow: true, hiddenByDefault: true })),
            { event: d, shouldShow: true },
        ];
        expect([...findGalleries(timeline).values()].map(ids)).toEqual([ids([a, b, c, d])]);
    });

    it("is still parted by what has a tile whatever the options: a message, a call's start", () => {
        const [a, b, c, d] = pictures();
        const ring = message("org.matrix.msc4075.rtc.notification", "@b:x", T0 + 300, { notification_type: "ring" });
        const timeline = [
            { event: a, shouldShow: true },
            { event: b, shouldShow: true },
            { event: ring, shouldShow: true, hiddenByDefault: false },
            { event: c, shouldShow: true },
            { event: d, shouldShow: true },
        ];
        expect([...findGalleries(timeline).values()].map(ids)).toEqual([ids([a, b]), ids([c, d])]);
    });

    it("takes a caption on the first picture (MSC2530: a body beside another file name)", () => {
        const [a, b, c] = pictures();
        const first = image("@a:x", T0 - 250, { ...batch(0), body: "Look at these", filename: "a.png" });
        expect([...findGalleries(shown([first, a, b, c])).values()].map(ids)).toEqual([ids([first, a, b, c])]);
        // A file name that is the body is no caption
        const named = image("@a:x", T0 + 2000, { ...batch(3), body: "a.png", filename: "a.png" });
        expect([...findGalleries(shown([a, b, named])).values()].map(ids)).toEqual([ids([a, b, named])]);
    });

    it("takes pictures as other clients send them: no mark, a file name, mentions", () => {
        const plain = [0, 1, 2].map((i) =>
            image("@b:x", T0 + i * 900, {
                "body": `IMG_${i}.jpg`,
                "filename": `IMG_${i}.jpg`,
                "m.mentions": {},
                "info": { "mimetype": "image/jpeg", "xyz.amorgan.blurhash": "L00000", "thumbnail_info": {} },
            }),
        );
        expect([...findGalleries(shown(plain)).values()].map(ids)).toEqual([ids(plain)]);
    });

    describe("in the diagnostics log", () => {
        let log: MockInstance<typeof console.log>;
        const records = (): Record<string, any>[] =>
            log.mock.calls
                .map(([line]) => String(line))
                .filter((line) => line.startsWith("[intercom-diag] "))
                .map((line) => JSON.parse(line.slice("[intercom-diag] ".length)));
        beforeEach(() => {
            log = vi.spyOn(console, "log").mockImplementation(() => {});
        });
        afterEach(() => {
            log.mockRestore();
        });

        it("says of every picture of a run whether it joined, and why not", () => {
            const [a, b, c, d] = pictures();
            const words = text("@a:x", T0 + 600);
            const other = image("@b:x", T0 + 1200, { body: "secret-name.png" });
            const timeline = [
                { event: a, shouldShow: true },
                ...untiled(T0 + 100).map((event) => ({ event, shouldShow: false })),
                { event: b, shouldShow: true },
                { event: words, shouldShow: true },
                { event: c, shouldShow: true },
                { event: d, shouldShow: true },
                { event: other, shouldShow: true },
            ];
            const { decisions, decisionKeys } = analyseGalleries(timeline);
            expect(decisions).toHaveLength(1);
            expect(decisions[0].pictures).toBe(5);
            expect(decisions[0].galleries).toEqual([2, 2]);
            expect(decisions[0].items.map((item) => item.outcome)).toEqual([
                "first",
                "joined",
                "tile_between",
                "joined",
                "sender",
            ]);
            expect(decisions[0].items[1]).toMatchObject({
                sender: 0,
                gapMs: 250,
                batch: 0,
                batchIndex: 1,
                batchCount: 4,
                caption: false,
                hasFilename: false,
                mimetype: "image/png",
                thread: false,
                shown: true,
            });
            expect(decisions[0].items[1].between).toContain("org.matrix.msc3401.call.member:no_tile,state");
            expect(decisions[0].items[1].between).toContain("m.room.message/m.text:no_tile");
            expect(decisions[0].items[2].between).toEqual(["m.room.message/m.text:tile"]);
            expect(decisions[0].items[4]).toMatchObject({ sender: 1, batch: undefined });

            logGalleryDecisions(decisions, decisionKeys, { layout: "group", timeline: "Room", hiddenShown: false });
            expect(records()).toHaveLength(1);
            expect(records()[0]).toMatchObject({ type: "gallery_decision", layout: "group", pictures: 5 });
            // Nothing that says who, what or where
            const written = JSON.stringify(records());
            for (const secret of ["secret-name", "a.png", "mxc://", "@a:x", "@b:x", "$img", "batch1", "hello"]) {
                expect(written).not.toContain(secret);
            }

            // The same decision again is not written again; a changed one is
            logGalleryDecisions(decisions, decisionKeys, { layout: "group", timeline: "Room", hiddenShown: false });
            expect(records()).toHaveLength(1);
            const again = analyseGalleries(timeline.filter((entry) => entry.event !== words));
            logGalleryDecisions(again.decisions, again.decisionKeys, { layout: "group" });
            expect(records()).toHaveLength(2);
            expect(records()[1].galleries).toEqual([4]);
        });

        it("names what kept a picture out: a reply, a caption, an event that cannot be read", () => {
            const [a, b] = pictures();
            const reply = image("@a:x", T0 + 600, { "m.relates_to": { "m.in_reply_to": { event_id: "$x" } } });
            const captioned = image("@a:x", T0 + 900, { body: "words", filename: "a.png" });
            const { decisions } = analyseGalleries(shown([a, b, reply, captioned]));
            expect(decisions[0].items.map((item) => item.outcome)).toEqual(["first", "joined", "reply", "reply"]);
            expect(decisions[0].items[2].relation).toBe("reply");
            expect(decisions[0].items[3].caption).toBe(true);

            const { decisions: two } = analyseGalleries(shown([a, b, captioned]));
            expect(two[0].items.map((item) => item.outcome)).toEqual(["first", "joined", "caption"]);
        });

        it("writes nothing for a picture on its own", () => {
            const { decisions } = analyseGalleries(shown([image("@a:x", T0), text("@a:x", T0 + 10)]));
            expect(decisions).toEqual([]);
        });
    });
});
