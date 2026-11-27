/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { type MouseEvent } from "react";
import {
    EventTimeline,
    EventType,
    type MatrixClient,
    type MatrixEvent,
    MatrixEventEvent,
    type Room,
    RoomEvent,
    type RoomMember,
} from "matrix-js-sdk/src/matrix";
import { type IRTCNotificationContent } from "matrix-js-sdk/src/matrixrtc";
import { CallType } from "matrix-js-sdk/src/webrtc/call";
import {
    BaseViewModel,
    type CallEventTileViewActions,
    type CallEventTileViewSnapshot,
    type CallTileButton,
    type CallTilePerson,
} from "@element-hq/web-shared-components";

import type { GetRelationsForEvent } from "../../components/views/rooms/EventTile";
import type LegacyCallHandler from "../../LegacyCallHandler";
import { type CallStore, CallStoreEvent } from "../../stores/CallStore";
import {
    LatestRtcNotificationEventUpdate,
    type LatestRtcNotificationEventStore,
} from "../../stores/LatestRtcNotificationEventStore";
import { type Call, CallEvent, ConnectionState, type ElementCall, JitsiCall } from "../../models/Call";
import { placeCall } from "../../utils/room/placeCall";
import { PlatformCallType } from "../../hooks/room/useRoomCall";
import SettingsStore from "../../settings/SettingsStore";
import { mediaFromMxc } from "../../customisations/Media";
import { getDeclinedEvents } from "../room/timeline/event-tile/call/common";
import { getTimeFromEvent } from "../room/timeline/event-tile/call/tiles/tombstone/common";
import {
    type CallMembershipChange,
    type CallSummary,
    callTileOutcome,
    isActiveCallMembership,
    summariseCall,
} from "../../intercom/CallTile";

/** The side of the avatars on the tile, in px */
const AVATAR_SIZE = 20;
/** No notification rings for longer than this, whatever it says (MSC4075) */
const MAX_RING_MS = 120_000;

export interface CallEventTileViewModelProps {
    /** The event that announced the call: an `m.rtc.notification` */
    mxEvent: MatrixEvent;
    /** Finds the events that relate to another, for who declined the call */
    getRelationsForEvent?: GetRelationsForEvent;
    /** The client */
    cli: MatrixClient;
    /** The calls of the rooms */
    callStore: CallStore;
    /** Starts and joins calls */
    legacyCallHandler: LegacyCallHandler;
    /** Which notification the running call of a room belongs to */
    latestRtcNotificationEventStore: LatestRtcNotificationEventStore;
}

/** The call of the room, if it is one of Element Call's. */
function callOf(props: CallEventTileViewModelProps): ElementCall | null {
    const roomId = props.mxEvent.getRoomId();
    const call = roomId ? props.callStore.getCall(roomId) : null;
    return call && !(call instanceof JitsiCall) ? (call as ElementCall) : null;
}

/**
 * Whether the notification is the one of the call running in its room: the store says which is,
 * and an event of the user's own that the server has not confirmed yet can only be of a call
 * they have just started. (As Element's own tile decides it.)
 */
function isOngoing(props: CallEventTileViewModelProps, call: ElementCall | null): boolean {
    if (!call) return false;
    const eventId = props.mxEvent.getId();
    const latest = props.latestRtcNotificationEventStore.getLatestEventId(props.mxEvent.getRoomId()!);
    return latest === eventId || !!eventId?.startsWith("~");
}

/** When the call was announced: the sender's clock, unless it is far from the server's. */
function announcedAt(mxEvent: MatrixEvent): number {
    const senderTs = mxEvent.getContent<IRTCNotificationContent>()["sender_ts"];
    const serverTs = mxEvent.getTs();
    return typeof senderTs === "number" && Math.abs(senderTs - serverTs) <= 20_000 ? senderTs : serverTs;
}

/** Until when the notification rings, if it rings at all. */
function ringsUntil(mxEvent: MatrixEvent): number | undefined {
    const content = mxEvent.getContent<IRTCNotificationContent>();
    if (content["notification_type"] !== "ring") return undefined;
    const lifetime = typeof content["lifetime"] === "number" ? content["lifetime"] : 0;
    return announcedAt(mxEvent) + Math.min(Math.max(lifetime, 0), MAX_RING_MS);
}

/**
 * What the room's history tells of the call a notification announced: the notification points at
 * the membership the call started with, and the memberships after it show who joined and when the
 * last one left. Nothing where the history does not hold that membership (it is encrypted, not a
 * state event, or not loaded).
 */
export function summariseCallOf(room: Room, mxEvent: MatrixEvent): { startTs: number; summary: CallSummary } | null {
    const membershipId = mxEvent.getRelation()?.event_id;
    if (!membershipId) return null;
    const events = room.getTimelineForEvent(membershipId)?.getEvents();
    const start = events?.findIndex((event) => event.getId() === membershipId) ?? -1;
    if (!events || start < 0) return null;

    const changes: CallMembershipChange[] = [];
    for (const event of events.slice(start)) {
        if (event.getType() !== EventType.GroupCallMemberPrefix || !event.isState()) continue;
        changes.push({
            ts: event.getTs(),
            userId: event.getSender()!,
            key: event.getStateKey()!,
            joined: isActiveCallMembership(event.getContent()),
        });
    }
    return { startTs: events[start].getTs(), summary: summariseCall(changes) };
}

function person(member: RoomMember): CallTilePerson {
    const mxc = member.getMxcAvatarUrl();
    return {
        id: member.userId,
        name: member.name,
        avatarUrl: (mxc && mediaFromMxc(mxc).getSquareThumbnailHttp(AVATAR_SIZE)) || undefined,
    };
}

function computeSnapshot(props: CallEventTileViewModelProps): CallEventTileViewSnapshot {
    const { mxEvent, cli } = props;
    const roomId = mxEvent.getRoomId();
    const room = roomId ? cli.getRoom(roomId) : null;
    if (!room) throw new Error(`No room for the call notification ${mxEvent.getId()}`);

    const startedBy = mxEvent.getSender()!;
    const ownUserId = cli.getSafeUserId();
    const call = callOf(props);
    const ongoing = isOngoing(props, call);
    const participants = ongoing ? Array.from(call!.participants.keys()) : [];
    const history = ongoing ? null : summariseCallOf(room, mxEvent);
    const declined = !!getDeclinedEvents(mxEvent, props.getRelationsForEvent)?.length;
    const canJoin = !!room
        .getLiveTimeline()
        .getState(EventTimeline.FORWARDS)
        ?.mayClientSendStateEvent(EventType.GroupCallMemberPrefix, cli);

    const outcome = callTileOutcome({
        ongoing,
        outgoing: startedBy === ownUserId,
        startedBy,
        ownUserId,
        ring: mxEvent.getContent<IRTCNotificationContent>()["notification_type"] === "ring",
        ringUntil: ringsUntil(mxEvent),
        now: Date.now(),
        othersInCall: participants.some((member) => member.userId !== startedBy),
        joined: ongoing && call!.connected,
        canJoin,
        leaving: ongoing && call!.connectionState === ConnectionState.Disconnecting,
        declined,
        startTs: history?.startTs ?? announcedAt(mxEvent),
        summary: history?.summary,
    });

    return {
        state: outcome.state,
        video: mxEvent.getContent<IRTCNotificationContent>()["m.call.intent"] !== "audio",
        outgoing: startedBy === ownUserId,
        startedByName: mxEvent.sender?.name ?? startedBy,
        time: getTimeFromEvent(mxEvent, SettingsStore.getValue("showTwelveHourTimestamps")),
        participants: participants.map(person),
        // The oldest membership still in the call, as Element's own tile counts
        startedAt: ongoing ? (call!.session.memberships.at(0)?.createdTs() ?? announcedAt(mxEvent)) : undefined,
        durationMs: outcome.durationMs,
        joined: ongoing && call!.connected,
        buttons: outcome.buttons,
        disabledButtons: outcome.disabledButtons,
    };
}

/**
 * The view model of a call's tile in the timeline, for a call announced by an
 * `m.rtc.notification`: Element Call's calls, in rooms and between two people. It follows the
 * call while it runs (who is in it, whether the user is) and says afterwards what became of it.
 */
export class CallEventTileViewModel
    extends BaseViewModel<CallEventTileViewSnapshot, CallEventTileViewModelProps>
    implements CallEventTileViewActions
{
    /** The call whose changes are listened to, and how to stop listening */
    private watchedCall: Call | null = null;
    private ringTimer?: ReturnType<typeof setTimeout>;

    public constructor(props: CallEventTileViewModelProps) {
        super(props, computeSnapshot(props));
        const roomId = props.mxEvent.getRoomId()!;

        this.disposables.trackListener(props.callStore, CallStoreEvent.Call, ((_: unknown, changedRoomId: string) => {
            if (changedRoomId === roomId) this.update();
        }) as (...args: unknown[]) => void);
        this.disposables.trackListener(props.latestRtcNotificationEventStore, LatestRtcNotificationEventUpdate, ((
            changedRoomId: string,
        ) => {
            if (changedRoomId === roomId) this.update();
        }) as (...args: unknown[]) => void);
        // Somebody declining the call
        this.disposables.trackListener(props.mxEvent, MatrixEventEvent.RelationsCreated, this.update);
        // The end of the call, and who was in it, come with the room's history
        const room = props.cli.getRoom(roomId);
        if (room) {
            this.disposables.trackListener(room, RoomEvent.Timeline, ((event: MatrixEvent) => {
                if (event.getType() === EventType.GroupCallMemberPrefix && this.getSnapshot().state !== "ongoing") {
                    this.update();
                }
            }) as (...args: unknown[]) => void);
        }
        const watcher = SettingsStore.watchSetting("showTwelveHourTimestamps", null, this.update);
        this.disposables.track(() => SettingsStore.unwatchSetting(watcher));
        this.disposables.track(() => {
            this.watchCall(null);
            clearTimeout(this.ringTimer);
        });

        this.follow();
    }

    /** Works out anew what the tile shows. */
    private update = (): void => {
        if (this.isDisposed) return;
        this.snapshot.set(computeSnapshot(this.props));
        this.follow();
    };

    /** Listens to the call that is running now, and wakes up when it stops ringing. */
    private follow(): void {
        const call = callOf(this.props);
        this.watchCall(call && isOngoing(this.props, call) ? call : null);

        clearTimeout(this.ringTimer);
        const ringUntil = ringsUntil(this.props.mxEvent);
        if (this.getSnapshot().state === "ringing" && ringUntil !== undefined) {
            this.ringTimer = setTimeout(this.update, Math.max(0, ringUntil - Date.now()) + 50);
        }
    }

    private watchCall(call: Call | null): void {
        if (call === this.watchedCall) return;
        this.watchedCall?.off(CallEvent.Participants, this.update);
        this.watchedCall?.off(CallEvent.ConnectionState, this.update);
        this.watchedCall = call;
        call?.on(CallEvent.Participants, this.update);
        call?.on(CallEvent.ConnectionState, this.update);
    }

    public onButton = (button: CallTileButton, event?: MouseEvent<HTMLButtonElement>): void => {
        switch (button) {
            case "join":
            case "accept":
            case "call_back":
                this.join(event);
                break;
            case "leave":
                void callOf(this.props)?.disconnect();
                break;
            default:
                break;
        }
    };

    /**
     * Joins the call of the room, or starts one: what the Join button of Element's own tile does
     * (`BaseOngoingCallViewModel.join`), which is also what the call button of the room does.
     */
    private join(event?: MouseEvent<HTMLButtonElement>): void {
        const room = this.props.cli.getRoom(this.props.mxEvent.getRoomId());
        if (!room) return;
        const type = this.getSnapshot().video ? CallType.Video : CallType.Voice;
        void placeCall(
            this.props.legacyCallHandler,
            room,
            type,
            PlatformCallType.ElementCall,
            event?.shiftKey || undefined,
            type === CallType.Voice,
        );
    }
}
