/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";

import {
    handleVoiceStatePayload,
    onVoiceTrayChange,
    parseVoiceStatePayload,
    voiceTrayItems,
} from "./intercom-voice-state.js";

vi.mock("electron", () => ({ ipcMain: { on: vi.fn() } }));
vi.mock("./intercom-call-actions.js", () => ({ sendCallAction: vi.fn() }));

const labels = { mute: "Mute", deafen: "Deafen" };

describe("the tray's mute and deafen", () => {
    it("reads the web app's message and nothing else", () => {
        expect(parseVoiceStatePayload({ action: "intercom_voice_state", muted: true, deafened: false })).toEqual({
            muted: true,
            deafened: false,
        });
        // Deafened is muted
        expect(parseVoiceStatePayload({ action: "intercom_voice_state", deafened: true })).toEqual({
            muted: true,
            deafened: true,
        });
        for (const other of [undefined, null, "x", { action: "call_state", state: "connected" }, {}]) {
            expect(parseVoiceStatePayload(other)).toBeUndefined();
        }
    });

    it("has no entries before the web app said how things stand", () => {
        expect(voiceTrayItems(labels, undefined)).toEqual([]);
    });

    it("checks what is on, and a click asks for the toggle", () => {
        const perform = vi.fn();
        const items = voiceTrayItems(labels, { muted: true, deafened: false }, perform);
        const [mute, deafen] = items.filter((item) => item.type === "checkbox");
        expect(mute).toMatchObject({ label: "Mute", checked: true });
        expect(deafen).toMatchObject({ label: "Deafen", checked: false });
        (mute.click as () => void)();
        (deafen.click as () => void)();
        expect(perform.mock.calls).toEqual([["toggle-mute"], ["toggle-deafen"]]);
    });

    it("has the menu built anew when the state changed, and only then", () => {
        const rebuild = vi.fn();
        onVoiceTrayChange(rebuild);
        handleVoiceStatePayload({ action: "intercom_voice_state", muted: true, deafened: false });
        handleVoiceStatePayload({ action: "intercom_voice_state", muted: true, deafened: false });
        handleVoiceStatePayload({ action: "call_state", state: "connected" });
        expect(rebuild).toHaveBeenCalledTimes(1);
        expect(voiceTrayItems(labels).find((item) => item.label === "Mute")?.checked).toBe(true);
        handleVoiceStatePayload({ action: "intercom_voice_state", muted: false, deafened: false });
        expect(rebuild).toHaveBeenCalledTimes(2);
        onVoiceTrayChange(undefined);
    });
});
