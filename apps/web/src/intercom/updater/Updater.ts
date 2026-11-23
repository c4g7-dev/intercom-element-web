/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/** Where an update stands; see apps/desktop/src/intercom-updater-state.ts. */
export type UpdaterPhase =
    | "idle"
    | "checking"
    | "downloading"
    | "verifying"
    | "unpacking"
    | "ready"
    | "installing"
    | "manual"
    | "error";

/** How the desktop app's updater stands; see apps/desktop/src/intercom-updater.ts. */
export interface UpdaterState {
    supported: boolean;
    reason?: "unpackaged" | "no-version" | "disabled-by-flag" | "platform";
    currentVersion?: string;
    autoCheck: boolean;
    channel: "stable";
    phase: UpdaterPhase;
    latestVersion?: string;
    releaseUrl?: string;
    /** 0 to 1 while downloading */
    progress?: number;
    /** While downloading: bytes received, bytes in all (0 if unknown) and the speed */
    download?: { done: number; total: number; bytesPerSecond: number };
    error?: string;
    lastChecked?: number;
    /** The updater's last steps, oldest first; absent from a desktop app older than 1.12.35-intercom.6 */
    log?: Array<{ t: number; text: string }>;
}

/** The desktop app's updater, as the window reaches it. */
export interface UpdaterApi {
    getState(): Promise<UpdaterState>;
    check(): Promise<UpdaterState>;
    install(): Promise<UpdaterState>;
    setAutoCheck(on: boolean): Promise<UpdaterState>;
    openReleasePage(): Promise<UpdaterState>;
}

/** Something that is told when the updater's state changes; returns what stops the telling. */
export type UpdaterSubscribe = (listener: (state: UpdaterState) => void) => () => void;

/** The desktop app's updater, or undefined in a browser or in a desktop app that has none. */
export function getUpdaterApi(): UpdaterApi | undefined {
    return window.electron?.intercomUpdater;
}

const listeners = new Set<(state: UpdaterState) => void>();
let listening = false;

/** Listens to the state the desktop app pushes. The one listener on the channel serves all. */
export const subscribeToUpdater: UpdaterSubscribe = (listener) => {
    if (!listening && window.electron) {
        listening = true;
        window.electron.on("intercomUpdater", (_ev, state: UpdaterState) => {
            for (const each of listeners) each(state);
        });
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
};
