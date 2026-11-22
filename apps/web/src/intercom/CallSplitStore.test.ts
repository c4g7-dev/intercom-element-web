/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    CALL_SPLIT_MIN_CHAT_HEIGHT,
    CALL_SPLIT_MIN_HEIGHT,
    CallSplitStore,
    CallSplitStoreEvent,
    clampCallHeight,
} from "./CallSplitStore";

describe("clampCallHeight", () => {
    it("keeps the call between its minimum and what leaves room for the chat", () => {
        expect(clampCallHeight(400, 900)).toBe(400);
        expect(clampCallHeight(10, 900)).toBe(CALL_SPLIT_MIN_HEIGHT);
        expect(clampCallHeight(5000, 900)).toBe(900 - CALL_SPLIT_MIN_CHAT_HEIGHT);
    });

    it("gives a room too low for both the call's minimum", () => {
        expect(clampCallHeight(400, 250)).toBe(CALL_SPLIT_MIN_HEIGHT);
        expect(clampCallHeight(NaN, 900)).toBe(900 - CALL_SPLIT_MIN_CHAT_HEIGHT);
    });
});

describe("CallSplitStore", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it("shows the call over the chat until the user asks for the call alone, and remembers", () => {
        const store = new CallSplitStore();
        const onMode = vi.fn();
        store.on(CallSplitStoreEvent.Mode, onMode);
        expect(store.mode).toBe("split");
        store.setMode("full");
        store.setMode("full");
        expect(onMode).toHaveBeenCalledExactlyOnceWith("full");
        const again = new CallSplitStore();
        expect(again.mode).toBe("full");
        again.destroy();
        store.destroy();
    });

    it("remembers the height and whether the call is folded away", () => {
        const store = new CallSplitStore();
        const onLayout = vi.fn();
        store.on(CallSplitStoreEvent.Layout, onLayout);
        expect(store.height).toBeUndefined();
        expect(store.collapsed).toBe(false);
        store.setHeight(321.4);
        store.setCollapsed(true);
        expect(onLayout).toHaveBeenCalledTimes(2);
        const again = new CallSplitStore();
        expect(again.height).toBe(321);
        expect(again.collapsed).toBe(true);
        again.destroy();
        store.destroy();
    });
});
