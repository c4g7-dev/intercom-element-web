/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";

import { UpdateStatusViewModel } from "./UpdateStatusViewModel";
import { type UpdaterApi, type UpdaterState } from "../../intercom/updater/Updater";

const VERSION = "1.12.35-intercom.7";
const idle: UpdaterState = {
    supported: true,
    currentVersion: "1.12.35-intercom.6",
    autoCheck: true,
    channel: "stable",
    phase: "idle",
    log: [],
};

function setUp(initial: UpdaterState = idle): {
    api: { [K in keyof UpdaterApi]: ReturnType<typeof vi.fn> };
    push: (state: UpdaterState) => void;
    unsubscribe: ReturnType<typeof vi.fn>;
    vm: UpdateStatusViewModel;
} {
    const api = {
        getState: vi.fn().mockResolvedValue(initial),
        check: vi.fn().mockResolvedValue({ ...initial, phase: "checking" }),
        install: vi.fn().mockResolvedValue(initial),
        setAutoCheck: vi.fn().mockResolvedValue(initial),
        openReleasePage: vi.fn().mockResolvedValue(initial),
    };
    let listener: ((state: UpdaterState) => void) | undefined;
    const unsubscribe = vi.fn();
    const vm = new UpdateStatusViewModel({
        api,
        subscribe: (l) => {
            listener = l;
            return unsubscribe;
        },
        formatTime: (date) => `t${date.getTime()}`,
    });
    return { api, push: (state) => listener?.(state), unsubscribe, vm };
}

const settled = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

describe("UpdateStatusViewModel", () => {
    it("stays away where there is no updater", () => {
        const vm = new UpdateStatusViewModel({ api: undefined });
        expect(vm.getSnapshot()).toEqual({ phase: "idle", log: [], expanded: false });
        // Nothing to hand anything to, and nothing breaks
        vm.onRestart();
        vm.onRetry();
        vm.onOpenReleasePage();
        vm.dispose();
    });

    it("follows the updater from the check to the restart", async () => {
        const { vm, push } = setUp();
        await settled();
        expect(vm.getSnapshot().phase).toBe("idle");

        const seen: string[] = [];
        vm.subscribe(() => seen.push(vm.getSnapshot().phase));
        const found = { ...idle, latestVersion: VERSION };
        push({ ...idle, phase: "checking", log: [{ t: 1, text: "Checking for updates…" }] });
        const download = { done: 78_000_000, total: 186_000_000, bytesPerSecond: 12_000_000 };
        push({ ...found, phase: "downloading", progress: 0.42, download });
        expect(vm.getSnapshot()).toMatchObject({ phase: "downloading", latestVersion: VERSION, download });
        push({ ...found, phase: "verifying", download });
        // How far the download was is of no interest once it is there
        expect(vm.getSnapshot().download).toBeUndefined();
        push({ ...found, phase: "unpacking" });
        push({ ...found, phase: "ready" });
        push({ ...found, phase: "installing" });
        expect(seen).toEqual(["checking", "downloading", "verifying", "unpacking", "ready", "installing"]);
    });

    it("shows the updater's steps with the time of each", async () => {
        const { vm, push } = setUp();
        await settled();
        push({
            ...idle,
            phase: "checking",
            log: [
                { t: 1000, text: "InterCom is up to date" },
                { t: 2000, text: "Checking for updates…" },
            ],
        });
        expect(vm.getSnapshot().log).toEqual([
            { time: "t1000", text: "InterCom is up to date" },
            { time: "t2000", text: "Checking for updates…" },
        ]);
    });

    it("shows an update that was ready before the window listened", async () => {
        const { vm } = setUp({ ...idle, phase: "ready", latestVersion: VERSION });
        await settled();
        expect(vm.getSnapshot()).toMatchObject({ phase: "ready", latestVersion: VERSION });
    });

    it("opens and closes the steps, and closes them when the bar goes", async () => {
        const { vm, push } = setUp({ ...idle, phase: "downloading", latestVersion: VERSION });
        await settled();
        expect(vm.getSnapshot().expanded).toBe(false);
        vm.onToggleDetails();
        expect(vm.getSnapshot().expanded).toBe(true);
        // Still open while the update goes on
        push({ ...idle, phase: "verifying", latestVersion: VERSION });
        expect(vm.getSnapshot().expanded).toBe(true);
        vm.onToggleDetails();
        expect(vm.getSnapshot().expanded).toBe(false);

        vm.onToggleDetails();
        push(idle);
        push({ ...idle, phase: "checking" });
        expect(vm.getSnapshot().expanded).toBe(false);
    });

    it("hands the buttons to the updater", async () => {
        const { vm, api, push } = setUp({ ...idle, phase: "error", error: "broke" });
        await settled();
        expect(vm.getSnapshot().phase).toBe("error");

        vm.onRetry();
        expect(api.check).toHaveBeenCalledTimes(1);
        await settled();
        // What the updater answered is shown at once
        expect(vm.getSnapshot().phase).toBe("checking");

        push({ ...idle, phase: "ready", latestVersion: VERSION });
        vm.onRestart();
        expect(api.install).toHaveBeenCalledTimes(1);
        vm.onOpenReleasePage();
        expect(api.openReleasePage).toHaveBeenCalledTimes(1);
    });

    it("says nothing for an app that does not update itself, or one that sends no steps", async () => {
        const { vm, push } = setUp({ ...idle, supported: false, reason: "unpackaged", phase: "error" });
        await settled();
        expect(vm.getSnapshot().phase).toBe("idle");
        // A desktop app from before the steps were sent
        push({ supported: true, autoCheck: true, channel: "stable", phase: "ready", latestVersion: VERSION });
        expect(vm.getSnapshot()).toMatchObject({ phase: "ready", log: [] });
    });

    it("stops listening when it is disposed", async () => {
        const { vm, push, unsubscribe } = setUp();
        await settled();
        vm.dispose();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        push({ ...idle, phase: "ready", latestVersion: VERSION });
        expect(vm.getSnapshot().phase).toBe("idle");
    });
});
