/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render, screen } from "test-utils-rtl";
import userEvent from "@testing-library/user-event";

import { startUpdateToasts } from "./UpdateToast";
import { type UpdaterApi, type UpdaterState } from "./Updater";

const base: UpdaterState = {
    supported: true,
    currentVersion: "1.12.35-intercom.5",
    autoCheck: true,
    channel: "stable",
    phase: "idle",
};
const ready: UpdaterState = {
    ...base,
    phase: "ready",
    latestVersion: "1.12.35-intercom.6",
    releaseUrl: "https://github.com/c4g7-dev/InterCom/releases/tag/v1.12.35-intercom.6",
};

function setUp(initial: UpdaterState = base): {
    api: { [K in keyof UpdaterApi]: ReturnType<typeof vi.fn> };
    push: (state: UpdaterState) => void;
    toasts: { addOrReplaceToast: ReturnType<typeof vi.fn>; dismissToast: ReturnType<typeof vi.fn> };
    stop: () => void;
    unsubscribe: ReturnType<typeof vi.fn>;
} {
    const api = {
        getState: vi.fn().mockResolvedValue(initial),
        check: vi.fn(),
        install: vi.fn().mockResolvedValue(initial),
        setAutoCheck: vi.fn(),
        openReleasePage: vi.fn().mockResolvedValue(initial),
    };
    const toasts = { addOrReplaceToast: vi.fn(), dismissToast: vi.fn() };
    let listener: ((state: UpdaterState) => void) | undefined;
    const unsubscribe = vi.fn();
    const stop = startUpdateToasts(
        api,
        (l) => {
            listener = l;
            return unsubscribe;
        },
        toasts,
    );
    return { api, push: (state) => listener?.(state), toasts, stop, unsubscribe };
}

/** Renders the toast that was shown last. */
function renderToast(toasts: { addOrReplaceToast: ReturnType<typeof vi.fn> }): string {
    const toast = toasts.addOrReplaceToast.mock.lastCall![0];
    const Component = toast.component;
    render(<Component {...toast.props} />);
    return toast.title;
}

describe("startUpdateToasts", () => {
    afterEach(cleanup);

    it("does nothing where there is no updater", () => {
        expect(startUpdateToasts(undefined)).toBeInstanceOf(Function);
    });

    it("shows nothing while there is nothing newer", async () => {
        const { toasts, push } = setUp();
        await Promise.resolve();
        push({ ...base, phase: "checking" });
        push({ ...base, phase: "downloading", latestVersion: "1.12.35-intercom.6", progress: 0.3 });
        push({ ...base, phase: "error", error: "offline" });
        expect(toasts.addOrReplaceToast).not.toHaveBeenCalled();
    });

    it("offers the restart when an update is ready, with a link to the release notes", async () => {
        const { api, toasts, push } = setUp();
        push(ready);
        expect(renderToast(toasts)).toBe("InterCom 1.12.35-intercom.6 is available");
        expect(screen.getByText(/Restart to update\./)).toBeTruthy();

        await userEvent.click(screen.getByRole("link", { name: "Release notes" }));
        expect(api.openReleasePage).toHaveBeenCalledTimes(1);
        expect(api.install).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole("button", { name: "Restart to update" }));
        expect(api.install).toHaveBeenCalledTimes(1);
    });

    it("shows an update once, however often the state is pushed, and puts it away on Later", async () => {
        const { toasts, push } = setUp();
        push(ready);
        push(ready);
        push({ ...ready, autoCheck: false });
        expect(toasts.addOrReplaceToast).toHaveBeenCalledTimes(1);

        renderToast(toasts);
        await userEvent.click(screen.getByRole("button", { name: "Later" }));
        expect(toasts.dismissToast).toHaveBeenCalledWith("intercom_update");
        push(ready);
        expect(toasts.addOrReplaceToast).toHaveBeenCalledTimes(1);

        // The next version is news again
        push({ ...ready, latestVersion: "1.12.35-intercom.7" });
        expect(toasts.addOrReplaceToast).toHaveBeenCalledTimes(2);
    });

    it("shows an update that was ready before the window listened", async () => {
        const { toasts } = setUp(ready);
        await Promise.resolve();
        await Promise.resolve();
        expect(toasts.addOrReplaceToast).toHaveBeenCalledTimes(1);
    });

    it("points at the release page where the install cannot replace itself", async () => {
        const { api, toasts, push } = setUp();
        push({ ...ready, phase: "manual" });
        renderToast(toasts);
        expect(screen.getByText(/cannot update itself/)).toBeTruthy();
        await userEvent.click(screen.getByRole("button", { name: "Open the release page" }));
        expect(api.openReleasePage).toHaveBeenCalledTimes(1);
        expect(api.install).not.toHaveBeenCalled();
        expect(toasts.dismissToast).toHaveBeenCalled();
    });

    it("stops when asked to", () => {
        const { stop, unsubscribe } = setUp();
        stop();
        expect(unsubscribe).toHaveBeenCalled();
    });
});
