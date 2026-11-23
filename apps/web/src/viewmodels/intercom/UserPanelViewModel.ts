/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type MatrixClient, type User, UserEvent } from "matrix-js-sdk/src/matrix";
import {
    BaseViewModel,
    type UserPanelPresence,
    type UserPanelViewActions,
    type UserPanelViewSnapshot,
} from "@element-hq/web-shared-components";

import { CallStore, CallStoreEvent } from "../../stores/CallStore";
import { type Call } from "../../models/Call";
import { CallStateStore, CallStateStoreEvent } from "../../intercom/CallStateStore";
import { type CallAction, performCallAction } from "../../intercom/CallActions";
import { VoiceStateStore, VoiceStateStoreEvent } from "../../intercom/VoiceStateStore";
import { OwnProfileStore } from "../../stores/OwnProfileStore";
import { UPDATE_EVENT } from "../../stores/AsyncStore";
import dispatcher from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { type ViewRoomPayload } from "../../dispatcher/payloads/ViewRoomPayload";

interface Props {
    client: MatrixClient;
    callStore?: CallStore;
    callStateStore?: CallStateStore;
    /** The user's mute and deafen, which hold with or without a call */
    voiceStateStore?: VoiceStateStore;
    profileStore?: OwnProfileStore;
    /** Carries a call action out; the same as the shortcuts use */
    performAction?: (action: CallAction, source: string) => Promise<number>;
}

const AVATAR_SIZE = 32;
const PRESENCES = new Set<string>(["online", "unavailable", "offline", "busy"]);

/**
 * The user panel at the bottom of the room list: who the user is, whether they are muted or
 * deafened (which they can be with or without a call, see {@link VoiceStateStore}), and the
 * controls of the call they are in. The buttons do what the shortcuts do (Ctrl+Shift+M and the
 * like, or `intercom --toggle-mute`).
 */
export class UserPanelViewModel extends BaseViewModel<UserPanelViewSnapshot, Props> implements UserPanelViewActions {
    private readonly callStore: CallStore;
    private readonly callStateStore: CallStateStore;
    private readonly voiceStateStore: VoiceStateStore;
    private readonly profileStore: OwnProfileStore;
    private readonly user: User | null;

    public constructor(props: Props) {
        const callStore = props.callStore ?? CallStore.instance;
        const callStateStore = props.callStateStore ?? CallStateStore.instance;
        const profileStore = props.profileStore ?? OwnProfileStore.instance;
        const voiceStateStore = props.voiceStateStore ?? VoiceStateStore.instance;
        const user = props.client.getUser(props.client.getSafeUserId());
        super(
            props,
            UserPanelViewModel.computeSnapshot(
                props.client,
                user,
                callStore,
                callStateStore,
                profileStore,
                voiceStateStore,
            ),
        );
        this.callStore = callStore;
        this.callStateStore = callStateStore;
        this.voiceStateStore = voiceStateStore;
        this.profileStore = profileStore;
        this.user = user;

        this.disposables.trackListener(callStore, CallStoreEvent.ConnectedCalls, this.update);
        this.disposables.trackListener(callStateStore, CallStateStoreEvent.Update, this.update);
        this.disposables.trackListener(voiceStateStore, VoiceStateStoreEvent.Update, this.update);
        this.disposables.trackListener(profileStore, UPDATE_EVENT, this.update);
        if (user) this.disposables.trackListener(user, UserEvent.Presence, this.update);
    }

    /** The call the panel is about: the first the user is in (which is the only one, as a rule). */
    private static currentCall(callStore: CallStore): Call | undefined {
        return callStore.connectedCalls.values().next().value;
    }

    private static computeSnapshot(
        client: MatrixClient,
        user: User | null,
        callStore: CallStore,
        callStateStore: CallStateStore,
        profileStore: OwnProfileStore,
        voiceStateStore: VoiceStateStore,
    ): UserPanelViewSnapshot {
        const userId = client.getSafeUserId();
        const call = UserPanelViewModel.currentCall(callStore);
        const state = call ? callStateStore.getState(call.roomId) : undefined;
        const presence = user?.presence && PRESENCES.has(user.presence) ? user.presence : undefined;
        return {
            userId,
            displayName: profileStore.displayName || userId,
            avatarUrl: profileStore.getHttpAvatarUrl(AVATAR_SIZE) ?? undefined,
            // A server without presence leaves it at "offline" for everybody, which says nothing
            presence: presence === "offline" && !user?.lastPresenceTs ? undefined : (presence as UserPanelPresence),
            // The app's own state, which the calls follow: there with or without a call
            muted: voiceStateStore.state.muted,
            deafened: voiceStateStore.state.deafened,
            call: call && {
                roomName: client.getRoom(call.roomId)?.name ?? call.roomId,
                reconnecting: state?.reconnecting ?? false,
                cameraOn: state?.videoEnabled ?? false,
                screenSharing: state?.screenSharing ?? false,
                controllable: state !== undefined,
            },
        };
    }

    private readonly update = (): void => {
        const next = UserPanelViewModel.computeSnapshot(
            this.props.client,
            this.user,
            this.callStore,
            this.callStateStore,
            this.profileStore,
            this.voiceStateStore,
        );
        // The call tells its state whenever somebody starts or stops speaking, which is none of the panel's
        if (JSON.stringify(next) !== JSON.stringify(this.snapshot.current)) this.snapshot.set(next);
    };

    private perform(action: CallAction): void {
        void (this.props.performAction ?? performCallAction)(action, "user-panel");
    }

    public onToggleMute = (): void => this.perform("toggle-mute");

    public onToggleDeafen = (): void => this.perform("toggle-deafen");

    public onToggleCamera = (): void => this.perform("toggle-camera");

    public onToggleScreenShare = (): void => {
        // What to share is chosen in the call, so the call is shown first
        if (!this.snapshot.current.call?.screenSharing) this.onJumpToCall();
        this.perform("toggle-screenshare");
    };

    public onLeaveCall = (): void => this.perform("leave-call");

    public onJumpToCall = (): void => {
        const call = UserPanelViewModel.currentCall(this.callStore);
        if (!call) return;
        dispatcher.dispatch<ViewRoomPayload>({
            action: Action.ViewRoom,
            room_id: call.roomId,
            view_call: true,
            metricsTrigger: undefined,
        });
    };

    public onOpenSettings = (): void => {
        dispatcher.fire(Action.ViewUserSettings);
    };

    public onOpenProfile = (): void => {
        dispatcher.fire(Action.ViewUserSettings);
    };
}
