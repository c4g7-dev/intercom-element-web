/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    BaseViewModel,
    type UpdateRailButtonState,
    type UpdateRailButtonViewActions,
    type UpdateRailButtonViewSnapshot,
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
}

/**
 * What the update button of the rail stands for, from where the desktop app's updater stands.
 * Nothing while no newer release is known: a check alone, or one that failed, is not shown here
 * (the status bar over the user panel says it).
 */
export function railStateOf(state: UpdaterState): UpdateRailButtonState {
    if (!state.supported || !state.latestVersion) return "hidden";
    switch (state.phase) {
        case "downloading":
            return "downloading";
        case "verifying":
        case "unpacking":
            return "preparing";
        case "ready":
            return "ready";
        case "installing":
            return "installing";
        case "manual":
            return "manual";
        case "error":
            return "failed";
        default:
            // Known and not on its way: looked for again, or left from a check that went on
            return "available";
    }
}

/**
 * The update button of the rail of spaces: shows where the desktop app's updater stands with a
 * newer release, with the notes of what it brings, and hands the click to it. The updater is the
 * one source of this, as it is for the status bar, the settings and the tray. In a browser there
 * is no updater, and the button stays away.
 */
export class UpdateRailButtonViewModel
    extends BaseViewModel<UpdateRailButtonViewSnapshot, Props>
    implements UpdateRailButtonViewActions
{
    private readonly api?: UpdaterApi;
    private state?: UpdaterState;
    /** The release whose notes are shown or asked for */
    private notesFor?: string;

    public constructor(props: Props = {}) {
        const api = "api" in props ? props.api : getUpdaterApi();
        super(props, { state: "hidden", installWhenReady: false, notes: [] });
        this.api = api;
        if (!api) return;

        this.disposables.track((props.subscribe ?? subscribeToUpdater)(this.onState));
        api.getState().then(this.onState, () => {});
    }

    private readonly onState = (state: UpdaterState): void => {
        if (this.isDisposed) return;
        this.state = state;
        const railState = railStateOf(state);
        const hidden = railState === "hidden";
        const download = state.download;
        this.snapshot.merge({
            state: railState,
            version: hidden ? undefined : state.latestVersion,
            percent:
                railState === "downloading" && download && download.total > 0
                    ? Math.min(100, (download.done / download.total) * 100)
                    : undefined,
            installWhenReady: !hidden && state.installWhenReady === true,
        });

        // The notes are asked for once per release, not with every step of its download
        const wanted = hidden ? undefined : state.latestVersion;
        if (wanted === this.notesFor) return;
        this.notesFor = wanted;
        this.snapshot.merge({ notes: [] });
        if (!wanted) return;
        this.api?.getNotes?.().then(
            (notes) => {
                if (this.isDisposed || this.notesFor !== wanted) return;
                this.snapshot.merge({ notes: notes.pending.map(({ version, body }) => ({ version, body })) });
            },
            () => {},
        );
    };

    public onUpdate = (): void => {
        const api = this.api;
        if (!api) return;
        if (api.update) {
            api.update().then(this.onState, () => {});
            return;
        }
        // A desktop app older than 1.12.35-intercom.13: it installs what is ready, and otherwise looks again
        if (this.state?.phase === "ready") void api.install();
        else if (this.state?.phase === "manual") void api.openReleasePage();
        else api.check().then(this.onState, () => {});
    };

    public onOpenReleasePage = (): void => {
        void this.api?.openReleasePage();
    };
}
