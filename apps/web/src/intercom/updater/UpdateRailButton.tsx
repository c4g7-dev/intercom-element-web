/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { UpdateRailButtonView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";

import { UpdateRailButtonViewModel } from "../../viewmodels/intercom/UpdateRailButtonViewModel";

interface Props {
    /** Whether the rail of spaces is collapsed to its icons */
    isPanelCollapsed: boolean;
}

/** The update button of the rail of spaces, above the settings; there only while an update is. */
export function UpdateRailButton({ isPanelCollapsed }: Props): JSX.Element {
    const vm = useCreateAutoDisposedViewModel(() => new UpdateRailButtonViewModel());
    return <UpdateRailButtonView vm={vm} expanded={!isPanelCollapsed} />;
}
