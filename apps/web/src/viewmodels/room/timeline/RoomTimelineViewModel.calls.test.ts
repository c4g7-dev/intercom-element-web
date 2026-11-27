/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
    EventType,
    MatrixEvent,
    MsgType,
    PendingEventOrdering,
    Room,
    type MatrixClient,
} from "matrix-js-sdk/src/matrix";
import { type TimelineItem } from "@element-hq/web-shared-components";
import { createTestClient } from "test-utils";

import SettingsStore from "../../../settings/SettingsStore";
import { RoomTimelineViewModel } from "./RoomTimelineViewModel";

vi.mock("../../../settings/SettingsStore");

const ROOM_ID = "!dm:example.org";
const ADA = "@ada:example.org";
const BEN = "@ben:example.org";
const T0 = new Date(2026, 10, 27, 21, 21, 0).getTime();

/**
 * The room timeline the new timeline (labs "feature_new_timeline") draws: two tiles of one call
 * are one row, as in the old one.
 */
describe("RoomTimelineViewModel calls", () => {
    let client: MatrixClient;
    let room: Room;
    let vms: RoomTimelineViewModel[];
    let showHidden: boolean;

    const notification = (id: string, ts: number, sender = ADA): MatrixEvent =>
        new MatrixEvent({
            type: EventType.RTCNotification,
            event_id: id,
            room_id: ROOM_ID,
            sender,
            origin_server_ts: ts,
            content: {
                "slot_id": "m.call#ROOM",
                "notification_type": "ring",
                "sender_ts": ts,
                "lifetime": 30_000,
                "m.call.intent": "audio",
                "m.relates_to": { rel_type: "m.reference", event_id: `${id}-membership` },
            },
        });

    const text = (id: string, ts: number): MatrixEvent =>
        new MatrixEvent({
            type: EventType.RoomMessage,
            event_id: id,
            room_id: ROOM_ID,
            sender: BEN,
            origin_server_ts: ts,
            content: { msgtype: MsgType.Text, body: "hello" },
        });

    const callMember = (id: string, ts: number): MatrixEvent =>
        new MatrixEvent({
            type: "org.matrix.msc3401.call.member",
            state_key: `_${ADA}_DEVICE_m.call`,
            event_id: id,
            room_id: ROOM_ID,
            sender: ADA,
            origin_server_ts: ts,
            content: {},
        });

    const createStartedViewModel = async (events: MatrixEvent[]): Promise<RoomTimelineViewModel> => {
        const timelineSet = room.getUnfilteredTimelineSet();
        for (const event of events) timelineSet.addLiveEvent(event, { addToState: false });
        const vm = new RoomTimelineViewModel({ client, room });
        vms.push(vm);
        vm.start();
        await vi.waitFor(() => expect(vm.getSnapshot().items.length).toBeGreaterThan(0));
        return vm;
    };

    const eventKeys = (items: TimelineItem[]): string[] => items.filter((i) => i.kind === "event").map((i) => i.key);

    beforeEach(() => {
        vms = [];
        showHidden = false;
        client = createTestClient();
        vi.mocked(client.getSafeUserId).mockReturnValue(BEN);
        room = new Room(ROOM_ID, client, BEN, { pendingEventOrdering: PendingEventOrdering.Detached });
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

    it("shows a call announced twice as one row, the later one, through the call's own events", async () => {
        const vm = await createStartedViewModel([
            text("$before", T0 - 60_000),
            notification("$first", T0),
            callMember("$m0", T0 + 2000),
            notification("$second", T0 + 6000),
        ]);

        expect(eventKeys(vm.getSnapshot().items)).toEqual(["$before", "$second"]);
    });

    it("keeps two calls as two rows: a message between them, another caller, or minutes apart", async () => {
        const vm = await createStartedViewModel([
            notification("$a", T0),
            text("$between", T0 + 1000),
            notification("$b", T0 + 6000),
            notification("$c", T0 + 8000, BEN),
            notification("$d", T0 + 10 * 60_000, BEN),
        ]);

        expect(eventKeys(vm.getSnapshot().items)).toEqual(["$a", "$between", "$b", "$c", "$d"]);
    });

    it("shows every event with hidden events shown", async () => {
        showHidden = true;
        const vm = await createStartedViewModel([notification("$first", T0), notification("$second", T0 + 6000)]);

        expect(eventKeys(vm.getSnapshot().items)).toEqual(["$first", "$second"]);
    });
});
