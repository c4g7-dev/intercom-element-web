/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    EventStatus,
    EventType,
    MatrixEvent,
    MatrixEventEvent,
    MsgType,
    PendingEventOrdering,
    RelationType,
    Room,
    type MatrixClient,
} from "matrix-js-sdk/src/matrix";
import { type TimelineItem } from "@element-hq/web-shared-components";
import { createTestClient } from "test-utils";

import SettingsStore from "../../../settings/SettingsStore";
import { RoomTimelineViewModel } from "./RoomTimelineViewModel";
import { GALLERY_BATCH_FIELD } from "../../../intercom/gallery/grouping";
import { galleryOfItem } from "../../../intercom/gallery/timelineItem";

vi.mock("../../../settings/SettingsStore");

const ROOM_ID = "!dm:example.org";
const USER_ID = "@alice:example.org";
const OTHER_USER_ID = "@bob:example.org";
const T0 = new Date(2026, 10, 24, 14, 19, 0).getTime();

/**
 * The room timeline the new timeline (labs "feature_new_timeline") draws: pictures sent together
 * are one row, as in the old one. These events have the shape of what the composer's attachment
 * tray sends into an encrypted conversation.
 */
describe("RoomTimelineViewModel galleries", () => {
    let client: MatrixClient;
    let room: Room;
    let vms: RoomTimelineViewModel[];
    let showHidden: boolean;
    let counter: number;

    /** A picture as InterCom sends it into an encrypted room: `file`, a file name equal to the body, the batch mark. */
    const picture = (
        id: string,
        opts: { ts?: number; index?: number; count?: number; batch?: string; user?: string } = {},
    ): MatrixEvent =>
        new MatrixEvent({
            type: EventType.RoomMessage,
            event_id: id,
            room_id: ROOM_ID,
            sender: opts.user ?? USER_ID,
            origin_server_ts: opts.ts ?? T0 + counter++ * 700,
            content: {
                "msgtype": MsgType.Image,
                "body": `Screenshot ${id}.png`,
                "filename": `Screenshot ${id}.png`,
                "file": {
                    v: "v2",
                    url: `mxc://example.org/${id.slice(1)}`,
                    key: { kty: "oct", alg: "A256CTR", ext: true, k: "k", key_ops: ["encrypt", "decrypt"] },
                    iv: "iv",
                    hashes: { sha256: "h" },
                },
                "info": {
                    "mimetype": "image/png",
                    "w": 1920,
                    "h": 1080,
                    "size": 1694577,
                    "xyz.amorgan.blurhash": "L00000",
                },
                "m.mentions": {},
                ...(opts.batch !== undefined
                    ? { [GALLERY_BATCH_FIELD]: { id: opts.batch, index: opts.index ?? 0, count: opts.count ?? 6 } }
                    : {}),
            },
        });

    const callMember = (id: string, ts: number): MatrixEvent =>
        new MatrixEvent({
            type: "org.matrix.msc3401.call.member",
            state_key: `_${USER_ID}_DEVICE_m.call`,
            event_id: id,
            room_id: ROOM_ID,
            sender: USER_ID,
            origin_server_ts: ts,
            content: {},
        });

    const reaction = (id: string, target: string, ts: number): MatrixEvent =>
        new MatrixEvent({
            type: EventType.Reaction,
            event_id: id,
            room_id: ROOM_ID,
            sender: OTHER_USER_ID,
            origin_server_ts: ts,
            content: { "m.relates_to": { rel_type: RelationType.Annotation, event_id: target, key: "👍" } },
        });

    const text = (id: string, ts: number, user = USER_ID): MatrixEvent =>
        new MatrixEvent({
            type: EventType.RoomMessage,
            event_id: id,
            room_id: ROOM_ID,
            sender: user,
            origin_server_ts: ts,
            content: { msgtype: MsgType.Text, body: "hello" },
        });

    /** Marks an event as one that came encrypted and has not decrypted yet; `decrypt()` decrypts it. */
    const stillEncrypted = (event: MatrixEvent): (() => void) => {
        let decrypted = false;
        vi.spyOn(event, "getWireType").mockReturnValue(EventType.RoomMessageEncrypted);
        vi.spyOn(event, "isEncrypted").mockReturnValue(true);
        vi.spyOn(event, "isDecryptionFailure").mockReturnValue(false);
        const content = event.getContent();
        vi.spyOn(event, "getClearContent").mockImplementation(() => (decrypted ? content : null) as any);
        return () => {
            decrypted = true;
            client.emit(MatrixEventEvent.Decrypted, event);
        };
    };

    const seedTimeline = (events: MatrixEvent[]): void => {
        const timelineSet = room.getUnfilteredTimelineSet();
        for (const event of events) timelineSet.addLiveEvent(event, { addToState: false });
    };

    const createStartedViewModel = async (initialEventId?: string): Promise<RoomTimelineViewModel> => {
        const vm = new RoomTimelineViewModel({ client, room, initialEventId });
        vms.push(vm);
        vm.start();
        await vi.waitFor(() => expect(vm.getSnapshot().items.length).toBeGreaterThan(0));
        return vm;
    };

    const eventKeys = (items: TimelineItem[]): string[] => items.filter((i) => i.kind === "event").map((i) => i.key);
    const galleryIds = (vm: RoomTimelineViewModel, key: string): string[] | undefined =>
        galleryOfItem(vm.getSnapshot().items.find((i) => i.key === key)!)?.map((e) => e.getId()!);

    const addPendingPicture = (id: string, index: number): MatrixEvent => {
        const txnId = `m${1795526378000 + index}.${index}`;
        const event = picture(id, { batch: "b1", index, count: 3 });
        event.setTxnId(txnId);
        event.setStatus(EventStatus.SENDING);
        room.addPendingEvent(event, txnId);
        return event;
    };

    const receiveRemoteEcho = async (pending: MatrixEvent, serverId: string): Promise<void> => {
        const echo = picture(serverId, {
            batch: "b1",
            index: pending.getContent()[GALLERY_BATCH_FIELD].index,
            count: 3,
        });
        echo.setUnsigned({ transaction_id: pending.getTxnId() });
        await room.addLiveEvents([echo], { addToState: false });
    };

    beforeEach(() => {
        vms = [];
        counter = 0;
        showHidden = false;
        client = createTestClient();
        vi.mocked(client.getSafeUserId).mockReturnValue(USER_ID);
        room = new Room(ROOM_ID, client, USER_ID, { pendingEventOrdering: PendingEventOrdering.Detached });
        vi.spyOn(client, "getRoom").mockReturnValue(room);
        vi.mocked(SettingsStore).getValue.mockImplementation((key): any => {
            if (key === "sendReadReceipts") return true;
            if (key === "showHiddenEventsInTimeline") return showHidden;
            return undefined;
        });
        vi.mocked(SettingsStore).watchSetting.mockReturnValue("watch-ref");
        vi.mocked(SettingsStore).unwatchSetting.mockImplementation(() => {});
        localStorage.clear();
    });

    afterEach(() => {
        for (const vm of vms) vm.dispose();
        vi.restoreAllMocks();
        vi.clearAllMocks();
        localStorage.clear();
    });

    it("shows a batch of six as one row, through the call's events and reactions between them", async () => {
        const pictures = [0, 1, 2, 3, 4, 5].map((i) => picture(`$p${i}`, { batch: "b1", index: i }));
        const events: MatrixEvent[] = [text("$before", T0 - 60_000, OTHER_USER_ID)];
        pictures.forEach((p, i) => {
            events.push(p);
            if (i < 5)
                events.push(callMember(`$m${i}`, p.getTs() + 10), reaction(`$r${i}`, p.getId()!, p.getTs() + 20));
        });
        seedTimeline(events);

        const vm = await createStartedViewModel();

        expect(eventKeys(vm.getSnapshot().items)).toEqual(["$before", "$p0"]);
        expect(galleryIds(vm, "$p0")).toEqual(pictures.map((p) => p.getId()));
    });

    it("does the same with hidden events shown", async () => {
        showHidden = true;
        const pictures = [0, 1, 2].map((i) => picture(`$p${i}`, { batch: "b1", index: i, count: 3 }));
        seedTimeline([pictures[0], callMember("$m0", T0 + 100), pictures[1], callMember("$m1", T0 + 800), pictures[2]]);

        const vm = await createStartedViewModel();

        expect(galleryIds(vm, "$p0")).toEqual(["$p0", "$p1", "$p2"]);
        expect(eventKeys(vm.getSnapshot().items)).not.toContain("$p1");
        expect(eventKeys(vm.getSnapshot().items)).not.toContain("$p2");
    });

    it("is parted by a message between the pictures", async () => {
        seedTimeline([picture("$p0"), text("$t", T0 + 300), picture("$p1"), picture("$p2")]);

        const vm = await createStartedViewModel();

        expect(eventKeys(vm.getSnapshot().items)).toEqual(["$p0", "$t", "$p1"]);
        expect(galleryIds(vm, "$p0")).toBeUndefined();
        expect(galleryIds(vm, "$p1")).toEqual(["$p1", "$p2"]);
    });

    it("groups pictures while they are sent, and keeps them together once the server has them", async () => {
        seedTimeline([text("$a", T0 - 1000)]);
        const vm = await createStartedViewModel();

        const pending = [0, 1, 2].map((i) => addPendingPicture(`~${ROOM_ID}:m${i}`, i));
        await vi.waitFor(() => expect(galleryIds(vm, pending[0].getId()!)).toHaveLength(3));
        expect(eventKeys(vm.getSnapshot().items)).toEqual(["$a", pending[0].getId()]);

        // The first is accepted and comes back, the others are still on their way
        room.updatePendingEvent(pending[0], EventStatus.SENT, "$s0");
        await receiveRemoteEcho(pending[0], "$s0");
        await vi.waitFor(() => expect(eventKeys(vm.getSnapshot().items)).toEqual(["$a", "$s0"]));
        expect(galleryIds(vm, "$s0")).toHaveLength(3);

        for (const [i, id] of [
            [1, "$s1"],
            [2, "$s2"],
        ] as const) {
            room.updatePendingEvent(pending[i], EventStatus.SENT, id);
            await receiveRemoteEcho(pending[i], id);
        }
        await vi.waitFor(() => expect(galleryIds(vm, "$s0")).toEqual(["$s0", "$s1", "$s2"]));
        expect(eventKeys(vm.getSnapshot().items)).toEqual(["$a", "$s0"]);
    });

    it("takes a picture into its gallery once it decrypts, though that adds no row", async () => {
        const pictures = [0, 1, 2].map((i) => picture(`$p${i}`, { batch: "b1", index: i, count: 3 }));
        const decrypt = stillEncrypted(pictures[2]);
        seedTimeline(pictures);
        const vm = await createStartedViewModel();
        expect(galleryIds(vm, "$p0")).toEqual(["$p0", "$p1"]);

        decrypt();

        await vi.waitFor(() => expect(galleryIds(vm, "$p0")).toEqual(["$p0", "$p1", "$p2"]));
        expect(eventKeys(vm.getSnapshot().items)).toEqual(["$p0"]);
    });

    it("gives the picture being edited, and the one a link points at, a row of their own", async () => {
        seedTimeline([picture("$p0"), picture("$p1"), picture("$p2")]);
        const vm = await createStartedViewModel("$p1");

        expect(eventKeys(vm.getSnapshot().items)).toEqual(["$p0", "$p1", "$p2"]);

        const other = await (async () => {
            const v = new RoomTimelineViewModel({ client, room });
            vms.push(v);
            v.setEditingEventId("$p2");
            v.start();
            await vi.waitFor(() => expect(v.getSnapshot().items.length).toBeGreaterThan(0));
            return v;
        })();
        expect(eventKeys(other.getSnapshot().items)).toEqual(["$p0", "$p2"]);
        expect(galleryIds(other, "$p0")).toEqual(["$p0", "$p1"]);

        other.setEditingEventId(null);
        await vi.waitFor(() => expect(eventKeys(other.getSnapshot().items)).toEqual(["$p0"]));
    });

    it("reads up to the last picture of a gallery when its row is seen", async () => {
        seedTimeline([
            text("$a", T0 - 1000, OTHER_USER_ID),
            ...[0, 1, 2].map((i) => picture(`$r${i}`, { user: OTHER_USER_ID })),
        ]);
        const vm = await createStartedViewModel();
        vm.onAnchorReached();

        vm.onVisibleRangeChanged(0, vm.getSnapshot().items.length - 1);

        await vi.waitFor(() => expect(client.sendReadReceipt).toHaveBeenCalled(), { timeout: 2000 });
        expect(vi.mocked(client.sendReadReceipt).mock.calls[0][0]?.getId()).toBe("$r2");
    });

    it("writes what it decided to the diagnostics log", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        seedTimeline([0, 1, 2].map((i) => picture(`$log${i}`, { batch: "b2", index: i, count: 3 })));

        await createStartedViewModel();

        const records = log.mock.calls
            .map(([line]) => String(line))
            .filter((line) => line.startsWith("[intercom-diag] "))
            .map((line) => JSON.parse(line.slice("[intercom-diag] ".length)));
        const decision = records.find((r) => r.type === "gallery_decision");
        expect(decision).toMatchObject({ panel: "new", grouping: true, pictures: 3, galleries: [3] });
        expect(decision.items.map((i: { outcome: string }) => i.outcome)).toEqual(["first", "joined", "joined"]);
    });
});
