/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";
import { type ClientWidgetApi, type IWidgetApiRequest } from "matrix-widget-api";

import { attachVoiceStateBridge, VoiceStateStore } from "./VoiceStateStore";
import { OwnCallCues } from "./OwnCallCues";
import { attachSoundsBridge } from "./SoundsBridge";
import { type DeviceState, readDeviceState, unavailability } from "./DeviceAvailability";
import { attachConnectionStatsBridge } from "./ConnectionStats";
import {
    ALONE_TIMEOUT_LEFT_REASON,
    type AloneCountdown,
    noteAloneDisconnect,
    readAloneCountdown,
} from "./AloneTimeout";
import { showAloneDisconnectToast } from "./AloneDisconnectToast";

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
    /** How the microphone and the camera stand: also whether there is one to turn on at all */
    audioState: DeviceState;
    videoState: DeviceState;
    deafened: boolean;
    screenSharing: boolean;
    /** Whether a screen can be shared in the call at all */
    canShareScreen: boolean;
    reconnecting: boolean;
    /** By user ID */
    participants: Map<string, CallParticipantState>;
    /**
     * The countdown of a private call the user was left alone in: when the call leaves by itself.
     * None while somebody else is there, in a voice channel, or with the setting at "never".
     */
    alone?: AloneCountdown;
    /** Why the call is about to leave by itself, where it says so right before it does */
    leftReason?: typeof ALONE_TIMEOUT_LEFT_REASON;
}

export enum CallStateStoreEvent {
    /** The state of the call of a room changed, or went away. Parameter: the room's ID */
    Update = "update",
}

type EventHandlerMap = { [CallStateStoreEvent.Update]: (roomId: string) => void };

/**
 * Reads what the widget sent. Whatever is missing or of the wrong type is taken for off, and
 * members without a user ID are left out: the widget is the bundled one, but its messages are
 * still only data. What a widget from before did not tell yet (whether there is a microphone and
 * a camera, whether a screen can be shared) is taken for there.
 * @param now The time, in ms: the call tells how long is left of a countdown, not when it ends
 * @param previous The state before this one, whose countdown is kept where it is the same one
 */
export function parseCallState(data: unknown, now = Date.now(), previous?: IntercomCallState): IntercomCallState {
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
    const audioEnabled = raw.audio_enabled === true;
    const videoEnabled = raw.video_enabled === true;
    const alone = readAloneCountdown(raw.alone, now, previous?.alone);
    return {
        audioEnabled,
        videoEnabled,
        audioState: readDeviceState(raw.audio_state, audioEnabled),
        videoState: readDeviceState(raw.video_state, videoEnabled),
        deafened: raw.deafened === true,
        screenSharing: raw.screen_sharing === true,
        canShareScreen: raw.can_share_screen !== false,
        reconnecting: raw.reconnecting === true,
        participants,
        ...(alone && { alone }),
        ...(raw.left_reason === ALONE_TIMEOUT_LEFT_REASON && { leftReason: ALONE_TIMEOUT_LEFT_REASON }),
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
    voiceStore: VoiceStateStore = VoiceStateStore.instance,
    ownCues: Pick<OwnCallCues, "joined" | "left"> = OwnCallCues.instance,
    /** Says that the call ended because the user was alone in it */
    onAloneDisconnect: (roomId: string) => void = (roomId) => {
        noteAloneDisconnect(roomId);
        showAloneDisconnectToast();
    },
): () => void {
    if (!roomId) return () => {};
    // The call asks whose sounds are whose, and for the user's own sound files
    const detachSounds = attachSoundsBridge(widgetApi);
    // The user's mute and deafen are the app's: the call asks for them, is told their changes,
    // and what it reports of its own microphone and hearing goes back into them
    const detachVoice = attachVoiceStateBridge(widgetApi, roomId, voiceStore);
    // And how its connection is, for the signal bars of the user panel and the details behind them
    const detachConnection = attachConnectionStatsBridge(widgetApi, roomId);
    const onAction = (ev: CustomEvent<IWidgetApiRequest>): void => {
        ev.preventDefault(); // stop the widget API from auto-rejecting this
        const state = parseCallState(ev.detail.data, Date.now(), store.getState(roomId));
        store.setState(roomId, state);
        // The call leaves by itself right after saying so: the user is told why it ended
        if (state.leftReason === ALONE_TIMEOUT_LEFT_REASON) onAloneDisconnect(roomId);
        // The call tells its state from when the user is in it: the first time is the join
        ownCues.joined(roomId);
        voiceStore.handleCallReport(roomId, {
            // A microphone that is not there says nothing about mute: the user's stays as it is
            muted: unavailability(state.audioState) ? voiceStore.state.muted : !state.audioEnabled,
            deafened: state.deafened,
            reconnecting: state.reconnecting,
        });
        widgetApi.transport.reply(ev.detail, {});
    };
    widgetApi.on(`action:${CALL_STATE_WIDGET_ACTION}`, onAction);
    return () => {
        widgetApi.off(`action:${CALL_STATE_WIDGET_ACTION}`, onAction);
        detachVoice();
        detachSounds();
        detachConnection();
        store.clear(roomId);
        // Left, or the call's view went away: the call cannot play the sound of that itself
        ownCues.left(roomId);
    };
}
