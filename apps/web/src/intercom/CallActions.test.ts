/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    CALL_ACTION_WIDGET_ACTION,
    callActionForKey,
    installCallShortcuts,
    isCallAction,
    performCallAction,
} from "./CallActions";
import { type Call } from "../models/Call";

// The stores drag the whole app in; all that matters here is which calls are on and how each is reached
const { state } = vi.hoisted(() => ({
    state: { calls: [] as { call: unknown; send: unknown }[] },
}));
vi.mock("../stores/CallStore", () => ({
    CallStore: {
        instance: {
            get connectedCalls(): Set<unknown> {
                return new Set(state.calls.map((c) => c.call));
            },
        },
    },
}));
vi.mock("../stores/widgets/WidgetMessagingStore", () => ({
    WidgetMessagingStore: {
        instance: {
            getMessagingForUid: (uid: string): unknown => {
                const found = state.calls.find((c) => uid === `uid:${(c.call as Call).widget.id}`);
                return found && { widgetApi: { transport: { send: found.send } } };
            },
        },
    },
}));
vi.mock("../utils/WidgetUtils", () => ({
    default: { getWidgetUid: (widget: { id: string }): string => `uid:${widget.id}` },
}));

function fakeCall(id: string): { call: Call; send: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> } {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue({});
    const call = { widget: { id, roomId: "!room:example.org" }, disconnect } as unknown as Call;
    return { call, send, disconnect };
}

describe("call actions", () => {
    let calls: ReturnType<typeof fakeCall>[];
    const setCalls = (next: ReturnType<typeof fakeCall>[]): void => {
        calls = next;
        state.calls = next;
    };
    beforeEach(() => setCalls([]));
    afterEach(() => setCalls([]));

    it("knows the actions and nothing else", () => {
        for (const action of ["toggle-mute", "mute", "unmute", "toggle-deafen", "toggle-camera", "leave-call"]) {
            expect(isCallAction(action)).toBe(true);
        }
        for (const other of ["", "quit", "TOGGLE-MUTE", 5, null, undefined, {}])
            expect(isCallAction(other)).toBe(false);
    });

    it("reads Ctrl+Shift+M, D and V and no other combination", () => {
        const key = (
            key: string,
            mods: Partial<KeyboardEventInit> = { ctrlKey: true, shiftKey: true },
        ): KeyboardEvent => new KeyboardEvent("keydown", { key, ...mods });
        expect(callActionForKey(key("M"))).toBe("toggle-mute");
        expect(callActionForKey(key("d"))).toBe("toggle-deafen");
        expect(callActionForKey(key("V"))).toBe("toggle-camera");
        expect(callActionForKey(key("x"))).toBeUndefined();
        expect(callActionForKey(key("d", { ctrlKey: true }))).toBeUndefined();
        expect(callActionForKey(key("d", { ctrlKey: true, altKey: true }))).toBeUndefined();
        expect(callActionForKey(key("d", { ctrlKey: true, shiftKey: true, altKey: true }))).toBeUndefined();
        expect(callActionForKey(key("m", { ctrlKey: true, shiftKey: true, metaKey: true }))).toBeUndefined();
    });

    it("passes mute, deafen and camera to the call's widget", async () => {
        setCalls([fakeCall("call1")]);
        for (const action of ["toggle-mute", "mute", "unmute", "toggle-deafen", "toggle-camera"]) {
            expect(await performCallAction(action, "test")).toBe(1);
            expect(calls[0].send).toHaveBeenLastCalledWith(CALL_ACTION_WIDGET_ACTION, { action });
        }
        expect(calls[0].disconnect).not.toHaveBeenCalled();
    });

    it("leaves the call by disconnecting it", async () => {
        setCalls([fakeCall("call1")]);
        expect(await performCallAction("leave-call", "test")).toBe(1);
        expect(calls[0].disconnect).toHaveBeenCalled();
        expect(calls[0].send).not.toHaveBeenCalled();
    });

    it("does nothing without a call, and nothing for what is not an action", async () => {
        expect(await performCallAction("toggle-mute", "test")).toBe(0);
        setCalls([fakeCall("call1")]);
        for (const bogus of ["quit", "", undefined, null, { action: "mute" }]) {
            expect(await performCallAction(bogus, "test")).toBe(0);
        }
        expect(calls[0].send).not.toHaveBeenCalled();
        expect(calls[0].disconnect).not.toHaveBeenCalled();
    });

    it("carries on past a call whose widget refuses", async () => {
        setCalls([fakeCall("call1"), fakeCall("call2")]);
        calls[0].send.mockRejectedValue(new Error("Unknown or unsupported action"));
        expect(await performCallAction("toggle-mute", "test")).toBe(1);
        expect(calls[1].send).toHaveBeenCalled();
    });

    describe("the shortcuts on the app's page", () => {
        let remove: () => void;
        beforeEach(() => (remove = installCallShortcuts()));
        afterEach(() => remove());

        const press = (key: string, mods: KeyboardEventInit = { ctrlKey: true, shiftKey: true }): KeyboardEvent => {
            const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
            document.body.dispatchEvent(ev);
            return ev;
        };

        it("act on the call and keep the key from the app while a call is on", async () => {
            setCalls([fakeCall("call1")]);
            const appBinding = vi.fn();
            document.body.addEventListener("keydown", appBinding);
            const ev = press("D");
            document.body.removeEventListener("keydown", appBinding);
            expect(ev.defaultPrevented).toBe(true);
            expect(appBinding).not.toHaveBeenCalled();
            await vi.waitFor(() =>
                expect(calls[0].send).toHaveBeenCalledWith(CALL_ACTION_WIDGET_ACTION, { action: "toggle-deafen" }),
            );
        });

        it("leave the keys alone outside a call", () => {
            const appBinding = vi.fn();
            document.body.addEventListener("keydown", appBinding);
            const ev = press("D");
            document.body.removeEventListener("keydown", appBinding);
            expect(ev.defaultPrevented).toBe(false);
            expect(appBinding).toHaveBeenCalled();
        });

        it("leave other keys alone in a call, and a held key acts once", async () => {
            setCalls([fakeCall("call1")]);
            expect(press("k").defaultPrevented).toBe(false);
            expect(press("m", { ctrlKey: true }).defaultPrevented).toBe(false);
            press("M");
            press("M", { ctrlKey: true, shiftKey: true, repeat: true });
            await vi.waitFor(() => expect(calls[0].send).toHaveBeenCalled());
            expect(calls[0].send).toHaveBeenCalledTimes(1);
        });

        it("are gone once removed", () => {
            setCalls([fakeCall("call1")]);
            remove();
            expect(press("M").defaultPrevented).toBe(false);
        });
    });
});
