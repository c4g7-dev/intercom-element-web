/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useEffect, useState } from "react";

import { getUpdaterApi, type UpdaterApi } from "./Updater";

/** The InterCom release that runs, e.g. `1.12.35-intercom.13`; undefined in a browser or a build that is no release. */
export function useIntercomVersion(api: UpdaterApi | undefined = getUpdaterApi()): string | undefined {
    const [version, setVersion] = useState<string>();
    useEffect(() => {
        if (!api) return;
        let live = true;
        api.getState().then(
            (state) => {
                if (live) setVersion(state.currentVersion);
            },
            () => {},
        );
        return (): void => {
            live = false;
        };
    }, [api]);
    return version;
}
