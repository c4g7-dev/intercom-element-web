/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { UpdateStatusView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";

import { UpdateStatusViewModel } from "../../viewmodels/intercom/UpdateStatusViewModel";

/** The update status bar at the bottom of the room list, over the user panel. */
export function UpdateStatus(): JSX.Element {
    const vm = useCreateAutoDisposedViewModel(() => new UpdateStatusViewModel());
    return <UpdateStatusView vm={vm} />;
}
