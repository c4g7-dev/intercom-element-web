/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";
import { type ClientWidgetApi, type IWidgetApiRequest } from "matrix-widget-api";

/** The widget action Element Call (InterCom build) tells the state of the call on. */
export const CALL_STATE_WIDGET_ACTION = "io.intercom.call_state";

/** One member of a call the user is in. */
export interface CallParticipantState {
    userId: string;
    speaking: boolean;
    /** Whether their microphone is on */
    audioEnabled: boolean;
    screenSharing: boolean;
}

/** How a call the user is in stands, as its widget tells it. */
export interface IntercomCallState {
    audioEnabled: boolean;
    videoEnabled: boolean;
    deafened: boolean;
    screenSharing: boolean;
    reconnecting: boolean;
    /** By user ID */
    participants: Map<string, CallParticipantState>;
}

export enum CallStateStoreEvent {
    /** The state of the call of a room changed, or went away. Parameter: the room's ID */
    Update = "update",
}

type EventHandlerMap = { [CallStateStoreEvent.Update]: (roomId: string) => void };

/**
 * Reads what the widget sent. Whatever is missing or of the wrong type is taken for off, and
 * members without a user ID are left out: the widget is the bundled one, but its messages are
 * still only data.
 */
export function parseCallState(data: unknown): IntercomCallState {
    const raw = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
    const participants = new Map<string, CallParticipantState>();
    if (Array.isArray(raw.participants)) {
        for (const entry of raw.participants as Record<string, unknown>[]) {
            if (typeof entry?.user_id !== "string" || !entry.user_id) continue;
            participants.set(entry.user_id, {
                userId: entry.user_id,
                speaking: entry.speaking === true,
                audioEnabled: entry.audio_enabled === true,
                screenSharing: entry.screen_sharing === true,
            });
        }
    }
    return {
        audioEnabled: raw.audio_enabled === true,
        videoEnabled: raw.video_enabled === true,
        deafened: raw.deafened === true,
        screenSharing: raw.screen_sharing === true,
        reconnecting: raw.reconnecting === true,
        participants,
    };
}

/**
 * The state of the calls the user is in, by room: who speaks, who is muted, who shares, and how
 * the user's own controls stand. Element Call (InterCom build) sends it while the user is in the
 * call; for a call the user is not in, or one of another call widget, there is none.
 */
export class CallStateStore extends TypedEventEmitter<CallStateStoreEvent, EventHandlerMap> {
    private static internalInstance: CallStateStore | undefined;

    public static get instance(): CallStateStore {
        CallStateStore.internalInstance ??= new CallStateStore();
        return CallStateStore.internalInstance;
    }

    private readonly states = new Map<string, IntercomCallState>();

    /** The state of the call of a room, if the user is in it and the call tells. */
    public getState(roomId: string): IntercomCallState | undefined {
        return this.states.get(roomId);
    }

    public setState(roomId: string, state: IntercomCallState): void {
        this.states.set(roomId, state);
        this.emit(CallStateStoreEvent.Update, roomId);
    }

    /** Forgets the state of a room's call: the user left it, or its widget went away. */
    public clear(roomId: string): void {
        if (this.states.delete(roomId)) this.emit(CallStateStoreEvent.Update, roomId);
    }
}

/**
 * Takes the call's state from a widget into the {@link CallStateStore}.
 * @returns what stops it again and forgets the state
 */
export function attachCallStateBridge(
    widgetApi: ClientWidgetApi,
    roomId: string | undefined,
    store: CallStateStore = CallStateStore.instance,
): () => void {
    if (!roomId) return () => {};
    const onAction = (ev: CustomEvent<IWidgetApiRequest>): void => {
        ev.preventDefault(); // stop the widget API from auto-rejecting this
        store.setState(roomId, parseCallState(ev.detail.data));
        widgetApi.transport.reply(ev.detail, {});
    };
    widgetApi.on(`action:${CALL_STATE_WIDGET_ACTION}`, onAction);
    return () => {
        widgetApi.off(`action:${CALL_STATE_WIDGET_ACTION}`, onAction);
        store.clear(roomId);
    };
}
