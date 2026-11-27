/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, type MouseEvent, useEffect, useState } from "react";
import VoiceCallSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call-solid";
import VoiceCallMissedSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call-missed-solid";
import VoiceCallDeclinedSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/voice-call-declined-solid";
import VideoCallSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call-solid";
import VideoCallMissedSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call-missed-solid";
import VideoCallDeclinedSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call-declined-solid";
import classNames from "classnames";

import styles from "./CallEventTileView.module.css";
import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { useI18n } from "../../core/i18n/i18nContext";
import { type RenderIntercomAvatar, renderIntercomAvatar } from "../IntercomAvatar/IntercomAvatar";
import { type CallTileState, callTileTitle, formatCallClock, stackCallParticipants } from "./callTile";

/** Somebody who is in the call. */
export interface CallTilePerson {
    /** The user's ID */
    id: string;
    /** The name to show */
    name: string;
    /** HTTP URL of the avatar, if they have one */
    avatarUrl?: string;
}

/**
 * A button of the tile: `join` and `leave` for a running call, `accept` and `decline` for one
 * that rings, `call_back` for one that was missed or turned down.
 */
export type CallTileButton = "join" | "leave" | "accept" | "decline" | "call_back";

export interface CallEventTileViewSnapshot {
    /** What the tile says about the call */
    state: CallTileState;
    /** Whether it is a video call (a camera on the tile) or a voice call (a phone) */
    video: boolean;
    /** Whether the user started the call themselves */
    outgoing: boolean;
    /** The name of whoever started the call */
    startedByName: string;
    /** The time of the call, formatted, shown at the right */
    time: string;
    /** Said instead of the text the state has, where the app knows better ("Answered elsewhere") */
    title?: string;
    /** Who is in the call, while it runs */
    participants: CallTilePerson[];
    /** When the call started, in ms since the epoch: a running call counts up from it */
    startedAt?: number;
    /** How long the call lasted, in ms, when it is over and that is known */
    durationMs?: number;
    /** Whether the user is in the call themselves */
    joined: boolean;
    /** The buttons to show, in order */
    buttons: CallTileButton[];
    /** The buttons that cannot be used right now (joining is not allowed, leaving is under way) */
    disabledButtons?: CallTileButton[];
}

export interface CallEventTileViewActions {
    /** Called when a button of the tile is clicked */
    onButton: (button: CallTileButton, event: MouseEvent<HTMLButtonElement>) => void;
}

/** The view model of a call's tile in the timeline. */
export type CallEventTileViewModel = ViewModel<CallEventTileViewSnapshot, CallEventTileViewActions>;

interface CallEventTileViewProps {
    /** The view model */
    vm: CallEventTileViewModel;
    /** Draws an avatar: the app's own, which loads the picture as its other avatars do */
    renderAvatar?: RenderIntercomAvatar;
}

const ICONS = {
    voice: { plain: VoiceCallSolidIcon, missed: VoiceCallMissedSolidIcon, declined: VoiceCallDeclinedSolidIcon },
    video: { plain: VideoCallSolidIcon, missed: VideoCallMissedSolidIcon, declined: VideoCallDeclinedSolidIcon },
};

const BUTTON_LABELS = {
    join: "intercom|call_tile|join",
    leave: "intercom|call_tile|leave",
    accept: "intercom|call_tile|accept",
    decline: "intercom|call_tile|decline",
    call_back: "intercom|call_tile|call_back",
} as const;

/** The time since `startedAt`, counted anew every second. */
function useElapsed(startedAt: number | undefined): number | undefined {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (startedAt === undefined) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return (): void => clearInterval(timer);
    }, [startedAt]);
    return startedAt === undefined ? undefined : now - startedAt;
}

/**
 * A call in the timeline: one tile for the call from its start to its end. While the call runs it
 * shows who is in it, for how long, and a button to join (or leave); afterwards what became of
 * it: ended and how long it took, missed, or declined.
 */
export function CallEventTileView({ vm, renderAvatar }: Readonly<CallEventTileViewProps>): JSX.Element {
    const { translate: _t } = useI18n();
    const snapshot = useViewModel(vm);
    const { state, video, time, participants, joined, buttons, disabledButtons } = snapshot;
    const live = state === "ongoing" || state === "ringing";
    const elapsed = useElapsed(state === "ongoing" ? snapshot.startedAt : undefined);

    const icons = video ? ICONS.video : ICONS.voice;
    const Icon = state === "missed" ? icons.missed : state === "declined" ? icons.declined : icons.plain;
    const { shown, more } = stackCallParticipants(participants);

    return (
        <div
            className={classNames(styles.tile, styles[state], "mx_IntercomCallTile")}
            data-state={state}
            data-testid="call-tile"
        >
            <span className={styles.icon} aria-hidden="true">
                <Icon width="20px" height="20px" />
            </span>
            <div className={styles.text}>
                <span className={styles.title}>{snapshot.title ?? callTileTitle(snapshot, _t)}</span>
                {state === "ongoing" && (participants.length > 0 || elapsed !== undefined) && (
                    <span className={styles.details}>
                        {participants.length > 0 && (
                            <span
                                className={styles.people}
                                role="img"
                                aria-label={_t("intercom|call_tile|people", { count: participants.length })}
                                title={participants.map((person) => person.name).join(", ")}
                            >
                                {shown.map((person) => (
                                    <span key={person.id} className={styles.person}>
                                        {renderIntercomAvatar(
                                            { id: person.id, name: person.name, url: person.avatarUrl, size: "20px" },
                                            renderAvatar,
                                        )}
                                    </span>
                                ))}
                                {more > 0 && <span className={styles.more}>+{more}</span>}
                            </span>
                        )}
                        {elapsed !== undefined && (
                            <span className={styles.clock} role="timer" aria-live="off">
                                {formatCallClock(elapsed)}
                            </span>
                        )}
                    </span>
                )}
            </div>
            {live && joined && <span className={styles.inCall}>{_t("intercom|call_tile|in_call")}</span>}
            {buttons.length > 0 && (
                <span className={styles.buttons}>
                    {buttons.map((button) => (
                        <button
                            key={button}
                            type="button"
                            className={classNames(styles.button, {
                                [styles.primary]: button === "join" || button === "accept",
                                [styles.danger]: button === "leave" || button === "decline",
                            })}
                            disabled={disabledButtons?.includes(button)}
                            onClick={(event) => vm.onButton(button, event)}
                        >
                            {_t(BUTTON_LABELS[button])}
                        </button>
                    ))}
                </span>
            )}
            <span className={styles.time}>{time}</span>
        </div>
    );
}
