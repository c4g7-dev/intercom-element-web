/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// oxlint-disable element-web/require-test-teardown -- the stores here are emitters made per test, with nothing to release

import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type MatrixClient, UserEvent, TypedEventEmitter } from "matrix-js-sdk/src/matrix";

import { UserPanelViewModel } from "./UserPanelViewModel";
import { type CallStore, CallStoreEvent } from "../../stores/CallStore";
import { type Call } from "../../models/Call";
import { CallStateStore, parseCallState } from "../../intercom/CallStateStore";
import { VoiceStateStore } from "../../intercom/VoiceStateStore";
import { type CallAction } from "../../intercom/CallActions";
import { type OwnProfileStore } from "../../stores/OwnProfileStore";
import { UPDATE_EVENT } from "../../stores/AsyncStore";
import dispatcher from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";

/** A plain emitter, standing in for the stores and objects the code under test listens to. */
class Emitter extends TypedEventEmitter<string, Record<string, (...args: unknown[]) => void>> {}

vi.mock("../../stores/CallStore", () => ({
    CallStore: { instance: undefined },
    CallStoreEvent: { Call: "call", ConnectedCalls: "connected_calls" },
}));
vi.mock("../../stores/OwnProfileStore", () => ({ OwnProfileStore: { instance: undefined } }));
vi.mock("../../intercom/CallActions", () => ({ performCallAction: vi.fn() }));

const ME = "@ada:x";
const ROOM = "!voice:x";

class FakeCallStore extends Emitter {
    public connectedCalls = new Set<Call>();
    public connect(...roomIds: string[]): void {
        this.connectedCalls = new Set(roomIds.map((roomId) => ({ roomId }) as unknown as Call));
        this.emit(CallStoreEvent.ConnectedCalls, this.connectedCalls, new Set());
    }
}

class FakeProfileStore extends Emitter {
    public displayName: string | null = "Ada";
    public avatar: string | null = "http://media/ada";
    public getHttpAvatarUrl = (): string | null => this.avatar;
}

describe("UserPanelViewModel", () => {
    let callStore: FakeCallStore;
    let callStateStore: CallStateStore;
    let voiceStateStore: VoiceStateStore;
    let profileStore: FakeProfileStore;
    let user: Emitter & { presence?: string; lastPresenceTs?: number };
    let client: MatrixClient;
    let performAction: Mock<(action: CallAction, source: string) => Promise<number>>;

    const create = (): UserPanelViewModel =>
        new UserPanelViewModel({
            client,
            callStore: callStore as unknown as CallStore,
            callStateStore,
            voiceStateStore,
            profileStore: profileStore as unknown as OwnProfileStore,
            performAction,
        });

    beforeEach(() => {
        callStore = new FakeCallStore();
        callStateStore = new CallStateStore();
        voiceStateStore = new VoiceStateStore({
            storage: { getItem: () => null, setItem: () => {} },
            playCue: () => {},
            log: () => {},
        });
        profileStore = new FakeProfileStore();
        user = Object.assign(new Emitter(), { presence: "online", lastPresenceTs: 1 });
        client = {
            getSafeUserId: () => ME,
            getUser: () => user,
            getRoom: (roomId: string) => (roomId === ROOM ? { name: "Lounge" } : null),
        } as unknown as MatrixClient;
        performAction = vi.fn<(action: CallAction, source: string) => Promise<number>>().mockResolvedValue(1);
    });

    it("shows who the user is, with no call", () => {
        expect(create().getSnapshot()).toEqual({
            userId: ME,
            displayName: "Ada",
            avatarUrl: "http://media/ada",
            presence: "online",
            muted: false,
            deafened: false,
            call: undefined,
        });
    });

    it("falls back to the user ID, no avatar and no presence where there is none", () => {
        profileStore.displayName = null;
        profileStore.avatar = null;
        // What a server without presence leaves everybody at
        user.presence = "offline";
        user.lastPresenceTs = 0;
        expect(create().getSnapshot()).toMatchObject({ displayName: ME, avatarUrl: undefined, presence: undefined });
    });

    it("follows the profile and the presence", () => {
        const vm = create();
        profileStore.displayName = "Ada L.";
        profileStore.emit(UPDATE_EVENT);
        user.presence = "unavailable";
        user.emit(UserEvent.Presence);
        expect(vm.getSnapshot()).toMatchObject({ displayName: "Ada L.", presence: "unavailable" });
    });

    it("shows the call the user is in, and its controls once the call tells its state", () => {
        const vm = create();
        callStore.connect(ROOM);
        // In a call that has not told anything (yet, or ever: not the InterCom call)
        expect(vm.getSnapshot().call).toEqual({
            roomName: "Lounge",
            reconnecting: false,
            cameraOn: false,
            screenSharing: false,
            controllable: false,
        });

        callStateStore.setState(
            ROOM,
            parseCallState({ audio_enabled: false, video_enabled: true, deafened: true, screen_sharing: true }),
        );
        expect(vm.getSnapshot()).toMatchObject({
            call: { cameraOn: true, screenSharing: true, controllable: true, reconnecting: false },
        });

        callStateStore.setState(ROOM, parseCallState({ audio_enabled: true, reconnecting: true }));
        expect(vm.getSnapshot()).toMatchObject({ call: { reconnecting: true } });

        callStore.connect();
        expect(vm.getSnapshot().call).toBeUndefined();
    });

    it("shows the app's mute and deafen, with or without a call", () => {
        const vm = create();
        expect(vm.getSnapshot()).toMatchObject({ muted: false, deafened: false });
        voiceStateStore.perform("toggle-deafen", "cli");
        expect(vm.getSnapshot()).toMatchObject({ muted: true, deafened: true, call: undefined });
        voiceStateStore.perform("toggle-deafen", "cli");
        voiceStateStore.perform("mute", "tray");
        expect(vm.getSnapshot()).toMatchObject({ muted: true, deafened: false });
        // What a call says of its microphone is the store's to take over, not the panel's to show
        callStore.connect(ROOM);
        callStateStore.setState(ROOM, parseCallState({ audio_enabled: true }));
        expect(vm.getSnapshot()).toMatchObject({ muted: true, deafened: false });
    });

    it("does not render anew for somebody speaking", () => {
        const vm = create();
        callStore.connect(ROOM);
        callStateStore.setState(ROOM, parseCallState({ audio_enabled: true }));
        const listener = vi.fn();
        vm.subscribe(listener);
        callStateStore.setState(
            ROOM,
            parseCallState({ audio_enabled: true, participants: [{ user_id: "@ben:x", speaking: true }] }),
        );
        expect(listener).not.toHaveBeenCalled();
    });

    it("hands the buttons to the call as the shortcuts do", () => {
        const vm = create();
        callStore.connect(ROOM);
        vm.onToggleMute();
        vm.onToggleDeafen();
        vm.onToggleCamera();
        vm.onLeaveCall();
        expect(performAction.mock.calls).toEqual([
            ["toggle-mute", "user-panel"],
            ["toggle-deafen", "user-panel"],
            ["toggle-camera", "user-panel"],
            ["leave-call", "user-panel"],
        ]);
    });

    it("shows the call before starting a screen share, and not for stopping one", () => {
        const dispatch = vi.spyOn(dispatcher, "dispatch").mockImplementation(() => {});
        const vm = create();
        callStore.connect(ROOM);
        callStateStore.setState(ROOM, parseCallState({ screen_sharing: false }));

        vm.onToggleScreenShare();
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewRoom, room_id: ROOM, view_call: true }),
        );
        expect(performAction).toHaveBeenLastCalledWith("toggle-screenshare", "user-panel");

        dispatch.mockClear();
        callStateStore.setState(ROOM, parseCallState({ screen_sharing: true }));
        vm.onToggleScreenShare();
        expect(dispatch).not.toHaveBeenCalled();
        expect(performAction).toHaveBeenCalledTimes(2);
        dispatch.mockRestore();
    });

    it("jumps to the call, and nowhere without one", () => {
        const dispatch = vi.spyOn(dispatcher, "dispatch").mockImplementation(() => {});
        const vm = create();
        vm.onJumpToCall();
        expect(dispatch).not.toHaveBeenCalled();
        callStore.connect(ROOM);
        vm.onJumpToCall();
        expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ room_id: ROOM, view_call: true }));
        dispatch.mockRestore();
    });

    it("opens the settings", () => {
        const fire = vi.spyOn(dispatcher, "fire").mockImplementation(() => {});
        const vm = create();
        vm.onOpenSettings();
        vm.onOpenProfile();
        expect(fire.mock.calls).toEqual([[Action.ViewUserSettings], [Action.ViewUserSettings]]);
        fire.mockRestore();
    });

    it("stops listening when disposed", () => {
        const vm = create();
        vm.dispose();
        expect(callStore.listenerCount(CallStoreEvent.ConnectedCalls)).toBe(0);
        expect(profileStore.listenerCount(UPDATE_EVENT)).toBe(0);
        expect(user.listenerCount(UserEvent.Presence)).toBe(0);
    });
});
