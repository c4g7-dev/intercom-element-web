/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { beforeEach, describe, expect, it, vi } from "vitest";
import { globalShortcut, ipcMain } from "electron";

import {
    areGlobalShortcutsDisabled,
    handleSecondInstanceCallAction,
    initCallShortcuts,
    parseCallAction,
    sendCallAction,
    wantsGlobalShortcuts,
} from "./intercom-call-actions.js";
import { logDiagnostics } from "./intercom-diagnostics.js";

vi.mock("electron", () => ({
    app: { on: vi.fn() },
    ipcMain: { on: vi.fn() },
    globalShortcut: { register: vi.fn().mockReturnValue(true), unregister: vi.fn() },
}));
vi.mock("./intercom-diagnostics.js", () => ({ logDiagnostics: vi.fn() }));

const send = vi.fn();
beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(globalShortcut.register).mockReturnValue(true);
    global.mainWindow = {
        webContents: { send, isDestroyed: () => false },
    } as unknown as typeof global.mainWindow;
});

describe("parseCallAction", () => {
    // What a second instance's command line looks like: the binary, Chromium's own switches, ours
    const base = ["/opt/InterCom/intercom", "--ozone-platform-hint=auto", "--password-store=basic"];

    it.each([
        ["--toggle-mute", "toggle-mute"],
        ["--toggle-deafen", "toggle-deafen"],
        ["--toggle-camera", "toggle-camera"],
        ["--mute", "mute"],
        ["--unmute", "unmute"],
        ["--leave-call", "leave-call"],
    ])("reads %s", (flag, action) => {
        expect(parseCallAction([...base, flag])).toBe(action);
        expect(parseCallAction([flag, ...base])).toBe(action);
    });

    it("takes the first of several", () => {
        expect(parseCallAction([...base, "--mute", "--unmute"])).toBe("mute");
    });

    it.each([
        [[]],
        [base],
        [[...base, "--hidden"]],
        [[...base, "--toggle-mute=1"]],
        [[...base, "--toggle-mutex"]],
        [[...base, "-toggle-mute"]],
        [[...base, "toggle-mute"]],
        [[...base, "--TOGGLE-MUTE"]],
        [[...base, "--mute "]],
        [[...base, "--self-destruct"]],
        [[...base, "intercom://vector/webapp/#/room/!a:b?x=--toggle-mute"]],
        [[...base, "--constructor"]],
        [[...base, "--__proto__"]],
        [[...base, "--toString"]],
        [[null, undefined, 5, {}, ["--mute"]]],
    ])("finds no action in %j", (argv) => {
        expect(parseCallAction(argv as unknown[])).toBeUndefined();
    });

    it("survives a command line that is not one", () => {
        expect(parseCallAction(undefined as unknown as unknown[])).toBeUndefined();
        expect(parseCallAction("--mute" as unknown as unknown[])).toBeUndefined();
    });
});

describe("a second instance's command line", () => {
    it("sends its action to the web app and says it was one", () => {
        expect(handleSecondInstanceCallAction(["intercom", "--toggle-deafen"])).toBe(true);
        expect(send).toHaveBeenCalledWith("intercomCallAction", "toggle-deafen", "command-line");
        expect(logDiagnostics).toHaveBeenCalledWith("call_action", {
            action: "toggle-deafen",
            source: "command-line",
            delivered: true,
        });
    });

    it("leaves every other command line to the usual handling", () => {
        expect(handleSecondInstanceCallAction(["intercom", "--hidden", "--bogus", "intercom://x"])).toBe(false);
        expect(handleSecondInstanceCallAction([])).toBe(false);
        expect(send).not.toHaveBeenCalled();
    });

    it("is still an action when there is no window to tell", () => {
        global.mainWindow = null as unknown as typeof global.mainWindow;
        expect(handleSecondInstanceCallAction(["intercom", "--mute"])).toBe(true);
        expect(sendCallAction("mute", "test")).toBe(false);
        global.mainWindow = {
            webContents: { send, isDestroyed: () => true },
        } as unknown as typeof global.mainWindow;
        expect(sendCallAction("mute", "test")).toBe(false);
        expect(send).not.toHaveBeenCalled();
    });
});

describe("global shortcuts", () => {
    it("are for Windows by default, for Linux through the portal on request, and can be turned off", () => {
        expect(wantsGlobalShortcuts("win32", [], {})).toBe(true);
        expect(wantsGlobalShortcuts("linux", [], {})).toBe(false);
        expect(wantsGlobalShortcuts("linux", ["--global-shortcuts-portal"], {})).toBe(true);
        expect(wantsGlobalShortcuts("darwin", ["--global-shortcuts-portal"], {})).toBe(false);
        expect(wantsGlobalShortcuts("win32", ["--no-global-shortcuts"], {})).toBe(false);
        expect(wantsGlobalShortcuts("win32", [], { INTERCOM_NO_GLOBAL_SHORTCUTS: "1" })).toBe(false);
        expect(areGlobalShortcutsDisabled([], {})).toBe(false);
    });

    function withPlatform(platform: string, run: () => void): void {
        const original = Object.getOwnPropertyDescriptor(process, "platform")!;
        Object.defineProperty(process, "platform", { value: platform });
        try {
            run();
        } finally {
            Object.defineProperty(process, "platform", original);
        }
    }

    it("are held only while a call is on", () => {
        withPlatform("win32", () => {
            initCallShortcuts();
            const onAction = vi.mocked(ipcMain.on).mock.calls[0][1] as (ev: unknown, payload: unknown) => void;
            expect(globalShortcut.register).not.toHaveBeenCalled();

            onAction({}, { action: "call_state", state: "connected" });
            onAction({}, { action: "call_state", state: "connected" });
            expect(vi.mocked(globalShortcut.register).mock.calls.map(([accelerator]) => accelerator)).toEqual([
                "CommandOrControl+Shift+M",
                "CommandOrControl+Shift+D",
            ]);
            vi.mocked(globalShortcut.register).mock.calls[1][1]();
            expect(send).toHaveBeenCalledWith("intercomCallAction", "toggle-deafen", "global-shortcut");

            onAction({}, { action: "something_else" });
            onAction({}, undefined);
            expect(globalShortcut.unregister).not.toHaveBeenCalled();
            onAction({}, { action: "call_state", state: "ended" });
            expect(globalShortcut.unregister).toHaveBeenCalledTimes(2);
        });
    });

    it("are not registered where they are not wanted", () => {
        withPlatform("linux", () => {
            initCallShortcuts();
            expect(ipcMain.on).not.toHaveBeenCalled();
        });
    });

    it("says so where a shortcut is taken, and carries on", () => {
        withPlatform("win32", () => {
            vi.mocked(globalShortcut.register)
                .mockReturnValueOnce(false)
                .mockImplementationOnce(() => {
                    throw new Error("nope");
                });
            initCallShortcuts();
            const onAction = vi.mocked(ipcMain.on).mock.calls[0][1] as (ev: unknown, payload: unknown) => void;
            expect(() => onAction({}, { action: "call_state", state: "connected" })).not.toThrow();
            expect(logDiagnostics).toHaveBeenCalledWith("global_shortcut_unavailable", expect.anything());
        });
    });
});
