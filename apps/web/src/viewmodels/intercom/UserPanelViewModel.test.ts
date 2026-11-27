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
import { ConnectionStatsStore, ConnectionStatsStoreEvent } from "../../intercom/ConnectionStats";
import {
    DeviceAvailabilityEvent,
    type DeviceUnavailability,
    type MicrophoneAvailability,
} from "../../intercom/DeviceAvailability";
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

/** The app's own look at the microphone, which the tests set */
class FakeMicrophone extends Emitter {
    public unavailable: DeviceUnavailability | undefined;
    public watch = vi.fn();
    public set(unavailable: DeviceUnavailability | undefined): void {
        this.unavailable = unavailable;
        this.emit(DeviceAvailabilityEvent.Update);
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
    let connectionStore: ConnectionStatsStore;
    let now: number;
    let microphone: FakeMicrophone;
    let profileStore: FakeProfileStore;
    let user: Emitter & { presence?: string; lastPresenceTs?: number };
    let client: MatrixClient;
    let performAction: Mock<(action: CallAction, source: string) => Promise<number>>;

    const create = (): UserPanelViewModel =>
        new UserPanelViewModel({
            client,
            callStore: callStore as unknown as CallStore,
            callStateStore,
            connectionStore,
            voiceStateStore,
            microphone: microphone as unknown as MicrophoneAvailability,
            profileStore: profileStore as unknown as OwnProfileStore,
            performAction,
        });

    beforeEach(() => {
        callStore = new FakeCallStore();
        callStateStore = new CallStateStore();
        now = 1_000_000;
        connectionStore = new ConnectionStatsStore(() => now);
        voiceStateStore = new VoiceStateStore({
            storage: { getItem: () => null, setItem: () => {} },
            playCue: () => {},
            log: () => {},
        });
        microphone = new FakeMicrophone();
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
            micUnavailable: undefined,
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
            cameraUnavailable: undefined,
            screenSharing: false,
            canShareScreen: true,
            controllable: false,
            aloneDeadline: undefined,
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

    it("shows when a call the user is alone in leaves by itself, and stays in it when asked", () => {
        const vm = create();
        callStore.connect(ROOM);
        callStateStore.setState(ROOM, parseCallState({ audio_enabled: true }, 1_000));
        expect(vm.getSnapshot().call?.aloneDeadline).toBeUndefined();

        // Everybody else left
        const alone = parseCallState({ audio_enabled: true, alone: { ms_left: 300_000, seq: 1 } }, 1_000);
        callStateStore.setState(ROOM, alone);
        expect(vm.getSnapshot().call?.aloneDeadline).toBe(301_000);

        // The same countdown told again is nothing to render anew
        const listener = vi.fn();
        vm.subscribe(listener);
        callStateStore.setState(
            ROOM,
            parseCallState({ audio_enabled: true, alone: { ms_left: 290_010, seq: 1 } }, 11_000, alone),
        );
        expect(listener).not.toHaveBeenCalled();

        vm.onStayInCall();
        expect(performAction).toHaveBeenLastCalledWith("stay-in-call", "user-panel");
        callStateStore.setState(
            ROOM,
            parseCallState({ audio_enabled: true, alone: { ms_left: 300_000, seq: 2 } }, 11_000, alone),
        );
        expect(vm.getSnapshot().call?.aloneDeadline).toBe(311_000);

        // Somebody came back
        callStateStore.setState(ROOM, parseCallState({ audio_enabled: true }, 20_000));
        expect(vm.getSnapshot().call?.aloneDeadline).toBeUndefined();
    });

    it("starts and stops a screen share where the call is, without showing the call", () => {
        const dispatch = vi.spyOn(dispatcher, "dispatch").mockImplementation(() => {});
        const vm = create();
        callStore.connect(ROOM);
        callStateStore.setState(ROOM, parseCallState({ screen_sharing: false }));

        vm.onToggleScreenShare();
        expect(performAction).toHaveBeenLastCalledWith("toggle-screenshare", "user-panel");

        callStateStore.setState(ROOM, parseCallState({ screen_sharing: true }));
        vm.onToggleScreenShare();
        expect(performAction).toHaveBeenCalledTimes(2);
        expect(dispatch).not.toHaveBeenCalled();
        dispatch.mockRestore();
    });

    it("shows the call, then opens the settings of the screen share in it", () => {
        const order: string[] = [];
        const dispatch = vi.spyOn(dispatcher, "dispatch").mockImplementation(() => {
            order.push("show");
        });
        performAction.mockImplementation(async (action) => {
            order.push(action);
            return 1;
        });
        const vm = create();
        callStore.connect(ROOM);

        vm.onOpenShareSettings();
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewRoom, room_id: ROOM, view_call: true }),
        );
        expect(performAction.mock.calls).toEqual([["screenshare-settings", "user-panel"]]);
        expect(order).toEqual(["show", "screenshare-settings"]);
        dispatch.mockRestore();
    });

    it("starts looking for a microphone, and shows what the app finds while there is no call", () => {
        const vm = create();
        expect(microphone.watch).toHaveBeenCalled();
        expect(vm.getSnapshot().micUnavailable).toBeUndefined();

        microphone.set("no-device");
        expect(vm.getSnapshot()).toMatchObject({ micUnavailable: "no-device", muted: false });
        microphone.set("no-permission");
        expect(vm.getSnapshot().micUnavailable).toBe("no-permission");
        // Plugged in, or allowed
        microphone.set(undefined);
        expect(vm.getSnapshot().micUnavailable).toBeUndefined();
    });

    it("takes the call's word for the microphone, the camera and the screen while there is a call", () => {
        const vm = create();
        microphone.set("no-device");
        callStore.connect(ROOM);
        // A call that tells nothing: the app's own look still counts
        expect(vm.getSnapshot().micUnavailable).toBe("no-device");

        // The call opened a microphone the app could not see
        callStateStore.setState(
            ROOM,
            parseCallState({
                audio_enabled: true,
                audio_state: "on",
                video_state: "no-device",
                can_share_screen: false,
            }),
        );
        expect(vm.getSnapshot()).toMatchObject({
            micUnavailable: undefined,
            call: { cameraOn: false, cameraUnavailable: "no-device", canShareScreen: false },
        });

        // And the other way round: the call is refused what the app thinks is there
        microphone.set(undefined);
        callStateStore.setState(
            ROOM,
            parseCallState({ audio_state: "no-permission", video_enabled: true, video_state: "on" }),
        );
        expect(vm.getSnapshot()).toMatchObject({
            micUnavailable: "no-permission",
            call: { cameraOn: true, cameraUnavailable: undefined, canShareScreen: true },
        });

        // The call is over: back to what the app sees
        callStore.connect();
        expect(vm.getSnapshot().micUnavailable).toBeUndefined();
    });

    it("has everything there in a call that tells nothing of it, as one from before", () => {
        const vm = create();
        callStore.connect(ROOM);
        callStateStore.setState(ROOM, parseCallState({ audio_enabled: false, video_enabled: false }));
        expect(vm.getSnapshot()).toMatchObject({
            micUnavailable: undefined,
            call: { cameraUnavailable: undefined, canShareScreen: true, controllable: true },
        });
    });

    it("leaves the user's mute as it is while there is no microphone", () => {
        const vm = create();
        voiceStateStore.perform("mute", "panel");
        microphone.set("no-device");
        expect(vm.getSnapshot()).toMatchObject({ muted: true, micUnavailable: "no-device" });
        expect(voiceStateStore.state.muted).toBe(true);
        microphone.set(undefined);
        expect(vm.getSnapshot()).toMatchObject({ muted: true, micUnavailable: undefined });
    });

    it("shows how good the connection is once the call tells, and not its figures", () => {
        const vm = create();
        callStore.connect(ROOM);
        expect(vm.getSnapshot().call?.quality).toBeUndefined();
        connectionStore.setStats(ROOM, { quality: "fair", rttMs: 140, lossPct: 1 });
        expect(vm.getSnapshot().call).toMatchObject({ quality: "fair" });
        expect(vm.getSnapshot().call?.connection).toBeUndefined();

        // Other figures of the same quality are nothing to draw anew for
        const before = vm.getSnapshot();
        connectionStore.setStats(ROOM, { quality: "fair", rttMs: 150, lossPct: 2 });
        expect(vm.getSnapshot()).toBe(before);

        connectionStore.clear(ROOM);
        expect(vm.getSnapshot().call?.quality).toBeUndefined();
    });

    it("asks for the details of the connection while they are open, and shows them with a minute of ping", () => {
        const vm = create();
        callStore.connect(ROOM);
        connectionStore.setStats(ROOM, { quality: "good", rttMs: 30 });
        const onDetailed = vi.fn();
        connectionStore.onDetailed(onDetailed);

        vm.onConnectionDetails(true);
        vm.onConnectionDetails(true);
        expect(onDetailed.mock.calls).toEqual([[true]]);
        // What is known already is shown at once
        expect(vm.getSnapshot().call?.connection).toMatchObject({ pingMs: 30, averagePingMs: 30 });

        now += 1000;
        connectionStore.setStats(ROOM, {
            quality: "good",
            rttMs: 40,
            detail: {
                lossOutPct: 0.3,
                lossInPct: 1,
                jitterMs: 8,
                server: "sfu.example.org",
                transport: "udp",
                encrypted: true,
                audio: { codec: "opus", bitrate: 32000 },
                share: { width: 1920, height: 1080, fps: 30, bitrate: 2500000 },
            },
        });
        const connection = vm.getSnapshot().call?.connection;
        expect(connection).toEqual({
            pingMs: 40,
            averagePingMs: 35,
            pingHistory: [...new Array<null>(58).fill(null), 30, 40],
            lossOutPct: 0.3,
            lossInPct: 1,
            jitterMs: 8,
            server: "sfu.example.org",
            transport: "udp",
            encrypted: true,
            audio: { codec: "opus", bitrate: 32000 },
            share: { width: 1920, height: 1080, fps: 30, bitrate: 2500000 },
        });

        vm.onConnectionDetails(false);
        expect(onDetailed).toHaveBeenLastCalledWith(false);
        expect(vm.getSnapshot().call?.connection).toBeUndefined();
        expect(vm.getSnapshot().call?.quality).toBe("good");
    });

    it("has no details for a call that tells none, and none without a call", () => {
        const vm = create();
        vm.onConnectionDetails(true);
        expect(vm.getSnapshot().call).toBeUndefined();
        callStore.connect(ROOM);
        expect(vm.getSnapshot().call?.connection).toBeUndefined();
    });

    it("shows the call, then toggles its diagnostics overlay", () => {
        const dispatched = vi.spyOn(dispatcher, "dispatch").mockImplementation(() => {});
        const vm = create();
        callStore.connect(ROOM);
        vm.onOpenDiagnostics();
        expect(dispatched).toHaveBeenCalledWith(
            expect.objectContaining({ action: Action.ViewRoom, room_id: ROOM, view_call: true }),
        );
        expect(performAction).toHaveBeenCalledWith("toggle-diagnostics", "user-panel");
        dispatched.mockRestore();
    });

    it("stops asking for the details when disposed while they are open", () => {
        const vm = create();
        vm.onConnectionDetails(true);
        expect(connectionStore.detailed).toBe(true);
        vm.dispose();
        expect(connectionStore.detailed).toBe(false);
        expect(connectionStore.listenerCount(ConnectionStatsStoreEvent.Update)).toBe(0);
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
        expect(microphone.listenerCount(DeviceAvailabilityEvent.Update)).toBe(0);
        expect(user.listenerCount(UserEvent.Presence)).toBe(0);
    });
});
