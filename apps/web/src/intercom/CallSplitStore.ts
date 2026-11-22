/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";

/**
 * How the call of the room being viewed is laid out: over the room's timeline, with a divider
 * that can be dragged ("split", the default), or filling the room as Element shows it ("full").
 * What the user chose is kept in this profile's local storage.
 */

const MODE_KEY = "intercom_call_view_mode";
const HEIGHT_KEY = "intercom_call_split_height";
const COLLAPSED_KEY = "intercom_call_split_collapsed";

/** The call is never smaller than this, unless it is collapsed. */
export const CALL_SPLIT_MIN_HEIGHT = 160;
/** What is left to the timeline and the composer under the call. */
export const CALL_SPLIT_MIN_CHAT_HEIGHT = 200;
/** The share of the room the call takes until the divider has been moved. */
export const CALL_SPLIT_DEFAULT_SHARE = 0.56;

export type CallViewMode = "split" | "full";

export enum CallSplitStoreEvent {
    Mode = "mode",
    Layout = "layout",
}

type Handlers = {
    [CallSplitStoreEvent.Mode]: (mode: CallViewMode) => void;
    [CallSplitStoreEvent.Layout]: () => void;
};

function read(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function write(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // Not kept, then
    }
}

/**
 * The height the call gets in a room of `available` pixels: what was asked for, within what
 * leaves room for the chat. A room too low for both gives the call what the chat can spare.
 */
export function clampCallHeight(wanted: number, available: number): number {
    const max = Math.max(CALL_SPLIT_MIN_HEIGHT, available - CALL_SPLIT_MIN_CHAT_HEIGHT);
    if (!Number.isFinite(wanted)) return max;
    return Math.round(Math.min(max, Math.max(CALL_SPLIT_MIN_HEIGHT, wanted)));
}

export class CallSplitStore extends TypedEventEmitter<CallSplitStoreEvent, Handlers> {
    private static internalInstance?: CallSplitStore;

    public static get instance(): CallSplitStore {
        CallSplitStore.internalInstance ??= new CallSplitStore();
        return CallSplitStore.internalInstance;
    }

    public get mode(): CallViewMode {
        return read(MODE_KEY) === "full" ? "full" : "split";
    }

    public setMode(mode: CallViewMode): void {
        if (mode === this.mode) return;
        write(MODE_KEY, mode);
        this.emit(CallSplitStoreEvent.Mode, mode);
    }

    /** The height the user gave the call, or undefined while the divider has never been moved. */
    public get height(): number | undefined {
        const stored = Number.parseInt(read(HEIGHT_KEY) ?? "", 10);
        return Number.isFinite(stored) && stored > 0 ? stored : undefined;
    }

    public setHeight(height: number): void {
        write(HEIGHT_KEY, String(Math.round(height)));
        this.emit(CallSplitStoreEvent.Layout);
    }

    /** Whether the call is folded away to its bar, leaving the room to the chat. */
    public get collapsed(): boolean {
        return read(COLLAPSED_KEY) === "1";
    }

    public setCollapsed(collapsed: boolean): void {
        if (collapsed === this.collapsed) return;
        write(COLLAPSED_KEY, collapsed ? "1" : "0");
        this.emit(CallSplitStoreEvent.Layout);
    }

    /** Lets go of everyone listening. */
    public destroy(): void {
        this.removeAllListeners();
    }
}
