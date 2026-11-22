/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, describe, expect, it, vi } from "vitest";
import { type ClientWidgetApi } from "matrix-widget-api";

import { attachShareAudioBridge, isBundledElementCall, SHARE_AUDIO_ACTION } from "./ShareAudioBridge";

const HOST = "vector://vector/webapp/";
const BUNDLED = "vector://vector/webapp/widgets/element-call/index.html?widgetId=1#/?roomId=!a";

/** As much of an event emitter as the bridge uses of the widget API. */
function fakeApi(): ClientWidgetApi & { reply: ReturnType<typeof vi.fn> } {
    const listeners = new Map<string, Set<(ev: unknown) => void>>();
    const reply = vi.fn();
    return {
        on: (event: string, listener: (ev: unknown) => void) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)!.add(listener);
        },
        off: (event: string, listener: (ev: unknown) => void) => listeners.get(event)?.delete(listener),
        emit: (event: string, ev: unknown) => listeners.get(event)?.forEach((listener) => listener(ev)),
        transport: { reply },
        reply,
    } as unknown as ClientWidgetApi & { reply: ReturnType<typeof vi.fn> };
}

async function request(api: ClientWidgetApi, data: object): Promise<{ prevented: boolean; detail: object }> {
    const detail = { action: SHARE_AUDIO_ACTION, data };
    const ev = { detail, preventDefault: vi.fn() };
    api.emit(`action:${SHARE_AUDIO_ACTION}`, ev as unknown as CustomEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { prevented: ev.preventDefault.mock.calls.length > 0, detail };
}

function fakeShareAudio(): NonNullable<NonNullable<Window["electron"]>["intercomShareAudio"]> {
    return {
        listSinks: vi.fn().mockResolvedValue({ supported: true, sinks: [] }),
        prepareShareSource: vi
            .fn()
            .mockResolvedValue({ sourceName: "intercom-share-a", description: "InterCom share: A", reused: false }),
        releaseShareSource: vi.fn().mockResolvedValue(undefined),
    };
}

describe("isBundledElementCall", () => {
    it("knows the Element Call build inside the app", () => {
        expect(isBundledElementCall(BUNDLED, HOST)).toBe(true);
        expect(
            isBundledElementCall("https://app.example/widgets/element-call/?a=1", "https://app.example/#/room"),
        ).toBe(true);
    });
    it.each([
        "https://call.element.io/room",
        "https://evil.example/webapp/widgets/element-call/index.html",
        "vector://vector/webapp/widgets/jitsi.html",
        "vector://vector/webapp/widgets/element-call/../jitsi.html",
        "not a url",
    ])("refuses %s", (url) => expect(isBundledElementCall(url, HOST)).toBe(false));
});

describe("attachShareAudioBridge", () => {
    const location = window.location;
    function setUp(shareAudio = fakeShareAudio()): typeof shareAudio {
        window.electron = { intercomShareAudio: shareAudio } as unknown as Window["electron"];
        Object.defineProperty(window, "location", { value: new URL(HOST), configurable: true });
        return shareAudio;
    }
    afterEach(() => {
        delete window.electron;
        Object.defineProperty(window, "location", { value: location, configurable: true });
    });

    it("answers the bundled call widget from the desktop app", async () => {
        const shareAudio = setUp();
        const api = fakeApi();
        attachShareAudioBridge(api, BUNDLED);

        const list = await request(api, { op: "list" });
        expect(list.prevented).toBe(true);
        expect(api.reply).toHaveBeenLastCalledWith(list.detail, { supported: true, sinks: [] });

        const prepare = await request(api, { op: "prepare", sink: "a" });
        expect(shareAudio.prepareShareSource).toHaveBeenCalledWith("a");
        expect(api.reply).toHaveBeenLastCalledWith(prepare.detail, {
            sourceName: "intercom-share-a",
            description: "InterCom share: A",
            reused: false,
        });

        await request(api, { op: "release", sink: "a" });
        expect(shareAudio.releaseShareSource).toHaveBeenLastCalledWith("a");
        const release = await request(api, { op: "release" });
        expect(shareAudio.releaseShareSource).toHaveBeenLastCalledWith(undefined);
        expect(api.reply).toHaveBeenLastCalledWith(release.detail, {});
    });

    it("answers a failure and a malformed request with an error", async () => {
        const shareAudio = setUp();
        vi.mocked(shareAudio.prepareShareSource).mockRejectedValue(new Error("No such sink"));
        const api = fakeApi();
        attachShareAudioBridge(api, BUNDLED);

        const failed = await request(api, { op: "prepare", sink: "nope" });
        expect(api.reply).toHaveBeenLastCalledWith(failed.detail, { error: { message: "No such sink" } });
        const noSink = await request(api, { op: "prepare", sink: 5 });
        expect(api.reply).toHaveBeenLastCalledWith(noSink.detail, { error: { message: "No sink given" } });
        const unknown = await request(api, { op: "exec" });
        expect(api.reply).toHaveBeenLastCalledWith(unknown.detail, {
            error: { message: "Unknown share audio operation" },
        });
        expect(shareAudio.prepareShareSource).toHaveBeenCalledTimes(1);
    });

    it("leaves the action unknown for any other widget", async () => {
        const shareAudio = setUp();
        const api = fakeApi();
        attachShareAudioBridge(api, "https://evil.example/widgets/element-call/index.html");
        expect((await request(api, { op: "list" })).prevented).toBe(false);
        expect(shareAudio.listSinks).not.toHaveBeenCalled();
        expect(api.reply).not.toHaveBeenCalled();
    });

    it("leaves the action unknown outside the desktop app", async () => {
        Object.defineProperty(window, "location", { value: new URL(HOST), configurable: true });
        const api = fakeApi();
        attachShareAudioBridge(api, BUNDLED);
        expect((await request(api, { op: "list" })).prevented).toBe(false);
    });

    it("lets go of the share's source when the widget stops, if it made one", async () => {
        const shareAudio = setUp();
        const idle = fakeApi();
        attachShareAudioBridge(idle, BUNDLED)();
        expect(shareAudio.releaseShareSource).not.toHaveBeenCalled();

        const api = fakeApi();
        const detach = attachShareAudioBridge(api, BUNDLED);
        await request(api, { op: "prepare", sink: "a" });
        detach();
        expect(shareAudio.releaseShareSource).toHaveBeenCalledTimes(1);
        expect(shareAudio.releaseShareSource).toHaveBeenLastCalledWith();
        expect((await request(api, { op: "list" })).prevented).toBe(false);
    });
});
