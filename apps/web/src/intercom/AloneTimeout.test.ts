/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { type Room } from "matrix-js-sdk/src/matrix";

import {
    aloneTimeoutApplies,
    aloneTimeoutParam,
    DEFAULT_ALONE_TIMEOUT,
    getAloneTimeout,
    lastAloneDisconnect,
    noteAloneDisconnect,
    readAloneCountdown,
    readAloneTimeout,
    storeAloneTimeout,
} from "./AloneTimeout";

const room = (kind: "dm" | "video" | "call" | "public"): Room =>
    ({
        getJoinRule: () => (kind === "public" ? "public" : "invite"),
        isElementVideoRoom: () => kind === "video",
        isCallRoom: () => kind === "call",
    }) as unknown as Room;

describe("the time to stay alone in a call for", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        window.localStorage.clear();
    });

    it("is one of 3, 5 and 10 minutes or never, and 5 minutes for anything else", () => {
        expect(DEFAULT_ALONE_TIMEOUT).toBe(300);
        expect(readAloneTimeout("180")).toBe(180);
        expect(readAloneTimeout(300)).toBe(300);
        expect(readAloneTimeout("600")).toBe(600);
        expect(readAloneTimeout("never")).toBe("never");
        for (const other of [null, undefined, "", "0", "42", 7, "soon", {}]) expect(readAloneTimeout(other)).toBe(300);
    });

    it("is kept on this device", () => {
        expect(getAloneTimeout()).toBe(300);
        storeAloneTimeout(600);
        expect(getAloneTimeout()).toBe(600);
        storeAloneTimeout("never");
        expect(getAloneTimeout()).toBe("never");
        expect(window.localStorage.getItem("intercom_alone_timeout")).toBe("never");
    });

    it("is the default where nothing can be kept", () => {
        vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
            throw new Error("no storage");
        });
        expect(() => storeAloneTimeout(180)).not.toThrow();
        expect(getAloneTimeout()).toBe(300);
    });

    it("is given to the call of a private room, not to a voice channel or a public room", () => {
        expect(aloneTimeoutApplies(room("dm"))).toBe(true);
        expect(aloneTimeoutApplies(room("video"))).toBe(false);
        expect(aloneTimeoutApplies(room("call"))).toBe(false);
        expect(aloneTimeoutApplies(null)).toBe(false);
        // A public room's call is open to whoever comes by: nobody is disconnected from it
        expect(aloneTimeoutApplies(room("public"))).toBe(false);
        expect(aloneTimeoutParam(room("public"))).toBeUndefined();

        expect(aloneTimeoutParam(room("dm"))).toBe("300");
        storeAloneTimeout(180);
        expect(aloneTimeoutParam(room("dm"))).toBe("180");
        expect(aloneTimeoutParam(room("dm"), "never")).toBe("never");
        expect(aloneTimeoutParam(room("video"))).toBeUndefined();
        expect(aloneTimeoutParam(room("call"), 600)).toBeUndefined();
        expect(aloneTimeoutParam(undefined)).toBeUndefined();
    });
});

describe("readAloneCountdown", () => {
    it("makes a deadline of what the call says is left", () => {
        expect(readAloneCountdown({ ms_left: 300_000, seq: 1 }, 1_000)).toEqual({ deadline: 301_000, seq: 1 });
        expect(readAloneCountdown({ ms_left: 0 }, 1_000)).toEqual({ deadline: 1_000, seq: 0 });
    });

    it.each([undefined, null, "x", 5, {}, { ms_left: "300" }, { ms_left: -1 }, { ms_left: NaN }, { seq: 2 }])(
        "takes %j for no countdown",
        (data) => {
            expect(readAloneCountdown(data, 1_000)).toBeUndefined();
        },
    );

    it("keeps the deadline of a countdown that is told again, and takes that of another", () => {
        const first = readAloneCountdown({ ms_left: 300_000, seq: 1 }, 1_000)!;
        // A minute later something else about the call changed: 60.1 seconds less are left
        expect(readAloneCountdown({ ms_left: 239_900, seq: 1 }, 61_000, first)).toBe(first);
        // The user stayed: the full time again, which is another countdown
        expect(readAloneCountdown({ ms_left: 300_000, seq: 2 }, 61_000, first)).toEqual({ deadline: 361_000, seq: 2 });
        // The same countdown, but far off what was told: the call knows better
        expect(readAloneCountdown({ ms_left: 100_000, seq: 1 }, 61_000, first)).toEqual({ deadline: 161_000, seq: 1 });
    });
});

describe("the calls that ended because the user was alone", () => {
    it("are remembered by room", () => {
        expect(lastAloneDisconnect("!never:x")).toBeUndefined();
        noteAloneDisconnect("!a:x", 5_000);
        expect(lastAloneDisconnect("!a:x")).toBe(5_000);
        expect(lastAloneDisconnect("!b:x")).toBeUndefined();
    });
});
