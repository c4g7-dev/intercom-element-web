/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, type MouseEvent, useContext, useEffect, useRef, useState } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";
import { CallErrorCode, CallState } from "matrix-js-sdk/src/webrtc/call";
import {
    BaseViewModel,
    CallEventTileView,
    type CallEventTileViewActions,
    type CallEventTileViewSnapshot,
    type CallTileButton,
    useCreateAutoDisposedViewModel,
} from "@element-hq/web-shared-components";

import type { GetRelationsForEvent } from "../components/views/rooms/EventTile";
import type LegacyCallEventGrouper from "../components/structures/LegacyCallEventGrouper";
import { LegacyCallEventGrouperEvent } from "../components/structures/LegacyCallEventGrouper";
import { SDKContext } from "../contexts/SDKContext";
import MatrixClientContext, { useMatrixClientContext } from "../contexts/MatrixClientContext";
import { CallEventTileViewModel } from "../viewmodels/intercom/CallEventTileViewModel";
import { ConnectionState, type ElementCall } from "../models/Call";
import { useCall, useConnectionState, useParticipatingMembers } from "../hooks/useCall";
import { useSettingValue } from "../hooks/useSettings";
import defaultDispatcher from "../dispatcher/dispatcher";
import { Action } from "../dispatcher/actions";
import type { ViewRoomPayload } from "../dispatcher/payloads/ViewRoomPayload";
import { formatTime } from "../DateUtils";
import { _t } from "../languageHandler";
import { mediaFromMxc } from "../customisations/Media";
import { renderIntercomAvatar } from "./Avatar";
import { type LegacyCallFacts, type LegacyCallTileOutcome, legacyCallTileOutcome } from "./CallTile";

/** The tile of a call announced by an `m.rtc.notification`: Element Call's calls. */
export function RtcCallEventTile({
    mxEvent,
    getRelationsForEvent,
}: {
    mxEvent: MatrixEvent;
    getRelationsForEvent?: GetRelationsForEvent;
}): JSX.Element {
    const sdkContext = useContext(SDKContext);
    const cli = useMatrixClientContext();
    const vm = useCreateAutoDisposedViewModel(
        () =>
            new CallEventTileViewModel({
                mxEvent,
                getRelationsForEvent,
                cli,
                callStore: sdkContext.callStore,
                latestRtcNotificationEventStore: sdkContext.latestRtcNotificationEventStore,
                legacyCallHandler: sdkContext.legacyCallHandler,
            }),
    );
    return <CallEventTileView vm={vm} renderAvatar={renderIntercomAvatar} />;
}

type OnButton = CallEventTileViewActions["onButton"];

/** A view model that shows what the component owning it works out. */
class GivenCallTileViewModel
    extends BaseViewModel<CallEventTileViewSnapshot, { onButton: { current: OnButton } }>
    implements CallEventTileViewActions
{
    public constructor(props: { onButton: { current: OnButton } }, snapshot: CallEventTileViewSnapshot) {
        super(props, snapshot);
    }

    public show(snapshot: CallEventTileViewSnapshot): void {
        this.snapshot.set(snapshot);
    }

    public onButton = (button: CallTileButton, event: MouseEvent<HTMLButtonElement>): void => {
        this.props.onButton.current(button, event);
    };
}

/** The view for a snapshot worked out in a component (from hooks), with its button handler. */
function GivenCallTile({
    snapshot,
    onButton,
}: {
    snapshot: CallEventTileViewSnapshot;
    onButton: OnButton;
}): JSX.Element {
    const handler = useRef(onButton);
    handler.current = onButton;
    const vm = useCreateAutoDisposedViewModel(() => new GivenCallTileViewModel({ onButton: handler }, snapshot));
    const key = JSON.stringify(snapshot);
    useEffect(() => {
        vm.show(JSON.parse(key));
    }, [vm, key]);
    return <CallEventTileView vm={vm} renderAvatar={renderIntercomAvatar} />;
}

function useTime(mxEvent: MatrixEvent): string {
    const showTwelveHour = useSettingValue("showTwelveHourTimestamps");
    return formatTime(new Date(mxEvent.getTs()), showTwelveHour);
}

function legacyPhase(state: CallState | undefined): LegacyCallFacts["phase"] {
    switch (state) {
        case CallState.Ringing:
            return "ringing";
        case CallState.Connecting:
            return "connecting";
        case CallState.Connected:
            return "connected";
        case CallState.Ended:
            return "ended";
        default:
            return undefined;
    }
}

/** What Element's own tile says of a call that failed, by the reason of its hangup. */
function failureText(hangupReason: string | null): string {
    switch (hangupReason) {
        case CallErrorCode.IceFailed:
            return _t("timeline|m.call.invite|failed_connect_media");
        case "ice_timeout":
            return _t("timeline|m.call.invite|failed_connection");
        case CallErrorCode.NoUserMedia:
            return _t("timeline|m.call.invite|failed_opponent_media");
        case "unknown_error":
            return _t("timeline|m.call.invite|unknown_error");
        case CallErrorCode.UserBusy:
            return _t("voip|user_busy_description");
        default:
            return _t("timeline|m.call.invite|unknown_failure", { reason: hangupReason ?? "" });
    }
}

function legacyTitle(note: LegacyCallTileOutcome["note"], hangupReason: string | null): string | undefined {
    switch (note) {
        case "connecting":
            return _t("voip|connecting");
        case "answered_elsewhere":
            return _t("timeline|m.call.invite|answered_elsewhere");
        case "failed":
            return failureText(hangupReason);
        case "unknown":
            return _t("timeline|m.call.invite|unknown_state");
        default:
            return undefined;
    }
}

/**
 * The tile of a call between two people made the old way (`m.call.invite`): the states and the
 * buttons of Element's `LegacyCallEvent`, which the same grouper feeds.
 */
export function LegacyCallEventTile({
    mxEvent,
    callEventGrouper,
}: {
    mxEvent: MatrixEvent;
    callEventGrouper: LegacyCallEventGrouper;
}): JSX.Element {
    const cli = useContext(MatrixClientContext);
    const [state, setState] = useState(callEventGrouper.state);
    // Since when the call is connected: the grouper tells its length every second
    const [startedAt, setStartedAt] = useState<number | undefined>(undefined);
    useEffect(() => {
        setState(callEventGrouper.state);
        const onLength = (seconds: number): void => {
            const since = Date.now() - seconds * 1000;
            setStartedAt((known) => (known !== undefined && Math.abs(known - since) < 1500 ? known : since));
        };
        callEventGrouper.addListener(LegacyCallEventGrouperEvent.StateChanged, setState);
        callEventGrouper.addListener(LegacyCallEventGrouperEvent.LengthChanged, onLength);
        return (): void => {
            callEventGrouper.removeListener(LegacyCallEventGrouperEvent.StateChanged, setState);
            callEventGrouper.removeListener(LegacyCallEventGrouperEvent.LengthChanged, onLength);
        };
    }, [callEventGrouper]);

    const hangupReason = callEventGrouper.hangupReason;
    const outgoing = mxEvent.getSender() === cli.getUserId();
    const outcome = legacyCallTileOutcome({
        phase: legacyPhase(state),
        outgoing,
        rejected: callEventGrouper.gotRejected,
        missed: callEventGrouper.callWasMissed,
        hangupReason,
        durationMs: callEventGrouper.duration,
        connectedSeconds: 0,
        now: 0,
    });

    const snapshot: CallEventTileViewSnapshot = {
        state: outcome.state,
        video: callEventGrouper.isVoice === false,
        outgoing,
        startedByName: mxEvent.sender?.name ?? mxEvent.getSender() ?? "",
        time: useTime(mxEvent),
        title: legacyTitle(outcome.note, hangupReason),
        participants: [],
        startedAt: outcome.state === "ongoing" ? startedAt : undefined,
        durationMs: outcome.durationMs,
        joined: outcome.joined,
        buttons: outcome.buttons,
    };
    const onButton: OnButton = (button) => {
        if (button === "accept") callEventGrouper.answerCall();
        else if (button === "decline") callEventGrouper.rejectCall();
        else if (button === "call_back") callEventGrouper.callBack();
    };
    return <GivenCallTile snapshot={snapshot} onButton={onButton} />;
}

/**
 * The tile of Element Call's call state event, where a call still has one: what Element's
 * `CallEvent` shows, joined and left the way it does.
 */
export function StateCallEventTile({ mxEvent }: { mxEvent: MatrixEvent }): JSX.Element {
    const client = useContext(MatrixClientContext);
    const roomId = mxEvent.getRoomId()!;
    const call = useCall(roomId) as ElementCall | null;
    const time = useTime(mxEvent);
    const latestEvent =
        client.getRoom(roomId)?.currentState.getStateEvents(mxEvent.getType(), mxEvent.getStateKey()!) ?? mxEvent;
    const over = "m.terminated" in latestEvent.getContent() || latestEvent.isRedacted();

    const common = {
        video: true,
        outgoing: mxEvent.getSender() === client.getUserId(),
        startedByName: mxEvent.sender?.name ?? mxEvent.getSender() ?? "",
        time,
    };
    if (over || !call) {
        const snapshot: CallEventTileViewSnapshot = {
            ...common,
            state: over ? "ended" : "ongoing",
            participants: [],
            durationMs: over ? latestEvent.getTs() - mxEvent.getTs() : undefined,
            joined: false,
            // There should be a call, but it has not loaded yet
            buttons: over ? [] : ["join"],
            disabledButtons: ["join"],
        };
        return <GivenCallTile snapshot={snapshot} onButton={() => {}} />;
    }
    return <RunningStateCallEventTile mxEvent={mxEvent} call={call} common={common} />;
}

function RunningStateCallEventTile({
    mxEvent,
    call,
    common,
}: {
    mxEvent: MatrixEvent;
    call: ElementCall;
    common: Pick<CallEventTileViewSnapshot, "video" | "outgoing" | "startedByName" | "time">;
}): JSX.Element {
    const connectionState = useConnectionState(call);
    const members = useParticipatingMembers(call);
    const joined = connectionState !== ConnectionState.Disconnected;

    const snapshot: CallEventTileViewSnapshot = {
        ...common,
        state: "ongoing",
        participants: members.map((member) => {
            const mxc = member.getMxcAvatarUrl();
            return {
                id: member.userId,
                name: member.name,
                avatarUrl: (mxc && mediaFromMxc(mxc).getSquareThumbnailHttp(20)) || undefined,
            };
        }),
        startedAt: call.session?.memberships.at(0)?.createdTs(),
        joined,
        buttons: [joined ? "leave" : "join"],
        disabledButtons: connectionState === ConnectionState.Disconnecting ? ["leave"] : [],
    };
    const onButton: OnButton = (button, event) => {
        event.preventDefault();
        if (button === "leave") {
            void call.disconnect();
        } else {
            defaultDispatcher.dispatch<ViewRoomPayload>({
                action: Action.ViewRoom,
                room_id: mxEvent.getRoomId()!,
                view_call: true,
                metricsTrigger: undefined,
            });
        }
    };
    return <GivenCallTile snapshot={snapshot} onButton={onButton} />;
}
