/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { GenericToast } from "@element-hq/web-shared-components";

import { _t } from "../../languageHandler";
import ToastStore from "../../stores/ToastStore";
import {
    getUpdaterApi,
    subscribeToUpdater,
    type UpdaterApi,
    type UpdaterState,
    type UpdaterSubscribe,
} from "./Updater";

const TOAST_KEY = "intercom_update";

/**
 * Shows "InterCom <version> is available" when the desktop app has an update ready (or knows of
 * one it cannot install itself), once per version: "Later" puts it away until the next version
 * or the next start. The update is never installed without the click. Putting the toast away
 * takes nothing from the update: the status bar over the user panel and the dot on the settings
 * button stay until it is installed (UpdateStatus, useUpdateReady).
 * @returns what stops it
 */
export function startUpdateToasts(
    api: UpdaterApi | undefined = getUpdaterApi(),
    subscribe: UpdaterSubscribe = subscribeToUpdater,
    toasts: Pick<ToastStore, "addOrReplaceToast" | "dismissToast"> = ToastStore.sharedInstance(),
): () => void {
    if (!api) return () => {};
    let shownFor: string | undefined;

    const onState = (state: UpdaterState): void => {
        const version = state.latestVersion;
        const ready = state.phase === "ready";
        if ((!ready && state.phase !== "manual") || !version) return;
        // Once per version and kind: "ready" follows "manual" when a release gets its file later
        const key = `${version}:${state.phase}`;
        if (shownFor === key) return;
        shownFor = key;

        toasts.addOrReplaceToast({
            key: TOAST_KEY,
            title: _t("intercom|updater|toast_title", { version }),
            props: {
                description: (
                    <>
                        {ready ? _t("intercom|updater|toast_ready") : _t("intercom|updater|toast_manual")}{" "}
                        <a
                            href={state.releaseUrl}
                            onClick={(e) => {
                                // Opened by the desktop app, which knows the release's page
                                e.preventDefault();
                                void api.openReleasePage();
                            }}
                        >
                            {_t("intercom|updater|release_notes")}
                        </a>
                    </>
                ),
                primaryLabel: ready ? _t("intercom|updater|restart") : _t("intercom|updater|open_release_page"),
                onPrimaryClick: () => {
                    if (ready) void api.install();
                    else {
                        void api.openReleasePage();
                        toasts.dismissToast(TOAST_KEY);
                    }
                },
                secondaryLabel: _t("action|later"),
                onSecondaryClick: () => toasts.dismissToast(TOAST_KEY),
            },
            component: GenericToast,
            priority: 20,
        });
    };

    const unsubscribe = subscribe(onState);
    // An update that was ready before this window listened
    api.getState().then(onState, () => {});
    return unsubscribe;
}
