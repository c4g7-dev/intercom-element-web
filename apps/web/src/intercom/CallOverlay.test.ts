/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CallOverlayController, type OverlayEnvironment } from "./CallOverlay";

type Listener = (ev: unknown) => void;

function setup(options: { canOverlay?: boolean } = {}): {
    controller: CallOverlayController;
    env: OverlayEnvironment & { innerSize: (w: number, h: number) => void };
    told: Record<string, unknown>[];
    fire: (type: string, ev?: Record<string, unknown>) => void;
    overlay: () => boolean;
    listening: () => string[];
    focusFrame: ReturnType<typeof vi.fn>;
    app: HTMLElement;
    dialog: HTMLElement;
} {
    const listeners = new Map<string, Set<Listener>>();
    const add = (type: string, listener: unknown): void => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener as Listener);
    };
    const remove = (type: string, listener: unknown): void => {
        listeners.get(type)?.delete(listener as Listener);
    };
    let overlay = false;
    let size = { innerWidth: 1280, innerHeight: 800 };
    const app = document.createElement("button");
    const dialog = document.createElement("button");
    document.body.append(app, dialog);
    const focusFrame = vi.fn();
    const told: Record<string, unknown>[] = [];
    const env = {
        setOverlay: vi.fn((on: boolean) => {
            if (on && options.canOverlay === false) return false;
            overlay = on;
            return true;
        }),
        rect: () => ({ x: 300, y: 48, width: 700, height: 320 }),
        window: {
            get innerWidth() {
                return size.innerWidth;
            },
            get innerHeight() {
                return size.innerHeight;
            },
            addEventListener: add,
            removeEventListener: remove,
        },
        document: {
            addEventListener: add,
            removeEventListener: remove,
            get activeElement() {
                return document.activeElement;
            },
        },
        focusFrame,
        isCovered: (element: Element) => element === app,
        innerSize: (w: number, h: number) => (size = { innerWidth: w, innerHeight: h }),
    } as unknown as OverlayEnvironment & { innerSize: (w: number, h: number) => void };
    return {
        controller: new CallOverlayController(env, (data) => told.push(data)),
        env,
        told,
        fire: (type, ev = {}) => listeners.get(type)?.forEach((listener) => listener(ev)),
        overlay: () => overlay,
        listening: () => [...listeners].filter(([, set]) => set.size > 0).map(([type]) => type),
        focusFrame,
        app,
        dialog,
    };
}

describe("the call's overlay over the window", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("gives the frame the window and says where the call belongs", () => {
        const t = setup();
        expect(t.controller.handle({ op: "open" })).toEqual({
            supported: true,
            rect: { x: 300, y: 48, width: 700, height: 320 },
            window: { width: 1280, height: 800 },
        });
        expect(t.overlay()).toBe(true);
        expect(t.controller.isOpen).toBe(true);
        // The keyboard is the dialog's
        expect(t.focusFrame).toHaveBeenCalledTimes(1);
        expect(t.listening().sort()).toEqual(["focusin", "keydown", "resize"]);
    });

    it("takes the window back, puts the focus back and stops listening", () => {
        const t = setup();
        t.app.focus();
        t.controller.handle({ op: "open" });
        t.dialog.focus();
        expect(t.controller.handle({ op: "close" })).toEqual({});
        expect(t.overlay()).toBe(false);
        expect(t.controller.isOpen).toBe(false);
        expect(document.activeElement).toBe(t.app);
        expect(t.listening()).toEqual([]);
        // Closing what is closed is nothing
        t.controller.handle({ op: "close" });
        expect(t.env.setOverlay).toHaveBeenCalledTimes(2);
    });

    it("opens once for dialogs within dialogs, and answers each with the place", () => {
        const t = setup();
        t.controller.handle({ op: "open" });
        expect(t.controller.handle({ op: "open" })).toMatchObject({ supported: true });
        expect(t.env.setOverlay).toHaveBeenCalledTimes(1);
        expect(t.focusFrame).toHaveBeenCalledTimes(1);
    });

    it("says so where the frame cannot have the window: a call in a window of its own", () => {
        const t = setup({ canOverlay: false });
        expect(t.controller.handle({ op: "open" })).toEqual({ supported: false });
        expect(t.controller.isOpen).toBe(false);
        expect(t.listening()).toEqual([]);
    });

    it("tells the call when the window is resized", () => {
        const t = setup();
        t.controller.handle({ op: "open" });
        t.env.innerSize(1000, 700);
        t.fire("resize");
        expect(t.told).toEqual([
            {
                op: "layout",
                supported: true,
                rect: { x: 300, y: 48, width: 700, height: 320 },
                window: { width: 1000, height: 700 },
            },
        ]);
        t.controller.handle({ op: "close" });
        t.fire("resize");
        expect(t.told).toHaveLength(1);
    });

    it("passes Escape pressed on the app on to the call, and leaves the app's own dialogs theirs", () => {
        const t = setup();
        t.controller.handle({ op: "open" });
        const onApp = { key: "Escape", target: t.app, preventDefault: vi.fn(), stopPropagation: vi.fn() };
        t.fire("keydown", onApp);
        expect(t.told).toEqual([{ op: "dismiss" }]);
        expect(onApp.preventDefault).toHaveBeenCalled();
        expect(onApp.stopPropagation).toHaveBeenCalled();

        const onDialog = { key: "Escape", target: t.dialog, preventDefault: vi.fn(), stopPropagation: vi.fn() };
        t.fire("keydown", onDialog);
        const other = { key: "a", target: t.app, preventDefault: vi.fn(), stopPropagation: vi.fn() };
        t.fire("keydown", other);
        expect(t.told).toHaveLength(1);
        expect(onDialog.preventDefault).not.toHaveBeenCalled();
        expect(other.preventDefault).not.toHaveBeenCalled();
    });

    it("keeps the focus off what the dialog covers", () => {
        const t = setup();
        t.controller.handle({ op: "open" });
        t.fire("focusin", { target: t.app });
        expect(t.focusFrame).toHaveBeenCalledTimes(2);
        // A dialog of the app above the call keeps its focus
        t.fire("focusin", { target: t.dialog });
        expect(t.focusFrame).toHaveBeenCalledTimes(2);
    });

    it("tells the call when the window was taken from it", () => {
        const t = setup();
        t.controller.handle({ op: "open" });
        t.controller.revoke();
        expect(t.controller.isOpen).toBe(false);
        expect(t.told).toEqual([{ op: "layout", supported: false }]);
        // Not open: nothing to revoke, nothing to tell
        t.controller.revoke();
        expect(t.told).toHaveLength(1);
    });

    it("refuses what it does not know", () => {
        const t = setup();
        expect(() => t.controller.handle({ op: "maximise" })).toThrow();
        expect(() => t.controller.handle(null)).toThrow();
    });
});
