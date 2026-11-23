/*
 * Copyright 2026 Element Creations Ltd.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { CollapseOnWindowResizeBehaviour } from "./CollapseOnWindowResizeBehaviour";
import { type BaseCollapseBehaviour } from "./BaseCollapseBehaviour";
import { type CollapseHandler } from "../CollapseHandler";
import { type CallStore } from "../../../../stores/CallStore";

/**
 * The auto-collapse behaviours used by the app.
 *
 * InterCom: joining a call no longer folds the room list away (CollapseOnCallResizeBehaviour
 * is not used). The list is where the people in the call and the call's controls are shown.
 */
export const Behaviours: Array<{
    new (collapseHandler: CollapseHandler, callStore: CallStore): BaseCollapseBehaviour;
    shouldStartCollapsed(): boolean;
}> = [CollapseOnWindowResizeBehaviour];
