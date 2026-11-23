/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, vi, afterEach } from "vitest";
import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { callsToLeave, leaveOtherCalls, VoiceSwitcher } from "./VoiceSwitch";
import { type CallStore, CallStoreEvent } from "../stores/CallStore";
import { type Call } from "../models/Call";

// The real store brings the whole application with it
vi.mock("../stores/CallStore", () => ({
    CallStore: { instance: { connectedCalls: new Set() } },
    CallStoreEvent: { ConnectedCalls: "connected_calls" },
}));

function makeCall(roomId: string, connected = true): Call & { disconnect: ReturnType<typeof vi.fn> } {
    const call = {
        roomId,
        connected,
        disconnect: vi.fn(async () => {
            call.connected = false;
        }),
    };
    return call as unknown as Call & { disconnect: ReturnType<typeof vi.fn> };
}

describe("VoiceSwitch", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("callsToLeave", () => {
        it("is every connected call but the one being joined", () => {
            const a = makeCall("!a:x");
            const b = makeCall("!b:x");
            const c = makeCall("!c:x", false);
            expect(callsToLeave([a, b, c], "!b:x")).toEqual([a]);
        });

        it("is nothing when the user is in no call, or only in the one being joined", () => {
            expect(callsToLeave([], "!a:x")).toEqual([]);
            expect(callsToLeave([makeCall("!a:x")], "!a:x")).toEqual([]);
        });
    });

    describe("leaveOtherCalls", () => {
        it("leaves the call of a voice channel before another is joined", async () => {
            const lounge = makeCall("!lounge:x");
            const left = await leaveOtherCalls("!stage:x", [lounge]);
            expect(lounge.disconnect).toHaveBeenCalledTimes(1);
            expect(left).toEqual(["!lounge:x"]);
        });

        it("leaves a normal room's call as well", async () => {
            const dm = makeCall("!dm:x");
            const general = makeCall("!general:x");
            await leaveOtherCalls("!stage:x", [dm, general]);
            expect(dm.disconnect).toHaveBeenCalled();
            expect(general.disconnect).toHaveBeenCalled();
        });

        it("resolves only once the other call is left", async () => {
            const hangup = Promise.withResolvers<void>();
            const lounge = makeCall("!lounge:x");
            lounge.disconnect.mockReturnValue(hangup.promise);
            let done = false;
            const leaving = leaveOtherCalls("!stage:x", [lounge]).then(() => (done = true));
            await Promise.resolve();
            expect(done).toBe(false);
            hangup.resolve();
            await leaving;
            expect(done).toBe(true);
        });

        it("does not leave the call that is being joined", async () => {
            const stage = makeCall("!stage:x");
            expect(await leaveOtherCalls("!stage:x", [stage])).toEqual([]);
            expect(stage.disconnect).not.toHaveBeenCalled();
        });

        it("goes on when a call cannot be left", async () => {
            vi.spyOn(logger, "warn").mockImplementation(() => {});
            const broken = makeCall("!broken:x");
            broken.disconnect.mockRejectedValue(new Error("timed out"));
            const lounge = makeCall("!lounge:x");
            await expect(leaveOtherCalls("!stage:x", [broken, lounge])).resolves.toEqual(["!broken:x", "!lounge:x"]);
            expect(lounge.disconnect).toHaveBeenCalled();
        });
    });

    describe("VoiceSwitcher", () => {
        function makeStore(): CallStore {
            return new TypedEventEmitter() as unknown as CallStore;
        }

        it("leaves the call the user was in when they are connected to another", () => {
            const store = makeStore();
            const switcher = new VoiceSwitcher();
            switcher.start(store);
            const lounge = makeCall("!lounge:x");
            const stage = makeCall("!stage:x");

            store.emit(CallStoreEvent.ConnectedCalls, new Set([lounge]), new Set());
            expect(lounge.disconnect).not.toHaveBeenCalled();

            store.emit(CallStoreEvent.ConnectedCalls, new Set([lounge, stage]), new Set([lounge]));
            expect(lounge.disconnect).toHaveBeenCalledTimes(1);
            expect(stage.disconnect).not.toHaveBeenCalled();
            switcher.stop();
        });

        it("does nothing when a call is left", () => {
            const store = makeStore();
            const switcher = new VoiceSwitcher();
            switcher.start(store);
            const lounge = makeCall("!lounge:x");
            const stage = makeCall("!stage:x");
            store.emit(CallStoreEvent.ConnectedCalls, new Set([stage]), new Set([lounge, stage]));
            expect(stage.disconnect).not.toHaveBeenCalled();
            switcher.stop();
        });

        it("stops listening when stopped", () => {
            const store = makeStore();
            const switcher = new VoiceSwitcher();
            switcher.start(store);
            switcher.stop();
            const lounge = makeCall("!lounge:x");
            store.emit(CallStoreEvent.ConnectedCalls, new Set([lounge, makeCall("!stage:x")]), new Set([lounge]));
            expect(lounge.disconnect).not.toHaveBeenCalled();
        });
    });
});
