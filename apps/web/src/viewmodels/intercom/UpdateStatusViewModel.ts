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

/**
 * The first thing the notes of a release say, as one line of plain text: its first line that
 * holds words, without the marks of a list, of emphasis and of links.
 * @returns undefined for notes that say nothing
 */
export function notesSummary(body: string | undefined): string | undefined {
    for (const line of (body ?? "").split(/\r?\n/)) {
        // Pictures, tables of pictures and HTML are not words
        if (/^\s*(\||<|!\[)/.test(line)) continue;
        const text = line
            .replace(/^\s*(?:[-*+]|\d+\.|#{1,6})\s+/, "")
            .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
            .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
            .replace(/(\*\*|__|`|\*)/g, "")
            .trim();
        if (text) return text;
    }
    return undefined;
}

function timeOfDay(date: Date): string {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * The update card over the user panel: shows where the desktop app's updater stands while it
 * has something to say, and hands its buttons to it. It is the one notice of an update (the rail
 * of spaces has the button): "Later" puts the card of a release that is offered away until
 * another release is, or until the next start, and takes nothing from the update. In a browser
 * there is no updater, and the card stays away.
 */
export class UpdateStatusViewModel
    extends BaseViewModel<UpdateStatusViewSnapshot, Props>
    implements UpdateStatusViewActions
{
    private readonly api?: UpdaterApi;
    /** The offer that was put away with "Later": `<version>:<phase>` */
    private putAway?: string;
    /** The release whose notes were asked for, and the line they gave */
    private summaryFor?: string;
    private summary?: string;
    private lastState?: UpdaterState;

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
        this.lastState = state;
        const format = this.props.formatTime ?? timeOfDay;
        // An updater that cannot update says nothing here; Settings → Lattice says why
        let phase = state.supported ? state.phase : "idle";
        const offered = phase === "ready" || phase === "manual";
        // Put away with "Later": once per release and kind ("ready" follows "manual" when a release gets its file later)
        if (offered && this.putAway === `${state.latestVersion}:${phase}`) phase = "idle";
        if (offered) this.loadSummary(state.latestVersion);
        this.snapshot.set({
            phase,
            latestVersion: state.latestVersion,
            summary: offered && this.summaryFor === state.latestVersion ? this.summary : undefined,
            download: phase === "downloading" ? state.download : undefined,
            log: (state.log ?? []).map((line) => ({ time: format(new Date(line.t)), text: line.text })),
            // The steps close with the bar, and open by themselves for nothing
            expanded: phase === "idle" ? false : this.snapshot.current.expanded,
        });
    };

    /** Asks the desktop app once per release for its notes, for the one line under the title. */
    private loadSummary(version: string | undefined): void {
        if (!version || this.summaryFor === version || !this.api?.getNotes) return;
        this.summaryFor = version;
        this.summary = undefined;
        this.api.getNotes().then(
            (notes) => {
                if (this.isDisposed || this.summaryFor !== version) return;
                this.summary = notesSummary(notes.pending.find((entry) => entry.version === version)?.body);
                if (this.summary && this.lastState) this.onState(this.lastState);
            },
            () => {},
        );
    }

    public onLater = (): void => {
        const state = this.lastState;
        if (!state) return;
        this.putAway = `${state.latestVersion}:${state.phase}`;
        this.onState(state);
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
