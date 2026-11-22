/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app, type BrowserWindow, type Streams } from "electron";

import {
    configureChromium,
    getDisplayMediaAudioCandidates,
    getEnabledFeatures,
    getPopoutWindowResponse,
    grantDisplayMedia,
    isHwVideoDisabled,
    mergeFeatureList,
    setupPopoutWindow,
} from "./intercom.js";

vi.mock("electron", () => ({
    app: {
        getName: vi.fn().mockReturnValue("InterCom"),
        commandLine: {
            appendSwitch: vi.fn(),
            getSwitchValue: vi.fn().mockReturnValue(""),
        },
    },
}));

const source = { id: "screen:1:0", name: "Screen 1" };

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(app.commandLine.getSwitchValue).mockReturnValue("");
});

describe("mergeFeatureList", () => {
    it("should keep the user's features and not duplicate them", () => {
        expect(mergeFeatureList("Foo, Bar:param/1", ["Bar", "Baz"])).toBe("Foo,Bar:param/1,Baz");
    });

    it("should cope with an empty switch", () => {
        expect(mergeFeatureList("", ["Foo"])).toBe("Foo");
    });
});

describe("getEnabledFeatures", () => {
    it("should enable VA-API decode and encode on Linux", () => {
        const features = getEnabledFeatures("linux", ["intercom"], {});
        expect(features).toContain("AcceleratedVideoDecodeLinuxGL");
        expect(features).toContain("AcceleratedVideoEncoder");
        expect(features).toContain("VaapiOnNvidiaGPUs");
        expect(features).not.toContain("AcceleratedVideoDecodeLinuxZeroCopyGL");
    });

    it("should add zero-copy decode only when asked", () => {
        expect(getEnabledFeatures("linux", ["intercom", "--hw-video-zero-copy"], {})).toContain(
            "AcceleratedVideoDecodeLinuxZeroCopyGL",
        );
    });

    it.each([
        ["--no-hw-video", ["intercom", "--no-hw-video"], {}],
        ["INTERCOM_NO_HW_VIDEO", ["intercom"], { INTERCOM_NO_HW_VIDEO: "1" }],
    ])("should enable nothing with %s", (_name, argv, env) => {
        expect(isHwVideoDisabled(argv, env)).toBe(true);
        expect(getEnabledFeatures("linux", argv, env)).toEqual([]);
    });

    it.each(["win32", "darwin"] as const)("should enable nothing on %s", (platform) => {
        expect(getEnabledFeatures(platform, ["intercom"], {})).toEqual([]);
    });
});

describe("configureChromium", () => {
    it("should disable input volume adjustment without dropping the user's disabled features", () => {
        vi.mocked(app.commandLine.getSwitchValue).mockImplementation((name) =>
            name === "disable-features" ? "UserFeature" : "",
        );
        configureChromium();
        expect(app.commandLine.appendSwitch).toHaveBeenCalledWith(
            "disable-features",
            "UserFeature,HardwareMediaKeyHandling,MediaSessionService,WebRtcAllowInputVolumeAdjustment",
        );
    });
});

describe("getDisplayMediaAudioCandidates", () => {
    it("should prefer loopback without our own audio on Windows", () => {
        expect(getDisplayMediaAudioCandidates(source, true, "win32")).toEqual([
            "loopbackWithoutChrome",
            "loopback",
            undefined,
        ]);
    });

    it("should use loopback on macOS", () => {
        expect(getDisplayMediaAudioCandidates(source, true, "darwin")).toEqual(["loopback", undefined]);
    });

    it("should stay video-only on Linux", () => {
        expect(getDisplayMediaAudioCandidates(source, true, "linux")).toEqual([undefined]);
    });

    it("should not add audio which was not requested", () => {
        expect(getDisplayMediaAudioCandidates(source, false, "win32")).toEqual([undefined]);
    });

    it("should not add audio to a cancelled request", () => {
        expect(getDisplayMediaAudioCandidates({ id: "", name: "" }, true, "win32")).toEqual([undefined]);
        expect(getDisplayMediaAudioCandidates(undefined, true, "win32")).toEqual([undefined]);
    });
});

describe("grantDisplayMedia", () => {
    it("should grant video and system audio", () => {
        const callback = vi.fn();
        grantDisplayMedia(callback, source, true, "win32");
        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith({ video: source, audio: "loopbackWithoutChrome" });
    });

    it("should fall back when Electron refuses an audio device", () => {
        const callback = vi.fn((streams: Streams) => {
            if ((streams.audio as string) === "loopbackWithoutChrome") throw new TypeError("Invalid audio");
        });
        grantDisplayMedia(callback, source, true, "win32");
        expect(callback).toHaveBeenLastCalledWith({ video: source, audio: "loopback" });
    });

    it("should grant video only on Linux", () => {
        const callback = vi.fn();
        grantDisplayMedia(callback, source, true, "linux");
        expect(callback).toHaveBeenCalledWith({ video: source });
    });

    it("should rethrow when even the video-only grant fails", () => {
        const callback = vi.fn(() => {
            throw new Error("gone");
        });
        expect(() => grantDisplayMedia(callback, source, true, "linux")).toThrow("gone");
    });
});

describe("getPopoutWindowResponse", () => {
    it("should allow an Element Call pop-out as a locked down child window", () => {
        const response = getPopoutWindowResponse({ url: "about:blank", frameName: "intercom-popout-abc" });
        expect(response?.action).toBe("allow");
        if (response?.action !== "allow") return;
        const options = response.overrideBrowserWindowOptions!;
        expect(options).toMatchObject({
            resizable: true,
            fullscreenable: true,
            autoHideMenuBar: true,
            backgroundColor: "#000000",
            title: "InterCom – call",
        });
        expect(options.webPreferences).toMatchObject({ nodeIntegration: false, contextIsolation: true, sandbox: true });
        expect(options.webPreferences?.preload).toBeUndefined();
    });

    it.each([
        ["another frame name", { url: "about:blank", frameName: "_blank" }],
        ["no frame name", { url: "about:blank", frameName: "" }],
        ["a real URL", { url: "https://example.org/", frameName: "intercom-popout-abc" }],
    ])("should leave %s to the default handling", (_name, details) => {
        expect(getPopoutWindowResponse(details)).toBeUndefined();
    });
});

describe("setupPopoutWindow", () => {
    it("should stop the pop-out navigating or opening windows", () => {
        const webContentsOn = vi.fn();
        const windowOn = vi.fn();
        const setWindowOpenHandler = vi.fn();
        const window = {
            setMenuBarVisibility: vi.fn(),
            on: windowOn,
            webContents: { setWindowOpenHandler, on: webContentsOn },
        } as unknown as BrowserWindow;
        setupPopoutWindow(window);

        expect(setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: "deny" });

        const navigate = { preventDefault: vi.fn() };
        webContentsOn.mock.calls.find(([name]) => name === "will-navigate")![1](navigate);
        expect(navigate.preventDefault).toHaveBeenCalled();

        const onTitle = windowOn.mock.calls.find(([name]) => name === "page-title-updated")![1];
        const implicit = { preventDefault: vi.fn() };
        onTitle(implicit, "about:blank", false);
        expect(implicit.preventDefault).toHaveBeenCalled();
        const explicit = { preventDefault: vi.fn() };
        onTitle(explicit, "Alice", true);
        expect(explicit.preventDefault).not.toHaveBeenCalled();
    });
});
