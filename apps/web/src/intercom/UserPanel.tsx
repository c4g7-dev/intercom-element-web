/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useEffect } from "react";
import { useCreateAutoDisposedViewModel, UserPanelView } from "@element-hq/web-shared-components";

import { useMatrixClientContext } from "../contexts/MatrixClientContext";
import { UserPanelViewModel } from "../viewmodels/intercom/UserPanelViewModel";
import { useUpdateReady } from "./updater/useUpdateReady";
import { fetchAccountCapabilities } from "./AccountCapabilities";
import { renderIntercomAvatar } from "./Avatar";

/** The user panel at the bottom of the room list: who you are and the controls of your call. */
export function UserPanel(): JSX.Element {
    const client = useMatrixClientContext();
    const vm = useCreateAutoDisposedViewModel(() => new UserPanelViewModel({ client }));
    // A dot on the settings button while an update waits for a restart
    const updateReady = useUpdateReady();
    // The panel opens the account settings: have what they need to know by then (see there)
    useEffect(() => {
        void fetchAccountCapabilities(client).catch(() => undefined);
    }, [client]);
    return <UserPanelView vm={vm} updateReady={updateReady} renderAvatar={renderIntercomAvatar} />;
}
