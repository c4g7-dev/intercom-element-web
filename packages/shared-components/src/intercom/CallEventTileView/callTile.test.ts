/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { describe, expect, it } from "vitest";
import { type I18nApi } from "@element-hq/element-web-module-api";

import { callTileTitle, formatCallClock, formatCallDuration, stackCallParticipants } from "./callTile";
import en from "../../i18n/strings/en_EN.json";

/** English, from the strings of the package. */
const _t = ((key: string, variables: Record<string, unknown> = {}): string => {
    const text = key.split("|").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], en) as string;
    return text.replace(/%\((\w+)\)s/g, (_, name: string) => String(variables[name]));
}) as I18nApi["translate"];

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

describe("formatCallDuration", () => {
    it.each([
        [0, "1 s"],
        [400, "1 s"],
        [6 * SECOND, "6 s"],
        [59_999, "59 s"],
        [MINUTE, "1 min"],
        [4 * MINUTE + 59 * SECOND, "4 min"],
        [59 * MINUTE + 59 * SECOND, "59 min"],
        [HOUR, "1 h"],
        [HOUR + 30 * SECOND, "1 h"],
        [HOUR + 12 * MINUTE + 40 * SECOND, "1 h 12 min"],
        [26 * HOUR + 5 * MINUTE, "26 h 5 min"],
    ])("says %d ms as %s", (ms, text) => {
        expect(formatCallDuration(ms, _t)).toBe(text);
    });
});

describe("formatCallClock", () => {
    it.each([
        [-5 * SECOND, "0:00"],
        [0, "0:00"],
        [6 * SECOND + 900, "0:06"],
        [4 * MINUTE + 12 * SECOND, "4:12"],
        [HOUR + 2 * MINUTE + 3 * SECOND, "1:02:03"],
    ])("counts %d ms as %s", (ms, text) => {
        expect(formatCallClock(ms)).toBe(text);
    });
});

describe("callTileTitle", () => {
    const call = { outgoing: false, startedByName: "Ada" };

    it("names who started a running call", () => {
        expect(callTileTitle({ ...call, state: "ongoing" }, _t)).toBe("Ada started a call");
        expect(callTileTitle({ ...call, state: "ongoing", outgoing: true }, _t)).toBe("You started a call");
    });

    it("says who is calling while it rings", () => {
        expect(callTileTitle({ ...call, state: "ringing" }, _t)).toBe("Ada is calling");
        expect(callTileTitle({ ...call, state: "ringing", outgoing: true }, _t)).toBe("Calling…");
    });

    it("says how long a call took once it is over, if that is known", () => {
        expect(callTileTitle({ ...call, state: "ended", durationMs: 6 * SECOND }, _t)).toBe("Call ended · 6 s");
        expect(callTileTitle({ ...call, state: "ended", durationMs: 72 * MINUTE }, _t)).toBe("Call ended · 1 h 12 min");
        expect(callTileTitle({ ...call, state: "ended" }, _t)).toBe("Call ended");
        expect(callTileTitle({ ...call, state: "ended", durationMs: 0 }, _t)).toBe("Call ended");
    });

    it("tells a call the user missed from one of theirs nobody answered", () => {
        expect(callTileTitle({ ...call, state: "missed" }, _t)).toBe("Missed call");
        expect(callTileTitle({ ...call, state: "missed", outgoing: true }, _t)).toBe("No answer");
    });

    it("says that a call was declined", () => {
        expect(callTileTitle({ ...call, state: "declined" }, _t)).toBe("Call declined");
    });
});

describe("stackCallParticipants", () => {
    it("shows everybody up to four", () => {
        expect(stackCallParticipants(["a", "b"])).toEqual({ shown: ["a", "b"], more: 0 });
        expect(stackCallParticipants(["a", "b", "c", "d"])).toEqual({ shown: ["a", "b", "c", "d"], more: 0 });
    });

    it("counts the rest", () => {
        expect(stackCallParticipants(["a", "b", "c", "d", "e", "f"])).toEqual({
            shown: ["a", "b", "c", "d"],
            more: 2,
        });
    });
});
