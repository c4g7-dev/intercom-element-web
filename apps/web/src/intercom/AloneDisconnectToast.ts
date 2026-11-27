/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { GenericToast } from "@element-hq/web-shared-components";

import { _t } from "../languageHandler";
import ToastStore from "../stores/ToastStore";

const TOAST_KEY = "intercom_alone_disconnect";

/** How long the notice stays if nobody dismisses it */
export const ALONE_DISCONNECT_TOAST_MS = 15_000;

let hideTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Says that the call ended because the user was alone in it: a toast in the corner, which goes
 * away by itself and stops nothing.
 */
export function showAloneDisconnectToast(store: ToastStore = ToastStore.sharedInstance()): void {
    const dismiss = (): void => {
        if (hideTimer !== undefined) clearTimeout(hideTimer);
        hideTimer = undefined;
        store.dismissToast(TOAST_KEY);
    };
    store.addOrReplaceToast({
        key: TOAST_KEY,
        title: _t("intercom|calls|alone_disconnected_title"),
        props: {
            description: _t("intercom|calls|alone_disconnected"),
            primaryLabel: _t("action|dismiss"),
            onPrimaryClick: dismiss,
        },
        component: GenericToast,
        priority: 20,
    });
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    hideTimer = setTimeout(dismiss, ALONE_DISCONNECT_TOAST_MS);
}
