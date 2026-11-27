/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ALONE_DISCONNECT_TOAST_MS, showAloneDisconnectToast } from "./AloneDisconnectToast";
import type ToastStore from "../stores/ToastStore";

describe("showAloneDisconnectToast", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const fakeStore = (): ToastStore & { addOrReplaceToast: ReturnType<typeof vi.fn> } =>
        ({ addOrReplaceToast: vi.fn(), dismissToast: vi.fn() }) as unknown as ToastStore & {
            addOrReplaceToast: ReturnType<typeof vi.fn>;
        };

    it("says why the call ended, and goes away by itself", () => {
        const store = fakeStore();
        showAloneDisconnectToast(store);
        expect(store.addOrReplaceToast).toHaveBeenCalledTimes(1);
        const toast = store.addOrReplaceToast.mock.calls[0][0];
        expect(toast.key).toBe("intercom_alone_disconnect");
        expect(toast.props.description).toBe("You were disconnected because you were alone in the call.");

        vi.advanceTimersByTime(ALONE_DISCONNECT_TOAST_MS - 1);
        expect(store.dismissToast).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(store.dismissToast).toHaveBeenCalledWith("intercom_alone_disconnect");
    });

    it("goes away when dismissed, and is one notice however often it is shown", () => {
        const store = fakeStore();
        showAloneDisconnectToast(store);
        vi.advanceTimersByTime(10_000);
        showAloneDisconnectToast(store);
        // The first one's time does not take the second away early
        vi.advanceTimersByTime(ALONE_DISCONNECT_TOAST_MS - 1);
        expect(store.dismissToast).not.toHaveBeenCalled();

        store.addOrReplaceToast.mock.calls[1][0].props.onPrimaryClick();
        expect(store.dismissToast).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(ALONE_DISCONNECT_TOAST_MS);
        expect(store.dismissToast).toHaveBeenCalledTimes(1);
    });
});
