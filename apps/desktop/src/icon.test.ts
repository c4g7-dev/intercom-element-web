/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { expect, describe, it, beforeEach, vi } from "vitest";
import { fs as memfs, vol } from "memfs";

import { getIconPath, getTrayIconPath } from "./icon.js";
import { fileURLToPath } from "node:url";

vi.mock("node:fs/promises", () => ({ default: memfs.promises }));

beforeEach(() => {
    // Reset the state of the in-memory fs
    vol.reset();
});

describe("getIconPath", () => {
    beforeEach(() => {
        vol.fromJSON(
            {
                "build/icon.png": "png",
                "build/icon.ico": "ico",
            },
            fileURLToPath(import.meta.resolve("../webapp")),
        );
    });

    it("should use .ico on Windows", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("win32");
        await expect(getIconPath()).resolves.toEqual(fileURLToPath(import.meta.resolve("../build/icon.ico")));
    });
    it("should use .png on macOS", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
        await expect(getIconPath()).resolves.toEqual(fileURLToPath(import.meta.resolve("../build/icon.png")));
    });
    it("should use .png on Linux", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        await expect(getIconPath()).resolves.toEqual(fileURLToPath(import.meta.resolve("../build/icon.png")));
    });
});

describe("getTrayIconPath", () => {
    const build = (file: string): string => fileURLToPath(import.meta.resolve(`../build/${file}`));

    beforeEach(() => {
        vol.fromJSON(
            { "build/icon.png": "png", "build/icon.ico": "ico" },
            fileURLToPath(import.meta.resolve("../webapp")),
        );
    });

    it("is the white mark on Linux", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        await expect(getTrayIconPath({})).resolves.toEqual(build("tray-mono.png"));
    });
    it("is the app's icon on Linux when asked for colour", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("linux");
        await expect(getTrayIconPath({ INTERCOM_TRAY_ICON: "colour" })).resolves.toEqual(build("icon.png"));
        await expect(getTrayIconPath({ INTERCOM_TRAY_ICON: "color" })).resolves.toEqual(build("icon.png"));
    });
    it("is the app's icon on Windows", async () => {
        vi.spyOn(process, "platform", "get").mockReturnValue("win32");
        await expect(getTrayIconPath({})).resolves.toEqual(build("icon.ico"));
    });
});
