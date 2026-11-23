/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import { Avatar, IconButton } from "@vector-im/compound-web";
import MicOnSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/mic-on-solid";
import MicOffSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/mic-off-solid";
import HeadphonesSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/headphones-solid";
import HeadphonesOffSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/headphones-off-solid";
import SettingsSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/settings-solid";
import VideoCallSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call-solid";
import VideoCallOffSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call-off-solid";
import ShareScreenSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/share-screen-solid";
import EndCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/end-call";
import classNames from "classnames";

import styles from "./UserPanelView.module.css";
import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { useI18n } from "../../core/i18n/i18nContext";

/** Whether the user is around, as the homeserver has it. */
export type UserPanelPresence = "online" | "unavailable" | "offline" | "busy";

/** The call the user is in. */
export interface UserPanelCall {
    /** The name of the call's room */
    roomName: string;
    /** Whether the connection is being re-established */
    reconnecting: boolean;
    /** Whether the camera is on */
    cameraOn: boolean;
    /** Whether the user is sharing a screen */
    screenSharing: boolean;
    /**
     * Whether the call's controls can be driven from here. False for a call that does not tell
     * its state (not the InterCom build of Element Call): only leaving is offered then.
     */
    controllable: boolean;
}

export interface UserPanelViewSnapshot {
    /** The user's ID */
    userId: string;
    /** The user's display name */
    displayName: string;
    /** HTTP URL of the user's avatar, if they have one */
    avatarUrl?: string;
    /** The user's presence, or undefined where the homeserver has none */
    presence?: UserPanelPresence;
    /** Whether the microphone is off in the call */
    muted: boolean;
    /** Whether the user is deafened in the call */
    deafened: boolean;
    /** The call the user is in, if any */
    call?: UserPanelCall;
}

export interface UserPanelViewActions {
    /** Mutes or unmutes the microphone in the call */
    onToggleMute: () => void;
    /** Deafens or undeafens the user in the call */
    onToggleDeafen: () => void;
    /** Opens the settings */
    onOpenSettings: () => void;
    /** Opens the user's own menu or profile */
    onOpenProfile: () => void;
    /** Turns the camera on or off in the call */
    onToggleCamera: () => void;
    /** Starts or stops sharing a screen in the call */
    onToggleScreenShare: () => void;
    /** Leaves the call */
    onLeaveCall: () => void;
    /** Shows the call's room */
    onJumpToCall: () => void;
}

/** The view model of the user panel. */
export type UserPanelViewModel = ViewModel<UserPanelViewSnapshot, UserPanelViewActions>;

interface UserPanelViewProps {
    /** The view model */
    vm: UserPanelViewModel;
}

/** Three bars: all of them lit while connected, one while the connection is being re-established. */
function SignalBars({ lit }: { lit: number }): JSX.Element {
    return (
        <svg className={styles.signal} width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            {[0, 1, 2].map((bar) => (
                <rect
                    key={bar}
                    x={2 + bar * 5}
                    y={11 - bar * 4}
                    width="3.5"
                    height={5 + bar * 4}
                    rx="1"
                    fill="currentColor"
                    opacity={bar < lit ? 1 : 0.28}
                />
            ))}
        </svg>
    );
}

/**
 * The panel at the bottom of the room list: who you are, with the microphone, deafen and settings
 * buttons beside it, and, while you are in a call, a strip above it that says so, leads to the
 * call and holds its camera, screen share and leave buttons.
 */
export function UserPanelView({ vm }: Readonly<UserPanelViewProps>): JSX.Element {
    const { translate: _t } = useI18n();
    const { userId, displayName, avatarUrl, presence, muted, deafened, call } = useViewModel(vm);

    const presenceLabels: Record<UserPanelPresence, string> = {
        online: _t("intercom|user_panel|presence|online"),
        unavailable: _t("intercom|user_panel|presence|unavailable"),
        offline: _t("intercom|user_panel|presence|offline"),
        busy: _t("intercom|user_panel|presence|busy"),
    };
    const presenceLabel = presence ? presenceLabels[presence] : userId;
    const canControl = call?.controllable === true;
    const reason = call ? _t("intercom|user_panel|not_controllable") : _t("intercom|user_panel|not_in_call");
    // What a button of the call says: what it does, or why it does nothing right now
    const callTooltip = (action: string): string =>
        canControl ? action : _t("intercom|user_panel|unavailable", { action, reason });
    const muteLabel = muted && canControl ? _t("intercom|user_panel|unmute") : _t("intercom|user_panel|mute");
    const deafenLabel = deafened && canControl ? _t("intercom|user_panel|undeafen") : _t("intercom|user_panel|deafen");

    return (
        <section
            className={classNames(styles.panel, "mx_IntercomUserPanel")}
            aria-label={_t("intercom|user_panel|label")}
            data-testid="intercom-user-panel"
        >
            {call && (
                <div className={styles.call} data-testid="intercom-call-strip">
                    <div className={styles.callStatus}>
                        <span className={classNames(styles.callSignal, { [styles.reconnecting]: call.reconnecting })}>
                            <SignalBars lit={call.reconnecting ? 1 : 3} />
                        </span>
                        <button
                            type="button"
                            className={styles.callInfo}
                            onClick={vm.onJumpToCall}
                            title={_t("intercom|user_panel|jump_to_call")}
                        >
                            <span
                                className={classNames(styles.callState, { [styles.reconnecting]: call.reconnecting })}
                                role="status"
                            >
                                {call.reconnecting
                                    ? _t("intercom|user_panel|reconnecting")
                                    : _t("intercom|user_panel|voice_connected")}
                            </span>
                            <span className={styles.callRoom}>{call.roomName}</span>
                        </button>
                        <IconButton
                            size="32px"
                            destructive
                            tooltip={_t("intercom|user_panel|leave")}
                            aria-label={_t("intercom|user_panel|leave")}
                            onClick={vm.onLeaveCall}
                        >
                            <EndCallIcon />
                        </IconButton>
                    </div>
                    {canControl && (
                        <div className={styles.callButtons}>
                            <button
                                type="button"
                                className={classNames(styles.callButton, { [styles.on]: call.cameraOn })}
                                aria-pressed={call.cameraOn}
                                onClick={vm.onToggleCamera}
                            >
                                {call.cameraOn ? <VideoCallSolidIcon /> : <VideoCallOffSolidIcon />}
                                {_t("intercom|user_panel|camera")}
                            </button>
                            <button
                                type="button"
                                className={classNames(styles.callButton, { [styles.on]: call.screenSharing })}
                                aria-pressed={call.screenSharing}
                                onClick={vm.onToggleScreenShare}
                            >
                                <ShareScreenSolidIcon />
                                {call.screenSharing
                                    ? _t("intercom|user_panel|stop_sharing")
                                    : _t("intercom|user_panel|share_screen")}
                            </button>
                        </div>
                    )}
                </div>
            )}
            <div className={styles.user}>
                <button
                    type="button"
                    className={styles.identity}
                    onClick={vm.onOpenProfile}
                    aria-label={_t("intercom|user_panel|profile", { name: displayName })}
                >
                    <span className={styles.avatar}>
                        <Avatar id={userId} name={displayName} src={avatarUrl} size="32px" />
                        {presence && <span className={styles.presence} data-presence={presence} />}
                    </span>
                    <span className={styles.names}>
                        <span className={styles.displayName}>{displayName}</span>
                        <span className={styles.presenceLabel}>{presenceLabel}</span>
                    </span>
                </button>
                <IconButton
                    size="32px"
                    className={classNames({ [styles.off]: muted && canControl })}
                    disabled={!canControl}
                    aria-pressed={canControl ? muted : undefined}
                    tooltip={callTooltip(muteLabel)}
                    onClick={vm.onToggleMute}
                >
                    {muted && canControl ? <MicOffSolidIcon /> : <MicOnSolidIcon />}
                </IconButton>
                <IconButton
                    size="32px"
                    className={classNames({ [styles.off]: deafened && canControl })}
                    disabled={!canControl}
                    aria-pressed={canControl ? deafened : undefined}
                    tooltip={callTooltip(deafenLabel)}
                    onClick={vm.onToggleDeafen}
                >
                    {deafened && canControl ? <HeadphonesOffSolidIcon /> : <HeadphonesSolidIcon />}
                </IconButton>
                <IconButton
                    size="32px"
                    tooltip={_t("intercom|user_panel|settings")}
                    aria-label={_t("intercom|user_panel|settings")}
                    onClick={vm.onOpenSettings}
                >
                    <SettingsSolidIcon />
                </IconButton>
            </div>
        </section>
    );
}
