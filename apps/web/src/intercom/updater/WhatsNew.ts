/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import dis from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import Modal from "../../Modal";
import {
    getUpdaterApi,
    subscribeToUpdater,
    type UpdaterApi,
    type UpdaterReleaseNotes,
    type UpdaterState,
    type UpdaterSubscribe,
} from "./Updater";
import { WhatsNewDialog } from "./WhatsNewDialog";

/** Shows the notes; resolves when the user put them away. */
type Show = (version: string, notes: UpdaterReleaseNotes[]) => Promise<unknown>;

const showDialog: Show = (version, notes) => Modal.createDialog(WhatsNewDialog, { version, notes }).finished;

/** Calls back once the user is signed in and the app is up: the notes are not shown over the sign-in. */
const whenClientStarted = (callback: () => void): void => {
    const ref = dis.register((payload) => {
        if (payload.action !== Action.ClientStarted) return;
        dis.unregister(ref);
        callback();
    });
};

/**
 * Shows "What's new in InterCom <version>" once after the app became a newer release.
 *
 * The desktop app decides whether there is something to show (it remembers the release whose
 * notes were seen, and has the setting that turns this off) and keeps the notes from its last
 * check, so they are there without a connection. Where they are not there yet (the release was
 * installed by hand), the question is asked again after each check. However the dialog is put
 * away, the release counts as seen.
 * @returns what stops it
 */
export function startWhatsNew(
    api: UpdaterApi | undefined = getUpdaterApi(),
    subscribe: UpdaterSubscribe = subscribeToUpdater,
    show: Show = showDialog,
    whenReady: (callback: () => void) => void = whenClientStarted,
): () => void {
    if (!api?.getNotes) return () => {};
    let ready = false;
    let shown = false;
    let asking = false;
    let stopped = false;
    let lastChecked: number | undefined;

    const ask = (): void => {
        if (!ready || shown || asking || stopped) return;
        asking = true;
        api.getNotes!()
            .then((notes) => {
                if (shown || stopped || !notes.whatsNew.length || !notes.currentVersion) return;
                shown = true;
                return show(notes.currentVersion, notes.whatsNew).then(() => void api.whatsNewSeen?.());
            })
            .catch(() => {})
            .finally(() => {
                asking = false;
            });
    };

    const unsubscribe = subscribe((state: UpdaterState) => {
        // A check ended: its answer may hold the notes that were missing
        if (state.lastChecked === lastChecked) return;
        lastChecked = state.lastChecked;
        ask();
    });
    whenReady(() => {
        ready = true;
        ask();
    });
    return () => {
        stopped = true;
        unsubscribe();
    };
}

/**
 * Tells the desktop app when the network comes back, which is a reason to look for a release
 * at once: the app itself cannot see it.
 * @returns what stops it
 */
export function tellUpdaterWhenOnline(
    api: UpdaterApi | undefined = getUpdaterApi(),
    target: Pick<Window, "addEventListener" | "removeEventListener"> = window,
): () => void {
    if (!api?.networkOnline) return () => {};
    const onOnline = (): void => {
        api.networkOnline!().catch(() => {});
    };
    target.addEventListener("online", onOnline);
    return () => target.removeEventListener("online", onOnline);
}
