/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    BaseViewModel,
    type UpdateStatusViewActions,
    type UpdateStatusViewSnapshot,
} from "@element-hq/web-shared-components";

import {
    getUpdaterApi,
    subscribeToUpdater,
    type UpdaterApi,
    type UpdaterState,
    type UpdaterSubscribe,
} from "../../intercom/updater/Updater";

interface Props {
    /** The desktop app's updater; undefined in a browser */
    api?: UpdaterApi;
    subscribe?: UpdaterSubscribe;
    /** How the time of a step is shown; for tests */
    formatTime?: (date: Date) => string;
}

function timeOfDay(date: Date): string {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * The update status bar over the user panel: shows where the desktop app's updater stands while
 * it has something to say, and hands its buttons to it. In a browser there is no updater, and
 * the bar stays away.
 */
export class UpdateStatusViewModel
    extends BaseViewModel<UpdateStatusViewSnapshot, Props>
    implements UpdateStatusViewActions
{
    private readonly api?: UpdaterApi;

    public constructor(props: Props = {}) {
        const api = "api" in props ? props.api : getUpdaterApi();
        super(props, { phase: "idle", log: [], expanded: false });
        this.api = api;
        if (!api) return;

        this.disposables.track((props.subscribe ?? subscribeToUpdater)(this.onState));
        api.getState().then(this.onState, () => {});
    }

    private readonly onState = (state: UpdaterState): void => {
        if (this.isDisposed) return;
        const format = this.props.formatTime ?? timeOfDay;
        // An updater that cannot update says nothing here; Settings → InterCom says why
        const phase = state.supported ? state.phase : "idle";
        this.snapshot.set({
            phase,
            latestVersion: state.latestVersion,
            download: phase === "downloading" ? state.download : undefined,
            log: (state.log ?? []).map((line) => ({ time: format(new Date(line.t)), text: line.text })),
            // The steps close with the bar, and open by themselves for nothing
            expanded: phase === "idle" ? false : this.snapshot.current.expanded,
        });
    };

    public onToggleDetails = (): void => {
        this.snapshot.merge({ expanded: !this.snapshot.current.expanded });
    };

    public onRestart = (): void => {
        void this.api?.install();
    };

    public onRetry = (): void => {
        this.api?.check().then(this.onState, () => {});
    };

    public onOpenReleasePage = (): void => {
        void this.api?.openReleasePage();
    };
}
