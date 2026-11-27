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
    /** Whether a start installs a newer release before the window opens; absent from a desktop app older than 1.12.35-intercom.7 */
    updateOnLaunch?: boolean;
    /** Whether the app looks for a release every few minutes rather than every six hours; absent before 1.12.35-intercom.13 */
    fastCheck?: boolean;
    /** Whether the notes of a release are shown once after it was installed; absent before 1.12.35-intercom.13 */
    showWhatsNew?: boolean;
    /** Whether the update on its way is installed, and the app started again, as soon as it is ready; absent before 1.12.35-intercom.13 */
    installWhenReady?: boolean;
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

/** The notes of one release. */
export interface UpdaterReleaseNotes {
    /** e.g. `1.12.35-intercom.13` */
    version: string;
    /** Markdown, as the release's page has it: shown as text and lists, never as HTML */
    body: string;
    /** The release's page */
    url: string;
}

/** The notes the desktop app has; see apps/desktop/src/intercom-updater-notes.ts. */
export interface UpdaterNotes {
    /** Of the releases newer than the running one, up to the one that is offered; newest first */
    pending: UpdaterReleaseNotes[];
    /** Of the releases the last update brought, to be shown once; empty for nothing to show */
    whatsNew: UpdaterReleaseNotes[];
    currentVersion?: string;
}

/** The desktop app's updater, as the window reaches it. */
export interface UpdaterApi {
    getState(): Promise<UpdaterState>;
    check(): Promise<UpdaterState>;
    install(): Promise<UpdaterState>;
    setAutoCheck(on: boolean): Promise<UpdaterState>;
    setUpdateOnLaunch(on: boolean): Promise<UpdaterState>;
    openReleasePage(): Promise<UpdaterState>;
    // What follows came with 1.12.35-intercom.13
    /** The click on the update button: installs now, or as soon as the update is downloaded and checked */
    update?(): Promise<UpdaterState>;
    getNotes?(): Promise<UpdaterNotes>;
    /** The user has seen what is new in the running release */
    whatsNewSeen?(): Promise<UpdaterState>;
    setFastCheck?(on: boolean): Promise<UpdaterState>;
    setShowWhatsNew?(on: boolean): Promise<UpdaterState>;
    /** The network is back: a reason to look for a release now */
    networkOnline?(): Promise<UpdaterState>;
}

/** All pages of releases, for "All release notes". */
export const RELEASES_URL = "https://github.com/c4g7-dev/InterCom/releases";

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
