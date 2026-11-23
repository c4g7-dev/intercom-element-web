/*
Copyright 2024 New Vector Ltd.
Copyright 2018, 2019 , 2021 New Vector Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// This file is compiled to CommonJS rather than ESM otherwise the browser chokes on the import statement.

import { ipcRenderer, contextBridge, type IpcRendererEvent } from "electron";
import type { ConfigOptions } from "./config.js" with { "resolution-mode": "import" };
import type { X509Api } from "shared-types" with { "resolution-mode": "import" };

// Expose only expected IPC wrapper APIs to the renderer process to avoid
// handing out generalised messaging access.

const CHANNELS = [
    "app_onAction",
    "before-quit",
    "check_updates",
    "install_update",
    "ipcCall",
    "ipcReply",
    "loudNotification",
    "preferences",
    "seshat",
    "seshatReply",
    "setBadgeCount",
    "update-downloaded",
    "userDownloadCompleted",
    "userDownloadAction",
    "openDesktopCapturerSourcePicker",
    "userAccessToken",
    "homeserverUrl",
    "serverSupportedVersions",
    "showToast",
    // InterCom: a call action from a global shortcut or a second instance's command line
    "intercomCallAction",
    // InterCom: the state of the updater, pushed when it changes
    "intercomUpdater",
];

contextBridge.exposeInMainWorld("electron", {
    on(channel: string, listener: (event: IpcRendererEvent, ...args: any[]) => void): void {
        if (!CHANNELS.includes(channel)) {
            console.error(`Unknown IPC channel ${channel} ignored`);
            return;
        }
        ipcRenderer.on(channel, listener);
    },
    send(channel: string, ...args: any[]): void {
        if (!CHANNELS.includes(channel)) {
            console.error(`Unknown IPC channel ${channel} ignored`);
            return;
        }
        ipcRenderer.send(channel, ...args);
    },

    async initialise(): Promise<{
        protocol: string;
        sessionId: string;
        config: ConfigOptions;
        supportedSettings: Record<string, boolean>;
        /**
         * Do we need to render badge overlays for new notifications?
         */
        supportsBadgeOverlay: boolean;
    }> {
        ipcRenderer.emit("initialise");
        const [{ protocol, sessionId }, config, supportedSettings] = await Promise.all([
            ipcRenderer.invoke("getProtocol"),
            ipcRenderer.invoke("getConfig"),
            ipcRenderer.invoke("getSupportedSettings"),
        ]);
        return { protocol, sessionId, config, supportedSettings, supportsBadgeOverlay: process.platform === "win32" };
    },

    async setSettingValue(settingName: string, value: any): Promise<void> {
        return ipcRenderer.invoke("setSettingValue", settingName, value);
    },
    async getSettingValue(settingName: string): Promise<any> {
        return ipcRenderer.invoke("getSettingValue", settingName);
    },

    // X.509 hardware-key IPC
    x509: {
        getUserCertificate: () => ipcRenderer.invoke("x509", "getUserCertificate"),
        listHardwareKeys: () => ipcRenderer.invoke("x509", "listHardwareKeys"),
        getKeyState: (serialNumber: string) => ipcRenderer.invoke("x509", "getKeyState", serialNumber),
        logIntoKey: (serialNumber: string, pin: string) => ipcRenderer.invoke("x509", "logIntoKey", serialNumber, pin),
        signData: (serialNumber: string, data: Uint8Array) =>
            ipcRenderer.invoke("x509", "signData", serialNumber, data),
    } satisfies X509Api,

    // InterCom: screen share audio from a PipeWire/PulseAudio sink (Linux), see intercom-share-audio.ts
    intercomShareAudio: {
        listSinks: () => ipcRenderer.invoke("intercomShareAudio", "listSinks"),
        prepareShareSource: (sinkName: string) =>
            ipcRenderer.invoke("intercomShareAudio", "prepareShareSource", sinkName),
        releaseShareSource: (sinkName?: string) =>
            ipcRenderer.invoke("intercomShareAudio", "releaseShareSource", sinkName),
    },

    // InterCom: updates from the GitHub releases, see intercom-updater.ts
    intercomUpdater: {
        getState: () => ipcRenderer.invoke("intercomUpdater", "getState"),
        check: () => ipcRenderer.invoke("intercomUpdater", "check"),
        install: () => ipcRenderer.invoke("intercomUpdater", "install"),
        setAutoCheck: (on: boolean) => ipcRenderer.invoke("intercomUpdater", "setAutoCheck", on),
        openReleasePage: () => ipcRenderer.invoke("intercomUpdater", "openReleasePage"),
    },

    // InterCom: the user's own sound cues from <profile>/sounds, see intercom-sounds.ts
    intercomSounds: {
        list: () => ipcRenderer.invoke("intercomSounds", "list"),
    },
});
