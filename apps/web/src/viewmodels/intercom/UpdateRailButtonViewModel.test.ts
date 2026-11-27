/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";

import { railStateOf, UpdateRailButtonViewModel } from "./UpdateRailButtonViewModel";
import { type UpdaterApi, type UpdaterNotes, type UpdaterState } from "../../intercom/updater/Updater";

const NEW = "1.12.35-intercom.13";
const idle: UpdaterState = {
    supported: true,
    currentVersion: "1.12.35-intercom.11",
    autoCheck: true,
    channel: "stable",
    phase: "idle",
};
const ready: UpdaterState = { ...idle, phase: "ready", latestVersion: NEW };
const NOTES: UpdaterNotes = {
    pending: [
        {
            version: NEW,
            body: "- Newest",
            url: "https://github.com/c4g7-dev/InterCom/releases/tag/v1.12.35-intercom.13",
        },
        {
            version: "1.12.35-intercom.12",
            body: "- Older",
            url: "https://github.com/c4g7-dev/InterCom/releases/tag/v1.12.35-intercom.12",
        },
    ],
    whatsNew: [],
    currentVersion: idle.currentVersion,
};

function setUp(
    initial: UpdaterState = idle,
    { old = false }: { old?: boolean } = {},
): {
    api: { [K in keyof Required<UpdaterApi>]: ReturnType<typeof vi.fn> };
    push: (state: UpdaterState) => void;
    unsubscribe: ReturnType<typeof vi.fn>;
    vm: UpdateRailButtonViewModel;
} {
    const api = {
        getState: vi.fn().mockResolvedValue(initial),
        check: vi.fn().mockResolvedValue({ ...initial, phase: "checking" }),
        install: vi.fn().mockResolvedValue(initial),
        setAutoCheck: vi.fn().mockResolvedValue(initial),
        setUpdateOnLaunch: vi.fn().mockResolvedValue(initial),
        openReleasePage: vi.fn().mockResolvedValue(initial),
        update: vi.fn().mockResolvedValue(initial),
        getNotes: vi.fn().mockResolvedValue(NOTES),
        whatsNewSeen: vi.fn().mockResolvedValue(initial),
        setFastCheck: vi.fn().mockResolvedValue(initial),
        setShowWhatsNew: vi.fn().mockResolvedValue(initial),
        networkOnline: vi.fn().mockResolvedValue(initial),
    };
    let listener: ((state: UpdaterState) => void) | undefined;
    const unsubscribe = vi.fn();
    const given: UpdaterApi = old
        ? {
              getState: api.getState,
              check: api.check,
              install: api.install,
              setAutoCheck: api.setAutoCheck,
              setUpdateOnLaunch: api.setUpdateOnLaunch,
              openReleasePage: api.openReleasePage,
          }
        : api;
    const vm = new UpdateRailButtonViewModel({
        api: given,
        subscribe: (l) => {
            listener = l;
            return unsubscribe;
        },
    });
    return { api, push: (state) => listener?.(state), unsubscribe, vm };
}

const settled = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
};

describe("railStateOf", () => {
    it.each<[string, Partial<UpdaterState>, string]>([
        ["nothing newer is known", { phase: "idle" }, "hidden"],
        ["a check that knows of nothing yet", { phase: "checking" }, "hidden"],
        ["a check that failed", { phase: "error", error: "offline" }, "hidden"],
        ["a release known and not on its way", { phase: "checking", latestVersion: NEW }, "available"],
        ["a download", { phase: "downloading", latestVersion: NEW }, "downloading"],
        ["the checksum", { phase: "verifying", latestVersion: NEW }, "preparing"],
        ["unpacking", { phase: "unpacking", latestVersion: NEW }, "preparing"],
        ["an update that is ready", { phase: "ready", latestVersion: NEW }, "ready"],
        ["the restart", { phase: "installing", latestVersion: NEW }, "installing"],
        ["a release this install cannot put in place", { phase: "manual", latestVersion: NEW }, "manual"],
        ["a download that failed", { phase: "error", latestVersion: NEW, error: "checksum" }, "failed"],
        ["an app that cannot update", { supported: false, phase: "ready", latestVersion: NEW }, "hidden"],
    ])("for %s", (_name, state, expected) => {
        expect(railStateOf({ ...idle, ...state })).toBe(expected);
    });
});

describe("UpdateRailButtonViewModel", () => {
    it("is hidden in a browser, and while the app is up to date", async () => {
        const web = new UpdateRailButtonViewModel({ api: undefined });
        expect(web.getSnapshot()).toEqual({ state: "hidden", installWhenReady: false, notes: [] });
        web.onUpdate();
        web.onOpenReleasePage();
        web.dispose();

        const { vm, api } = setUp(idle);
        await settled();
        expect(vm.getSnapshot()).toEqual({
            state: "hidden",
            version: undefined,
            percent: undefined,
            installWhenReady: false,
            notes: [],
        });
        expect(api.getNotes).not.toHaveBeenCalled();
    });

    it("shows an update that was ready before the window listened, with what is new in it", async () => {
        const { vm, api } = setUp(ready);
        await settled();
        expect(vm.getSnapshot()).toEqual({
            state: "ready",
            version: NEW,
            percent: undefined,
            installWhenReady: false,
            notes: [
                { version: NEW, body: "- Newest" },
                { version: "1.12.35-intercom.12", body: "- Older" },
            ],
        });
        expect(api.getNotes).toHaveBeenCalledTimes(1);
    });

    it("follows the download, and asks for the notes once per release", async () => {
        const { vm, api, push } = setUp(idle);
        await settled();
        const downloading: UpdaterState = { ...idle, phase: "downloading", latestVersion: NEW, progress: 0 };
        push({ ...downloading, download: { done: 0, total: 0, bytesPerSecond: 0 } });
        expect(vm.getSnapshot()).toMatchObject({ state: "downloading", version: NEW, percent: undefined });
        push({ ...downloading, download: { done: 78_000_000, total: 186_000_000, bytesPerSecond: 12_000_000 } });
        expect(vm.getSnapshot().percent).toBeCloseTo(41.94, 1);
        push({ ...downloading, download: { done: 186_000_000, total: 186_000_000, bytesPerSecond: 0 } });
        expect(vm.getSnapshot().percent).toBe(100);
        push({ ...idle, phase: "verifying", latestVersion: NEW });
        expect(vm.getSnapshot()).toMatchObject({ state: "preparing", percent: undefined });
        push(ready);
        await settled();
        expect(vm.getSnapshot()).toMatchObject({
            state: "ready",
            notes: [{ version: NEW }, { version: "1.12.35-intercom.12" }],
        });
        expect(api.getNotes).toHaveBeenCalledTimes(1);

        // Installed, or gone: the button and its notes go
        push(idle);
        expect(vm.getSnapshot()).toMatchObject({ state: "hidden", version: undefined, notes: [] });
    });

    it("says that the update installs itself once the click asked for it", async () => {
        const { vm, push } = setUp(idle);
        await settled();
        push({ ...idle, phase: "downloading", latestVersion: NEW, installWhenReady: true });
        expect(vm.getSnapshot().installWhenReady).toBe(true);
        push({ ...idle, phase: "error", latestVersion: NEW, error: "checksum", installWhenReady: false });
        expect(vm.getSnapshot()).toMatchObject({ state: "failed", installWhenReady: false });
    });

    it.each<[string, Partial<UpdaterState>]>([
        ["ready: installs and restarts", { phase: "ready" }],
        ["downloading: installs as soon as it is ready", { phase: "downloading" }],
        ["verifying", { phase: "verifying" }],
        ["available: starts the download, then installs", { phase: "checking" }],
        ["failed: tries again", { phase: "error", error: "checksum" }],
        ["manual: the release page", { phase: "manual" }],
    ])("hands the click to the desktop app, which knows what follows (%s)", async (_name, state) => {
        const { vm, api } = setUp({ ...idle, latestVersion: NEW, ...state });
        await settled();
        vm.onUpdate();
        expect(api.update).toHaveBeenCalledTimes(1);
        expect(api.install).not.toHaveBeenCalled();
        expect(api.check).not.toHaveBeenCalled();
    });

    it("shows what the click changed at once", async () => {
        const downloading: UpdaterState = { ...idle, phase: "downloading", latestVersion: NEW };
        const { vm, api } = setUp(downloading);
        await settled();
        api.update.mockResolvedValue({ ...downloading, installWhenReady: true });
        vm.onUpdate();
        await settled();
        expect(vm.getSnapshot()).toMatchObject({ state: "downloading", installWhenReady: true });
    });

    it("installs what is ready, and looks again otherwise, with a desktop app that has no such click", async () => {
        const first = setUp(ready, { old: true });
        await settled();
        first.vm.onUpdate();
        expect(first.api.install).toHaveBeenCalledTimes(1);
        expect(first.vm.getSnapshot().notes).toEqual([]);

        const second = setUp({ ...idle, phase: "error", latestVersion: NEW, error: "x" }, { old: true });
        await settled();
        second.vm.onUpdate();
        expect(second.api.check).toHaveBeenCalledTimes(1);
        expect(second.api.install).not.toHaveBeenCalled();

        const third = setUp({ ...idle, phase: "manual", latestVersion: NEW }, { old: true });
        await settled();
        third.vm.onUpdate();
        expect(third.api.openReleasePage).toHaveBeenCalledTimes(1);
    });

    it("opens the release page, and stops listening when disposed", async () => {
        const { vm, api, push, unsubscribe } = setUp(ready);
        await settled();
        vm.onOpenReleasePage();
        expect(api.openReleasePage).toHaveBeenCalledTimes(1);
        vm.dispose();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        push(idle);
        expect(vm.getSnapshot().state).toBe("ready");
    });
});
