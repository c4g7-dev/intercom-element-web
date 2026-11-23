/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * InterCom additions to the Electron main process. Kept in one file (plus small call sites) so the
 * fork stays easy to rebase onto upstream Element Desktop.
 */

import {
    app,
    type BrowserWindow,
    type BrowserWindowConstructorOptions,
    type HandlerDetails,
    type Streams,
    type WindowOpenHandlerResponse,
} from "electron";

/** Background painted before the web app has rendered; matches the default (dark) InterCom theme. */
export const WINDOW_BACKGROUND = "#1b1e24";

/**
 * Element Call (InterCom build) pops a participant's video out with
 * `window.open("", "intercom-popout-<id>", "popup,width=1280,height=720")` and renders into it.
 */
export const POPOUT_FRAME_PREFIX = "intercom-popout-";

/**
 * Chromium features which are disabled regardless of platform.
 *  - HardwareMediaKeyHandling, MediaSessionService: calls use media elements which would otherwise
 *    capture the media keys (element-web#15704), as upstream.
 *  - WebRtcAllowInputVolumeAdjustment: stops WebRTC's gain controller from moving the *system*
 *    capture volume (PipeWire/PulseAudio source volume, the Windows mic slider), which it does even
 *    with `autoGainControl: false` (element-web#32469, #24355, #32021).
 */
const DISABLED_FEATURES = ["HardwareMediaKeyHandling", "MediaSessionService", "WebRtcAllowInputVolumeAdjustment"];

/**
 * Linux hardware video features (Chromium 152 / Electron 44 names; the pre-M131 names
 * VaapiVideoDecoder, VaapiVideoDecodeLinuxGL and VaapiVideoEncoder no longer exist).
 *  - AcceleratedVideoDecodeLinuxGL: VA-API decode with the GL (non-Vulkan) compositor.
 *  - AcceleratedVideoEncoder: VA-API encode, also used by WebRTC. Needs a driver with encode
 *    entrypoints (Intel/AMD); nvidia-vaapi-driver is decode-only, so this is a no-op on NVIDIA.
 *  - VaapiOnNvidiaGPUs: VA-API is otherwise refused outright on NVIDIA GPUs.
 *  - VaapiIgnoreDriverChecks: accept VA drivers Chromium has not allow-listed (nvidia-vaapi-driver).
 * The Wayland PipeWire screen capturer needs no flag any more (WebRTCPipeWireCapturer was removed
 * once it became the default).
 */
const LINUX_HW_VIDEO_FEATURES = [
    "AcceleratedVideoDecodeLinuxGL",
    "AcceleratedVideoEncoder",
    "VaapiOnNvidiaGPUs",
    "VaapiIgnoreDriverChecks",
];
/** Opt-in (`--hw-video-zero-copy`): skips a copy per decoded frame, but is the likeliest to misrender. */
const LINUX_HW_VIDEO_ZERO_COPY_FEATURE = "AcceleratedVideoDecodeLinuxZeroCopyGL";

/**
 * Merge feature names into a comma-separated Chromium feature switch, keeping whatever the user
 * passed on the command line (appendSwitch on its own would replace the user's value).
 */
export function mergeFeatureList(existing: string, features: string[]): string {
    const merged = existing
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean);
    for (const feature of features) {
        // A user value may carry field trial params ("Feature:param/value"), compare by name only.
        if (!merged.some((f) => f.split(/[:<]/)[0] === feature)) merged.push(feature);
    }
    return merged.join(",");
}

function addFeatures(switchName: "enable-features" | "disable-features", features: string[]): void {
    if (!features.length) return;
    app.commandLine.appendSwitch(switchName, mergeFeatureList(app.commandLine.getSwitchValue(switchName), features));
}

/**
 * Whether hardware video should be left at Chromium's defaults: `--no-hw-video` or
 * `INTERCOM_NO_HW_VIDEO=1`.
 */
export function isHwVideoDisabled(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
    return argv.includes("--no-hw-video") || ["1", "true"].includes(env.INTERCOM_NO_HW_VIDEO ?? "");
}

/**
 * The Chromium features InterCom turns on for this platform.
 */
export function getEnabledFeatures(
    platform: NodeJS.Platform = process.platform,
    argv: string[] = process.argv,
    env: NodeJS.ProcessEnv = process.env,
): string[] {
    if (platform !== "linux") return [];
    const features: string[] = [];
    if (!isHwVideoDisabled(argv, env)) {
        features.push(...LINUX_HW_VIDEO_FEATURES);
        if (argv.includes("--hw-video-zero-copy")) features.push(LINUX_HW_VIDEO_ZERO_COPY_FEATURE);
    }
    // Opt-in: lets globalShortcut go through the XDG GlobalShortcuts portal on Wayland (see intercom-call-actions.ts)
    if (argv.includes("--global-shortcuts-portal")) features.push("GlobalShortcutsPortal");
    return features;
}

/**
 * Whether HTTP/3 (QUIC) is left on: `--enable-quic` or `INTERCOM_ENABLE_QUIC=1`.
 *
 * InterCom turns it off by default. Behind some reverse proxies and tunnels (measured: Traefik
 * advertising h3 behind a GRE tunnel) HTTP/3 uploads crawl at about 10 KB/s and time out, where
 * HTTP/2 to the same server does megabytes per second; Chromium does not fall back on its own.
 */
export function isQuicEnabled(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): boolean {
    return argv.includes("--enable-quic") || ["1", "true"].includes(env.INTERCOM_ENABLE_QUIC ?? "");
}

/**
 * Apply InterCom's Chromium switches. Must run before the app is ready.
 */
export function configureChromium(): void {
    addFeatures("disable-features", DISABLED_FEATURES);
    addFeatures("enable-features", getEnabledFeatures());
    if (!isQuicEnabled()) app.commandLine.appendSwitch("disable-quic");
}

/** The system audio devices Electron can attach to a screen share. */
type LoopbackAudio = "loopbackWithoutChrome" | "loopback";

/**
 * What to grant a `getDisplayMedia()` request for a chosen video source.
 *
 * System audio is granted where Chromium can loop it back by itself:
 *  - Windows: "loopbackWithoutChrome" so that the call's own audio is not sent back into the call.
 *  - macOS: "loopback" (CoreAudio tap, macOS 14.2+, needs NSAudioCaptureUsageDescription).
 *  - Linux: nothing. Chromium's loopback there is the monitor of the default sink, which includes
 *    the call itself; Element Call offers a source picker built on getUserMedia instead.
 * A request which did not ask for audio must not be answered with an audio stream.
 */
export function getDisplayMediaAudioCandidates(
    video: Streams["video"],
    audioRequested: boolean,
    platform: NodeJS.Platform = process.platform,
): Array<LoopbackAudio | undefined> {
    if (!audioRequested || !video || !("id" in video) || !video.id) return [undefined];
    if (platform === "win32") return ["loopbackWithoutChrome", "loopback", undefined];
    if (platform === "darwin") return ["loopback", undefined];
    return [undefined];
}

/**
 * Answer a `getDisplayMedia()` request with the chosen video source, plus system audio where the
 * platform supports it (see {@link getDisplayMediaAudioCandidates}). Electron throws synchronously
 * when it does not know an audio device name, in which case the next candidate is tried.
 */
export function grantDisplayMedia(
    callback: (streams: Streams) => void,
    video: Streams["video"],
    audioRequested: boolean,
    platform: NodeJS.Platform = process.platform,
): void {
    const candidates = getDisplayMediaAudioCandidates(video, audioRequested, platform);
    for (const [i, audio] of candidates.entries()) {
        try {
            // "loopbackWithoutChrome" is understood by Electron 44 but missing from its typings
            callback(audio ? { video, audio: audio as Streams["audio"] } : { video });
            return;
        } catch (e) {
            if (i === candidates.length - 1) throw e;
            console.warn(`Display media audio "${audio}" was refused, falling back`, e);
        }
    }
}

/**
 * If the window being opened is one of Element Call's pop-outs, allow it as a plain child window.
 * @returns the response for `setWindowOpenHandler`, or undefined for any other window.
 */
export function getPopoutWindowResponse(
    details: Pick<HandlerDetails, "url" | "frameName">,
): WindowOpenHandlerResponse | undefined {
    if (!details.frameName?.startsWith(POPOUT_FRAME_PREFIX)) return undefined;
    // The pop-out is always an empty document which the opener renders into.
    if (details.url !== "" && details.url !== "about:blank") return undefined;

    const options: BrowserWindowConstructorOptions = {
        width: 1280,
        height: 720,
        minWidth: 320,
        minHeight: 180,
        resizable: true,
        fullscreenable: true,
        backgroundColor: "#000000",
        autoHideMenuBar: true,
        title: `${app.getName()} – call`,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            // The pop-out has no business talking to the main process
            preload: undefined,
        },
    };
    return { action: "allow", overrideBrowserWindowOptions: options };
}

/**
 * Lock down a freshly created pop-out: it may not navigate or open further windows.
 */
export function setupPopoutWindow(window: BrowserWindow): void {
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (ev) => ev.preventDefault());
    window.on("page-title-updated", (ev, _title, explicitSet) => {
        // Keep our title rather than "about:blank" unless the opener sets a real one
        if (!explicitSet) ev.preventDefault();
    });
}
