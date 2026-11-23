/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { act, renderHook, waitFor } from "test-utils-rtl";
import { describe, expect, it, vi } from "vitest";

import { useUpdateReady } from "./useUpdateReady";
import { type UpdaterApi, type UpdaterState } from "./Updater";

const idle: UpdaterState = { supported: true, autoCheck: true, channel: "stable", phase: "idle" };

function setUp(initial: UpdaterState): {
    api: UpdaterApi;
    push: (state: UpdaterState) => void;
    unsubscribe: ReturnType<typeof vi.fn>;
    subscribe: (listener: (state: UpdaterState) => void) => () => void;
} {
    const api = { getState: vi.fn().mockResolvedValue(initial) } as unknown as UpdaterApi;
    let listener: ((state: UpdaterState) => void) | undefined;
    const unsubscribe = vi.fn();
    return {
        api,
        push: (state) => listener?.(state),
        unsubscribe,
        subscribe: (l) => {
            listener = l;
            return unsubscribe;
        },
    };
}

describe("useUpdateReady", () => {
    it("is false in a browser", () => {
        const { result } = renderHook(() => useUpdateReady(undefined, () => () => {}));
        expect(result.current).toBe(false);
    });

    it("follows the updater: true only while an update waits for the restart", async () => {
        const { api, subscribe, push, unsubscribe } = setUp(idle);
        const { result, unmount } = renderHook(() => useUpdateReady(api, subscribe));
        expect(result.current).toBe(false);
        act(() => push({ ...idle, phase: "downloading" }));
        expect(result.current).toBe(false);
        act(() => push({ ...idle, phase: "ready", latestVersion: "1.12.35-intercom.7" }));
        expect(result.current).toBe(true);
        // The toast was put away: the update is ready all the same
        act(() => push({ ...idle, phase: "installing" }));
        expect(result.current).toBe(false);
        unmount();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("knows of an update that was ready before it listened", async () => {
        const { api, subscribe } = setUp({ ...idle, phase: "ready" });
        const { result } = renderHook(() => useUpdateReady(api, subscribe));
        await waitFor(() => expect(result.current).toBe(true));
    });
});
