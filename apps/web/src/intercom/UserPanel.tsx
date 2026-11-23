/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { useCreateAutoDisposedViewModel, UserPanelView } from "@element-hq/web-shared-components";

import { useMatrixClientContext } from "../contexts/MatrixClientContext";
import { UserPanelViewModel } from "../viewmodels/intercom/UserPanelViewModel";

/** The user panel at the bottom of the room list: who you are and the controls of your call. */
export function UserPanel(): JSX.Element {
    const client = useMatrixClientContext();
    const vm = useCreateAutoDisposedViewModel(() => new UserPanelViewModel({ client }));
    return <UserPanelView vm={vm} />;
}
