/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";

import { startWhatsNew, tellUpdaterWhenOnline } from "./WhatsNew";
import { type UpdaterApi, type UpdaterNotes, type UpdaterState } from "./Updater";

const V = "1.12.35-intercom.13";
const state: UpdaterState = { supported: true, currentVersion: V, autoCheck: true, channel: "stable", phase: "idle" };
const note = (version: string): UpdaterNotes["whatsNew"][number] => ({
    version,
    body: `- Notes of ${version}`,
    url: `https://github.com/c4g7-dev/InterCom/releases/tag/v${version}`,
});
const NEW: UpdaterNotes = { pending: [], whatsNew: [note(V), note("1.12.35-intercom.12")], currentVersion: V };
const NOTHING: UpdaterNotes = { pending: [], whatsNew: [], currentVersion: V };

function setUp(notes: UpdaterNotes): {
    api: UpdaterApi & { getNotes: ReturnType<typeof vi.fn>; whatsNewSeen: ReturnType<typeof vi.fn> };
    push: (state: UpdaterState) => void;
    show: ReturnType<typeof vi.fn>;
    dismiss: () => void;
    ready: () => void;
    stop: () => void;
} {
    const api = {
        getState: vi.fn().mockResolvedValue(state),
        check: vi.fn(),
        install: vi.fn(),
        setAutoCheck: vi.fn(),
        setUpdateOnLaunch: vi.fn(),
        openReleasePage: vi.fn(),
        getNotes: vi.fn().mockResolvedValue(notes),
        whatsNewSeen: vi.fn().mockResolvedValue(state),
    };
    let listener: ((state: UpdaterState) => void) | undefined;
    let dismiss!: () => void;
    let ready!: () => void;
    const show = vi.fn(() => new Promise<void>((resolve) => (dismiss = resolve)));
    const stop = startWhatsNew(
        api,
        (l) => {
            listener = l;
            return () => (listener = undefined);
        },
        show,
        (callback) => (ready = callback),
    );
    return { api, push: (s) => listener?.(s), show, dismiss: () => dismiss(), ready: () => ready(), stop };
}

const settled = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe("startWhatsNew", () => {
    it("shows what is new once the app is up, and remembers it when it is put away", async () => {
        const { api, show, dismiss, ready, push } = setUp(NEW);
        await settled();
        // Not over the sign-in or the loading screen
        expect(api.getNotes).not.toHaveBeenCalled();
        ready();
        await settled();
        expect(show).toHaveBeenCalledTimes(1);
        expect(show).toHaveBeenCalledWith(V, NEW.whatsNew);
        // Seen only when the user put it away
        expect(api.whatsNewSeen).not.toHaveBeenCalled();
        dismiss();
        await settled();
        expect(api.whatsNewSeen).toHaveBeenCalledTimes(1);

        // Once: later checks do not bring it back
        push({ ...state, lastChecked: 5 });
        push({ ...state, lastChecked: 9 });
        await settled();
        expect(show).toHaveBeenCalledTimes(1);
    });

    it("shows nothing when there is nothing new, and does not mark anything", async () => {
        const { api, show, ready } = setUp(NOTHING);
        ready();
        await settled();
        expect(api.getNotes).toHaveBeenCalledTimes(1);
        expect(show).not.toHaveBeenCalled();
        expect(api.whatsNewSeen).not.toHaveBeenCalled();
    });

    it("asks again after a check, for notes that were not there at the start", async () => {
        const { api, show, ready, push } = setUp(NOTHING);
        ready();
        await settled();
        // The same check told twice is one question
        api.getNotes.mockResolvedValue(NEW);
        push({ ...state, phase: "checking" });
        await settled();
        expect(api.getNotes).toHaveBeenCalledTimes(1);
        push({ ...state, lastChecked: 1000 });
        push({ ...state, lastChecked: 1000 });
        await settled();
        expect(api.getNotes).toHaveBeenCalledTimes(2);
        expect(show).toHaveBeenCalledTimes(1);
    });

    it("does nothing in a browser, with a desktop app that has no notes, or once stopped", async () => {
        expect(startWhatsNew(undefined)).toBeInstanceOf(Function);
        const old = { getState: vi.fn() } as unknown as UpdaterApi;
        const subscribe = vi.fn();
        startWhatsNew(old, subscribe, vi.fn(), vi.fn());
        expect(subscribe).not.toHaveBeenCalled();

        const { show, ready, stop } = setUp(NEW);
        stop();
        ready();
        await settled();
        expect(show).not.toHaveBeenCalled();
    });

    it("survives a desktop app that fails to answer", async () => {
        const { api, show, ready, push } = setUp(NEW);
        api.getNotes.mockRejectedValueOnce(new Error("gone"));
        ready();
        await settled();
        expect(show).not.toHaveBeenCalled();
        push({ ...state, lastChecked: 1 });
        await settled();
        expect(show).toHaveBeenCalledTimes(1);
    });
});

describe("tellUpdaterWhenOnline", () => {
    it("tells the desktop app when the network is back, until stopped", () => {
        const target = new EventTarget();
        const api = { networkOnline: vi.fn().mockResolvedValue(state) } as unknown as UpdaterApi;
        const stop = tellUpdaterWhenOnline(api, target as unknown as Window);
        target.dispatchEvent(new Event("online"));
        target.dispatchEvent(new Event("offline"));
        expect(api.networkOnline).toHaveBeenCalledTimes(1);
        stop();
        target.dispatchEvent(new Event("online"));
        expect(api.networkOnline).toHaveBeenCalledTimes(1);
    });

    it("does nothing where the desktop app cannot be told", () => {
        const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
        tellUpdaterWhenOnline(undefined, target)();
        tellUpdaterWhenOnline({} as UpdaterApi, target)();
        expect(target.addEventListener).not.toHaveBeenCalled();
    });
});
