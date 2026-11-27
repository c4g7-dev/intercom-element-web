/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    BaseViewModel,
    type UpdaterSettingsViewActions,
    type UpdaterSettingsViewSnapshot,
} from "@element-hq/web-shared-components";

import {
    getUpdaterApi,
    subscribeToUpdater,
    type UpdaterApi,
    type UpdaterState,
    type UpdaterSubscribe,
} from "../../intercom/updater/Updater";
import { formatRelativeTime } from "../../DateUtils";

interface Props {
    /** The desktop app's updater; undefined in a browser */
    api?: UpdaterApi;
    subscribe?: UpdaterSubscribe;
    /** How a time is shown; for tests */
    formatTime?: (date: Date) => string;
}

/**
 * The update settings (Settings → InterCom): shows what the desktop app's updater says and hands
 * the controls to it. In a browser there is no updater, and the view says so.
 */
export class UpdaterSettingsViewModel
    extends BaseViewModel<UpdaterSettingsViewSnapshot, Props>
    implements UpdaterSettingsViewActions
{
    private readonly api?: UpdaterApi;
    /** The release whose notes are shown or asked for */
    private notesFor?: string;

    public constructor(props: Props = {}) {
        const api = "api" in props ? props.api : getUpdaterApi();
        super(props, {
            supported: false,
            reason: api ? undefined : "web",
            autoCheck: true,
            updateOnLaunch: true,
            fastCheck: true,
            showWhatsNew: true,
            notes: [],
            phase: "idle",
        });
        this.api = api;
        if (!api) return;

        this.disposables.track((props.subscribe ?? subscribeToUpdater)(this.onState));
        api.getState().then(this.onState, () => {});
    }

    private readonly onState = (state: UpdaterState): void => {
        if (this.isDisposed) return;
        const format = this.props.formatTime ?? ((date: Date): string => formatRelativeTime(date));
        // The notes are asked for once per release, not with every step of its download
        const wanted = state.supported ? state.latestVersion : undefined;
        if (wanted !== this.notesFor) {
            this.notesFor = wanted;
            this.snapshot.merge({ notes: [] });
            if (wanted) {
                this.api?.getNotes?.().then(
                    (notes) => {
                        if (this.isDisposed || this.notesFor !== wanted) return;
                        this.snapshot.merge({ notes: notes.pending.map(({ version, body }) => ({ version, body })) });
                    },
                    () => {},
                );
            }
        }
        this.snapshot.merge({
            supported: state.supported,
            reason: state.reason,
            currentVersion: state.currentVersion,
            autoCheck: state.autoCheck,
            // A desktop app that does not say is one that has no such switch: shown as on, as it is by default
            updateOnLaunch: state.updateOnLaunch !== false,
            fastCheck: state.fastCheck !== false,
            showWhatsNew: state.showWhatsNew !== false,
            phase: state.phase,
            latestVersion: state.latestVersion,
            progress: state.progress,
            error: state.error,
            lastChecked: state.lastChecked ? format(new Date(state.lastChecked)) : undefined,
        });
    };

    public onAutoCheckChange = (on: boolean): void => {
        // Shown at once; the desktop app's answer follows
        this.snapshot.merge({ autoCheck: on });
        this.api?.setAutoCheck(on).then(this.onState, () => {});
    };

    public onUpdateOnLaunchChange = (on: boolean): void => {
        // Shown at once; the desktop app's answer follows
        this.snapshot.merge({ updateOnLaunch: on });
        this.api?.setUpdateOnLaunch(on).then(this.onState, () => {});
    };

    public onFastCheckChange = (on: boolean): void => {
        // Shown at once; the desktop app's answer follows
        this.snapshot.merge({ fastCheck: on });
        this.api?.setFastCheck?.(on).then(this.onState, () => {});
    };

    public onShowWhatsNewChange = (on: boolean): void => {
        this.snapshot.merge({ showWhatsNew: on });
        this.api?.setShowWhatsNew?.(on).then(this.onState, () => {});
    };

    public onCheckNow = (): void => {
        this.api?.check().then(this.onState, () => {});
    };

    public onRestart = (): void => {
        void this.api?.install();
    };

    public onOpenReleasePage = (): void => {
        void this.api?.openReleasePage();
    };
}
