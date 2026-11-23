/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useEffect, useState } from "react";

import {
    getUpdaterApi,
    subscribeToUpdater,
    type UpdaterApi,
    type UpdaterState,
    type UpdaterSubscribe,
} from "./Updater";

/**
 * Whether an update of the desktop app is downloaded and waits for a restart: what the dot on
 * the settings button of the user panel says. Always false in a browser.
 */
export function useUpdateReady(
    api: UpdaterApi | undefined = getUpdaterApi(),
    subscribe: UpdaterSubscribe = subscribeToUpdater,
): boolean {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        if (!api) return;
        let live = true;
        const onState = (state: UpdaterState): void => {
            if (live) setReady(state.supported && state.phase === "ready");
        };
        const unsubscribe = subscribe(onState);
        // An update that was ready before this window listened
        api.getState().then(onState, () => {});
        return (): void => {
            live = false;
            unsubscribe();
        };
    }, [api, subscribe]);
    return ready;
}
