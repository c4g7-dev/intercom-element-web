/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";
import { type ClientWidgetApi, type IWidgetApiRequest } from "matrix-widget-api";

import {
    adoptCallVoiceState,
    callMatchesVoiceState,
    parseVoiceState,
    reduceVoiceState,
    sameVoiceState,
    type VoiceAction,
    voiceCueFor,
    type VoiceSource,
    type VoiceState,
    voiceStateToWire,
    type VoiceStateWire,
} from "./VoiceState";
import { playVoiceCue } from "./VoiceCue";

/**
 * The widget action the voice state goes over, both ways, with Element Call (InterCom build):
 *  - to the widget, `{ muted, deafened, muted_before_deafen }`: the call takes this state, silently;
 *  - from the widget, `{}`: the call asks for the state (when it is joined), and the reply is it.
 * What the call does on its own (its buttons, its shortcuts) comes back in `io.intercom.call_state`.
 */
export const VOICE_STATE_WIDGET_ACTION = "io.intercom.voice_state";

/** Where the state is kept over restarts: this device, not the account. */
export const VOICE_STATE_STORAGE_KEY = "intercom_voice_state";

/**
 * How long a call is given to do what it was told before what it reports instead is believed.
 * Until then a report that differs is taken for one from before the request.
 */
export const VOICE_STATE_SETTLE_MS = 1500;

export enum VoiceStateStoreEvent {
    Update = "update",
}

type EventHandlerMap = { [VoiceStateStoreEvent.Update]: (state: VoiceState) => void };

/** How a call says its microphone and hearing stand. */
export interface CallVoiceReport {
    muted: boolean;
    deafened: boolean;
    reconnecting: boolean;
}

interface CallLink {
    send: (state: VoiceStateWire) => Promise<unknown>;
    last?: CallVoiceReport;
    /** Until when (ms since the epoch) the call is expected to be on its way to the state */
    settlingUntil?: number;
    timer?: ReturnType<typeof setTimeout>;
}

interface Dependencies {
    storage?: Pick<Storage, "getItem" | "setItem">;
    playCue?: (on: boolean) => void;
    /** Writes a diagnostics record */
    log?: (record: Record<string, unknown>) => void;
    now?: () => number;
}

function defaultStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
    try {
        return window.localStorage;
    } catch {
        return undefined;
    }
}

function writeDiagnostics(record: Record<string, unknown>): void {
    try {
        // The desktop app writes the console's diagnostics lines to its log
        console.log("[intercom-diag] " + JSON.stringify(record));
    } catch {
        // Diagnostics never get in the way
    }
}

/**
 * The one place that knows whether the user is muted or deafened. The user panel, the shortcuts,
 * the command line, the tray and the calls all change it here and read it from here:
 *
 *  - a change from the app is passed to every call the user is in;
 *  - a call that is joined asks for the state and takes it, so it is joined muted or deafened
 *    when that is how things stand;
 *  - what the user does with the call's own controls comes back as the call's state and is
 *    taken over here;
 *  - after a reconnect, and where a call does not report what it was told within
 *    {@link VOICE_STATE_SETTLE_MS}, the two are made to agree again: the app's state wins while
 *    a call is (re)joining, the call's where it did not or could not follow.
 *
 * Every change is stored, plays the cue once and is written to the diagnostics log as a
 * `voice_state` record with where it came from.
 */
export class VoiceStateStore extends TypedEventEmitter<VoiceStateStoreEvent, EventHandlerMap> {
    private static internalInstance: VoiceStateStore | undefined;

    public static get instance(): VoiceStateStore {
        VoiceStateStore.internalInstance ??= new VoiceStateStore();
        return VoiceStateStore.internalInstance;
    }

    private current: VoiceState;
    private readonly links = new Map<string, CallLink>();
    private readonly storage: Pick<Storage, "getItem" | "setItem"> | undefined;
    private readonly playCue: (on: boolean) => void;
    private readonly log: (record: Record<string, unknown>) => void;
    private readonly now: () => number;

    public constructor(deps: Dependencies = {}) {
        super();
        this.storage = deps.storage ?? defaultStorage();
        this.playCue = deps.playCue ?? playVoiceCue;
        this.log = deps.log ?? writeDiagnostics;
        this.now = deps.now ?? Date.now;
        let stored: string | null = null;
        try {
            stored = this.storage?.getItem(VOICE_STATE_STORAGE_KEY) ?? null;
        } catch {
            // Without storage the state starts as it does the first time
        }
        this.current = parseVoiceState(stored);
    }

    public get state(): VoiceState {
        return this.current;
    }

    /**
     * Carries out what the user asked for.
     * @returns the state after it
     */
    public perform(action: VoiceAction, source: VoiceSource): VoiceState {
        this.commit(reduceVoiceState(this.current, action), source, action);
        return this.current;
    }

    /**
     * A call the user is in can be told the state from now on.
     * @param send - passes a state to the call
     * @returns what forgets the call again
     */
    public attachCall(roomId: string, send: CallLink["send"]): () => void {
        const link: CallLink = { send };
        this.detach(roomId);
        this.links.set(roomId, link);
        return () => {
            if (this.links.get(roomId) === link) this.detach(roomId);
        };
    }

    private detach(roomId: string): void {
        const link = this.links.get(roomId);
        if (link?.timer !== undefined) clearTimeout(link.timer);
        this.links.delete(roomId);
    }

    /**
     * A call asks for the state, which it does when it is joined.
     * @returns the state for it to take
     */
    public handleCallRequest(roomId: string): VoiceStateWire {
        const link = this.links.get(roomId);
        if (link) this.settle(roomId, link);
        return voiceStateToWire(this.current);
    }

    /** A call says how its microphone and hearing stand. */
    public handleCallReport(roomId: string, report: CallVoiceReport): void {
        const link = this.links.get(roomId);
        if (!link) return;
        const first = link.last === undefined;
        const wasReconnecting = link.last?.reconnecting === true;
        link.last = report;

        if (callMatchesVoiceState(this.current, report)) {
            this.settled(link);
            return;
        }
        // While the connection is away the call's controls say little
        if (report.reconnecting) return;
        if (first || wasReconnecting) {
            // Joined or back: the call is brought to the state, not the state to the call
            this.push(roomId, link);
            return;
        }
        if (link.settlingUntil !== undefined && this.now() < link.settlingUntil) return;
        // The user used the call's own controls, or the call could not follow
        this.settled(link);
        this.commit(adoptCallVoiceState(this.current, report), "call", "sync", roomId);
    }

    private settled(link: CallLink): void {
        link.settlingUntil = undefined;
        if (link.timer !== undefined) clearTimeout(link.timer);
        link.timer = undefined;
    }

    /** Gives a call time to reach the state, and looks at what it says once that is over. */
    private settle(roomId: string, link: CallLink): void {
        this.settled(link);
        link.settlingUntil = this.now() + VOICE_STATE_SETTLE_MS;
        link.timer = setTimeout(() => {
            link.timer = undefined;
            link.settlingUntil = undefined;
            if (this.links.get(roomId) !== link || !link.last || link.last.reconnecting) return;
            if (callMatchesVoiceState(this.current, link.last)) return;
            this.commit(adoptCallVoiceState(this.current, link.last), "call", "sync", roomId);
        }, VOICE_STATE_SETTLE_MS);
    }

    private push(roomId: string, link: CallLink): void {
        this.settle(roomId, link);
        // A call that does not know the message (not the InterCom build), or one that went away,
        // fails this, which is nothing to act on
        const state = voiceStateToWire(this.current);
        void Promise.resolve()
            .then(async () => link.send(state))
            .catch(() => undefined);
    }

    private commit(next: VoiceState, source: VoiceSource, action: string, fromRoomId?: string): void {
        const before = this.current;
        if (sameVoiceState(before, next)) return;
        this.current = next;
        try {
            this.storage?.setItem(VOICE_STATE_STORAGE_KEY, JSON.stringify(voiceStateToWire(next)));
        } catch {
            // Not kept over the restart then
        }
        const cue = voiceCueFor(before, next);
        if (cue) this.playCue(cue === "on");
        for (const [roomId, link] of this.links) {
            if (roomId !== fromRoomId) this.push(roomId, link);
        }
        this.log({
            type: "voice_state",
            t: this.now(),
            source,
            action,
            muted: next.muted,
            deafened: next.deafened,
            calls: this.links.size,
        });
        this.emit(VoiceStateStoreEvent.Update, next);
    }
}

/**
 * Connects a call's widget to the {@link VoiceStateStore}: the call can ask for the state and is
 * told its changes. What the call reports comes in through the call state bridge.
 * @returns what disconnects it again
 */
export function attachVoiceStateBridge(
    widgetApi: ClientWidgetApi,
    roomId: string | undefined,
    store: VoiceStateStore = VoiceStateStore.instance,
): () => void {
    if (!roomId) return () => {};
    const detach = store.attachCall(roomId, (state) => widgetApi.transport.send(VOICE_STATE_WIDGET_ACTION, state));
    const onRequest = (ev: CustomEvent<IWidgetApiRequest>): void => {
        ev.preventDefault(); // stop the widget API from auto-rejecting this
        widgetApi.transport.reply(ev.detail, store.handleCallRequest(roomId));
    };
    widgetApi.on(`action:${VOICE_STATE_WIDGET_ACTION}`, onRequest);
    return () => {
        widgetApi.off(`action:${VOICE_STATE_WIDGET_ACTION}`, onRequest);
        detach();
    };
}
