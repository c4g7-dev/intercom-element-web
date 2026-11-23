/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type Room, type RoomMember } from "matrix-js-sdk/src/matrix";
import {
    BaseViewModel,
    type VoiceParticipant,
    type VoiceParticipantsViewActions,
    type VoiceParticipantsViewSnapshot,
} from "@element-hq/web-shared-components";

import { CallStore, CallStoreEvent } from "../../stores/CallStore";
import { type Call, CallEvent } from "../../models/Call";
import { CallStateStore, CallStateStoreEvent } from "../../intercom/CallStateStore";
import { mediaFromMxc } from "../../customisations/Media";
import dispatcher from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { type ViewRoomPayload } from "../../dispatcher/payloads/ViewRoomPayload";

interface Props {
    /** The voice room */
    room: Room;
    /** The user's own ID */
    userId: string;
    callStore?: CallStore;
    callStateStore?: CallStateStore;
}

const AVATAR_SIZE = 24;

/**
 * Who is in the call of a voice room, for the list under the room in the room list.
 *
 * Who is in the call comes from the room (its MatrixRTC memberships), so it is known whether or
 * not the user is in the call themselves. Who speaks, is muted or shares a screen is only known
 * while the user is in the call, from the call itself (see {@link CallStateStore}).
 */
export class VoiceChannelViewModel
    extends BaseViewModel<VoiceParticipantsViewSnapshot, Props>
    implements VoiceParticipantsViewActions
{
    private readonly callStore: CallStore;
    private readonly callStateStore: CallStateStore;
    private call: Call | null = null;

    public constructor(props: Props) {
        const callStore = props.callStore ?? CallStore.instance;
        const callStateStore = props.callStateStore ?? CallStateStore.instance;
        const call = callStore.getCall(props.room.roomId);
        super(props, VoiceChannelViewModel.computeSnapshot(props, call, callStateStore));
        this.callStore = callStore;
        this.callStateStore = callStateStore;

        this.disposables.trackListener(callStore, CallStoreEvent.Call, this.onCallChanged);
        this.disposables.trackListener(
            callStateStore,
            CallStateStoreEvent.Update,
            this.onCallStateChanged as (...args: unknown[]) => void,
        );
        this.disposables.track(() => this.listenTo(null));
        this.listenTo(call);
    }

    private static computeSnapshot(
        props: Props,
        call: Call | null,
        callStateStore: CallStateStore,
    ): VoiceParticipantsViewSnapshot {
        // What the call told while the user was in it says nothing once they have left
        const state = call?.connected ? callStateStore.getState(props.room.roomId) : undefined;
        const members: RoomMember[] = call ? [...call.participants.keys()] : [];
        const participants = members
            .map((member): VoiceParticipant => {
                const live = state?.participants.get(member.userId);
                const isSelf = member.userId === props.userId;
                const mxc = member.getMxcAvatarUrl();
                return {
                    id: member.userId,
                    name: member.name || member.userId,
                    avatarUrl: (mxc && mediaFromMxc(mxc).getSquareThumbnailHttp(AVATAR_SIZE)) || undefined,
                    speaking: live?.speaking ?? false,
                    // Without word from the call nobody is shown as muted
                    muted: live ? !live.audioEnabled : false,
                    deafened: isSelf && state?.deafened === true,
                    live: live?.screenSharing ?? false,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        return { roomName: props.room.name, participants };
    }

    private listenTo(call: Call | null): void {
        if (call === this.call) return;
        this.call?.off(CallEvent.Participants, this.update);
        this.call?.off(CallEvent.ConnectionState, this.update);
        call?.on(CallEvent.Participants, this.update);
        call?.on(CallEvent.ConnectionState, this.update);
        this.call = call;
    }

    private readonly onCallChanged = (): void => {
        this.listenTo(this.callStore.getCall(this.props.room.roomId));
        this.update();
    };

    private readonly onCallStateChanged = (roomId: string): void => {
        if (roomId === this.props.room.roomId) this.update();
    };

    private readonly update = (): void => {
        const next = VoiceChannelViewModel.computeSnapshot(this.props, this.call, this.callStateStore);
        // Members speak and stop many times a minute: only what differs is worth a render
        if (JSON.stringify(next) !== JSON.stringify(this.snapshot.current)) this.snapshot.set(next);
    };

    /** Joins the call without the lobby, or shows it when the user is in it already. */
    public onJoin = (): void => {
        dispatcher.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: this.props.room.roomId,
            view_call: true,
            skipLobby: true,
            metricsTrigger: "RoomList",
        });
    };
}
