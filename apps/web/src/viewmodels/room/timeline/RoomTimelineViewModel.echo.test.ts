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
    MsgType,
    PendingEventOrdering,
    Room,
    type IContent,
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
const T0 = new Date(2026, 10, 24, 17, 0, 0).getTime();

/**
 * A message of ours in the new timeline (labs "feature_new_timeline"), from the composer to the
 * server's echo: its row must never go missing, whether it is text, one picture or a gallery,
 * and also after a sync with a gap has replaced the room's live timeline (1.12.35-intercom.10:
 * the message vanished the moment its echo arrived).
 */
describe("RoomTimelineViewModel: our messages from local echo to remote echo", () => {
    let client: MatrixClient;
    let room: Room;
    let vms: RoomTimelineViewModel[];
    let counter: number;

    const textContent = (body: string): IContent => ({ msgtype: MsgType.Text, body });
    const pictureContent = (n: number, batch?: { index: number; count: number }): IContent => ({
        msgtype: MsgType.Image,
        body: `Screenshot ${n}.png`,
        filename: `Screenshot ${n}.png`,
        url: `mxc://example.org/pic${n}`,
        info: { mimetype: "image/png", w: 1920, h: 1080, size: 1000 },
        ...(batch ? { [GALLERY_BATCH_FIELD]: { id: "b1", ...batch } } : {}),
    });

    const message = (id: string, content: IContent, user = USER_ID): MatrixEvent =>
        new MatrixEvent({
            type: EventType.RoomMessage,
            event_id: id,
            room_id: ROOM_ID,
            sender: user,
            origin_server_ts: T0 + counter++ * 500,
            content,
        });

    const seedTimeline = (events: MatrixEvent[]): void => {
        const timelineSet = room.getUnfilteredTimelineSet();
        for (const event of events) timelineSet.addLiveEvent(event, { addToState: false });
    };

    const createStartedViewModel = async (): Promise<RoomTimelineViewModel> => {
        const vm = new RoomTimelineViewModel({ client, room });
        vms.push(vm);
        vm.start();
        await vi.waitFor(() => expect(vm.getSnapshot().items.length).toBeGreaterThan(0));
        vm.onAnchorReached();
        vm.onAtBottomStateChange(true);
        return vm;
    };

    /** What the composer does: a local echo in the room's pending list, sending. */
    const send = (content: IContent): MatrixEvent => {
        const txnId = `m${counter}.${counter}`;
        const event = message(`~${ROOM_ID}:${txnId}`, content);
        event.setTxnId(txnId);
        event.setStatus(EventStatus.SENDING);
        room.addPendingEvent(event, txnId);
        return event;
    };

    /** The server accepts the message and its copy comes down /sync. */
    const accept = async (pending: MatrixEvent, serverId: string): Promise<void> => {
        room.updatePendingEvent(pending, EventStatus.SENT, serverId);
        const echo = message(serverId, pending.getContent());
        echo.setUnsigned({ transaction_id: pending.getTxnId() });
        await room.addLiveEvents([echo], { addToState: false });
    };

    /**
     * A sync whose timeline is "limited" (after some time offline, or when more arrived than one
     * sync carries), as SyncApi handles it: the live timeline is replaced, every timeline is
     * dropped when the client may (`keepOld` false) or the old one kept with a token to paginate
     * forwards from, then what the sync carried is added.
     */
    const syncWithGap = async (events: MatrixEvent[], keepOld = false): Promise<void> => {
        room.resetLiveTimeline("back-token", keepOld ? "old-sync-token" : null);
        await room.addLiveEvents(events, { addToState: false });
    };

    const eventKeys = (vm: RoomTimelineViewModel): string[] =>
        vm
            .getSnapshot()
            .items.filter((i) => i.kind === "event")
            .map((i) => i.key);
    const galleryIds = (vm: RoomTimelineViewModel, key: string): string[] | undefined =>
        galleryOfItem(vm.getSnapshot().items.find((i: TimelineItem) => i.key === key)!)?.map((e) => e.getId()!);

    /** Records the rows of every publish, to check that a row was never missing in between. */
    const recordPublishes = (vm: RoomTimelineViewModel): string[][] => {
        const published: string[][] = [];
        vm.subscribe(() => published.push(eventKeys(vm)));
        return published;
    };

    beforeEach(() => {
        vms = [];
        counter = 0;
        client = createTestClient();
        vi.mocked(client.getSafeUserId).mockReturnValue(USER_ID);
        // As Element creates its rooms: with more than one timeline, so a gap can keep the old one
        room = new Room(ROOM_ID, client, USER_ID, {
            pendingEventOrdering: PendingEventOrdering.Detached,
            timelineSupport: true,
        });
        vi.spyOn(client, "getRoom").mockReturnValue(room);
        vi.mocked(SettingsStore).getValue.mockImplementation((key): any => {
            if (key === "sendReadReceipts") return true;
            if (key === "showHiddenEventsInTimeline") return false;
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

    describe("in a timeline without a gap", () => {
        it("keeps a text message's row from the composer to the server's copy", async () => {
            seedTimeline([message("$a", textContent("Hi"), OTHER_USER_ID)]);
            const vm = await createStartedViewModel();
            const published = recordPublishes(vm);

            const pending = send(textContent("Hello"));
            await vi.waitFor(() => expect(eventKeys(vm)).toEqual(["$a", pending.getId()]));
            await accept(pending, "$hello");

            await vi.waitFor(() => expect(eventKeys(vm)).toEqual(["$a", "$hello"]));
            for (const keys of published) expect(keys).toHaveLength(2);
        });

        it("keeps a single picture's row, which is no gallery", async () => {
            seedTimeline([message("$a", textContent("Hi"), OTHER_USER_ID)]);
            const vm = await createStartedViewModel();
            const published = recordPublishes(vm);

            const pending = send(pictureContent(1));
            await vi.waitFor(() => expect(eventKeys(vm)).toEqual(["$a", pending.getId()]));
            await accept(pending, "$pic");

            await vi.waitFor(() => expect(eventKeys(vm)).toEqual(["$a", "$pic"]));
            expect(galleryIds(vm, "$pic")).toBeUndefined();
            for (const keys of published) expect(keys).toHaveLength(2);
        });

        it("keeps a text message sent after a gallery as a row of its own", async () => {
            seedTimeline([
                message("$p0", pictureContent(0, { index: 0, count: 2 })),
                message("$p1", pictureContent(1, { index: 1, count: 2 })),
            ]);
            const vm = await createStartedViewModel();
            expect(galleryIds(vm, "$p0")).toEqual(["$p0", "$p1"]);

            const pending = send(textContent("Those are the screenshots"));
            await vi.waitFor(() => expect(eventKeys(vm)).toEqual(["$p0", pending.getId()]));
            await accept(pending, "$text");

            await vi.waitFor(() => expect(eventKeys(vm)).toEqual(["$p0", "$text"]));
            expect(galleryIds(vm, "$p0")).toEqual(["$p0", "$p1"]);
        });
    });

    describe("after a sync with a gap", () => {
        it("keeps a text message's row when its echo arrives, and shows what arrives after the gap", async () => {
            seedTimeline([message("$a", textContent("Hi"), OTHER_USER_ID)]);
            const vm = await createStartedViewModel();

            await syncWithGap([message("$b", textContent("Back again"), OTHER_USER_ID)]);
            await vi.waitFor(() => expect(eventKeys(vm)).toEqual(["$b"]));
            expect(vm.getSnapshot().atLiveEnd).toBe(true);

            const published = recordPublishes(vm);
            const pending = send(textContent("Hello"));
            await vi.waitFor(() => expect(eventKeys(vm)).toEqual(["$b", pending.getId()]));
            await accept(pending, "$hello");

            await vi.waitFor(() => expect(eventKeys(vm)).toEqual(["$b", "$hello"]));
            // The row was there in every publish: the message never vanished
            for (const keys of published) expect(keys).toHaveLength(2);

            // And the next message from the other side gets a row as well
            await room.addLiveEvents([message("$c", textContent("Got it"), OTHER_USER_ID)], { addToState: false });
            await vi.waitFor(() => expect(eventKeys(vm)).toEqual(["$b", "$hello", "$c"]));
        });

        it("does not lose a message the moment its echo arrives (the report on 1.12.35-intercom.10)", async () => {
            seedTimeline([message("$a", textContent("Hi"), OTHER_USER_ID)]);
            const vm = await createStartedViewModel();
            // A gap with nothing new in it, as after a reconnect
            await syncWithGap([]);

            const pending = send(textContent("Hello"));
            const localId = pending.getId()!;
            // (What was loaded before the gap is fetched again from the server; there is none here.)
            await vi.waitFor(() => expect(eventKeys(vm)).toEqual([localId]));
            await accept(pending, "$hello");

            await vi.waitFor(() => expect(eventKeys(vm)).toEqual(["$hello"]));
        });

        it("keeps a picture's row when its echo arrives", async () => {
            seedTimeline([message("$a", textContent("Hi"), OTHER_USER_ID)]);
            const vm = await createStartedViewModel();
            await syncWithGap([message("$b", textContent("Back again"), OTHER_USER_ID)]);
            await vi.waitFor(() => expect(eventKeys(vm)).toEqual(["$b"]));

            const pending = send(pictureContent(1));
            await vi.waitFor(() => expect(eventKeys(vm)).toEqual(["$b", pending.getId()]));
            await accept(pending, "$pic");

            await vi.waitFor(() => expect(eventKeys(vm)).toEqual(["$b", "$pic"]));
        });

        it("keeps a gallery together while its pictures are sent and once the server has them", async () => {
            seedTimeline([message("$a", textContent("Hi"), OTHER_USER_ID)]);
            const vm = await createStartedViewModel();
            await syncWithGap([message("$b", textContent("Send them?"), OTHER_USER_ID)]);
            await vi.waitFor(() => expect(eventKeys(vm)).toEqual(["$b"]));

            const pending = [0, 1, 2].map((index) => send(pictureContent(index, { index, count: 3 })));
            await vi.waitFor(() => expect(galleryIds(vm, pending[0].getId()!)).toHaveLength(3));
            expect(eventKeys(vm)).toEqual(["$b", pending[0].getId()]);

            for (const [index, id] of ["$s0", "$s1", "$s2"].entries()) await accept(pending[index], id);

            await vi.waitFor(() => expect(galleryIds(vm, "$s0")).toEqual(["$s0", "$s1", "$s2"]));
            expect(eventKeys(vm)).toEqual(["$b", "$s0"]);
        });

        it("stays in the history being read when the old timeline is kept, and lets it be dropped at the bottom", async () => {
            seedTimeline([message("$a", textContent("Hi"), OTHER_USER_ID), message("$b", textContent("Hello"))]);
            const vm = await createStartedViewModel();
            expect(RoomTimelineViewModel.canResetTimeline(ROOM_ID)).toBe(true);

            vm.onAtBottomStateChange(false);
            expect(RoomTimelineViewModel.canResetTimeline(ROOM_ID)).toBe(false);

            await syncWithGap([message("$c", textContent("Meanwhile"), OTHER_USER_ID)], true);
            await vi.waitFor(() => expect(vm.getSnapshot().atLiveEnd).toBe(false));
            expect(eventKeys(vm)).toEqual(["$a", "$b"]);

            vm.onAtBottomStateChange(true);
            expect(RoomTimelineViewModel.canResetTimeline(ROOM_ID)).toBe(true);
        });

        it("moves to the new live timeline when the old one is kept but the reader is at the bottom", async () => {
            seedTimeline([message("$a", textContent("Hi"), OTHER_USER_ID)]);
            const vm = await createStartedViewModel();

            await syncWithGap([message("$b", textContent("Back again"), OTHER_USER_ID)], true);

            await vi.waitFor(() => expect(eventKeys(vm)).toEqual(["$b"]));
            expect(vm.getSnapshot().atLiveEnd).toBe(true);
        });

        it("lets every timeline of a room that is not shown be dropped", async () => {
            expect(RoomTimelineViewModel.canResetTimeline("!elsewhere:example.org")).toBe(true);
            seedTimeline([message("$a", textContent("Hi"), OTHER_USER_ID)]);
            const vm = await createStartedViewModel();
            vm.onAtBottomStateChange(false);
            vms.splice(vms.indexOf(vm), 1);
            vm.dispose();
            expect(RoomTimelineViewModel.canResetTimeline(ROOM_ID)).toBe(true);
        });
    });
});
