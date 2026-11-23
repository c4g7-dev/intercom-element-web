/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";

import { UpdaterSettingsViewModel } from "./UpdaterSettingsViewModel";
import { type UpdaterApi, type UpdaterState } from "../../intercom/updater/Updater";

const idle: UpdaterState = {
    supported: true,
    currentVersion: "1.12.35-intercom.5",
    autoCheck: true,
    channel: "stable",
    phase: "idle",
};

function setUp(initial: UpdaterState = idle): {
    api: { [K in keyof UpdaterApi]: ReturnType<typeof vi.fn> };
    push: (state: UpdaterState) => void;
    unsubscribe: ReturnType<typeof vi.fn>;
    vm: UpdaterSettingsViewModel;
} {
    const api = {
        getState: vi.fn().mockResolvedValue(initial),
        check: vi.fn().mockResolvedValue({ ...initial, phase: "checking" }),
        install: vi.fn().mockResolvedValue(initial),
        setAutoCheck: vi.fn().mockImplementation(async (on: boolean) => ({ ...initial, autoCheck: on })),
        openReleasePage: vi.fn().mockResolvedValue(initial),
    };
    let listener: ((state: UpdaterState) => void) | undefined;
    const unsubscribe = vi.fn();
    const vm = new UpdaterSettingsViewModel({
        api,
        subscribe: (l) => {
            listener = l;
            return unsubscribe;
        },
        formatTime: (date) => `at ${date.getTime()}`,
    });
    return { api, push: (state) => listener?.(state), unsubscribe, vm };
}

const settled = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

describe("UpdaterSettingsViewModel", () => {
    it("says that updates are for the desktop app where there is no updater", () => {
        const vm = new UpdaterSettingsViewModel({ api: undefined });
        expect(vm.getSnapshot()).toMatchObject({ supported: false, reason: "web" });
        // Nothing to hand anything to, and nothing breaks
        vm.onCheckNow();
        vm.onRestart();
        vm.onOpenReleasePage();
        vm.onAutoCheckChange(false);
        vm.dispose();
    });

    it("shows the updater's state once it is known", async () => {
        const { vm } = setUp({ ...idle, lastChecked: 1234 });
        expect(vm.getSnapshot().supported).toBe(false);
        await settled();
        expect(vm.getSnapshot()).toEqual({
            supported: true,
            reason: undefined,
            currentVersion: "1.12.35-intercom.5",
            autoCheck: true,
            phase: "idle",
            latestVersion: undefined,
            progress: undefined,
            error: undefined,
            lastChecked: "at 1234",
        });
    });

    it("follows what the desktop app pushes", async () => {
        const { vm, push } = setUp();
        await settled();
        push({ ...idle, phase: "downloading", latestVersion: "1.12.35-intercom.6", progress: 0.5 });
        expect(vm.getSnapshot()).toMatchObject({
            phase: "downloading",
            latestVersion: "1.12.35-intercom.6",
            progress: 0.5,
        });
        push({ ...idle, phase: "ready", latestVersion: "1.12.35-intercom.6" });
        expect(vm.getSnapshot()).toMatchObject({ phase: "ready", progress: undefined });
        push({ ...idle, supported: false, reason: "no-version" });
        expect(vm.getSnapshot()).toMatchObject({ supported: false, reason: "no-version" });
    });

    it("hands the controls to the desktop app", async () => {
        const { vm, api } = setUp();
        await settled();

        vm.onAutoCheckChange(false);
        // Shown before the answer is there
        expect(vm.getSnapshot().autoCheck).toBe(false);
        expect(api.setAutoCheck).toHaveBeenCalledWith(false);
        await settled();
        expect(vm.getSnapshot().autoCheck).toBe(false);

        vm.onCheckNow();
        await settled();
        expect(api.check).toHaveBeenCalledTimes(1);
        expect(vm.getSnapshot().phase).toBe("checking");

        vm.onRestart();
        vm.onOpenReleasePage();
        expect(api.install).toHaveBeenCalledTimes(1);
        expect(api.openReleasePage).toHaveBeenCalledTimes(1);
    });

    it("stops listening when disposed, and takes nothing that arrives after", async () => {
        const { vm, push, unsubscribe } = setUp();
        await settled();
        vm.dispose();
        expect(unsubscribe).toHaveBeenCalled();
        push({ ...idle, phase: "ready", latestVersion: "1.12.35-intercom.6" });
        expect(vm.getSnapshot().phase).toBe("idle");
    });
});
