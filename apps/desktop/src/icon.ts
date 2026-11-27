/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import path from "node:path";

import { getAsarPath } from "./asar.js";

export async function getIconPath(): Promise<string> {
    const asarPath = await getAsarPath();

    const iconFile = `icon.${process.platform === "win32" ? "ico" : "png"}`;
    return path.join(path.dirname(asarPath), "build", iconFile);
}

/**
 * Lattice: the icon of the tray when nothing is unread. On Linux it is the mark alone in white
 * (`tray-mono.png`, with a `@2x` beside it), as panels show their other icons; `INTERCOM_TRAY_ICON=colour`
 * asks for the app's icon instead, for a light panel. Elsewhere it is the app's icon.
 */
export async function getTrayIconPath(env: NodeJS.ProcessEnv = process.env): Promise<string> {
    const iconPath = await getIconPath();
    if (process.platform !== "linux" || /^colou?r$/i.test(env.INTERCOM_TRAY_ICON ?? "")) return iconPath;
    return path.join(path.dirname(iconPath), "tray-mono.png");
}
