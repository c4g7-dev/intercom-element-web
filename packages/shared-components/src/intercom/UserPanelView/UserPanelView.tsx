/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconButton, Tooltip } from "@vector-im/compound-web";
import MicOnSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/mic-on-solid";
import MicOffSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/mic-off-solid";
import HeadphonesSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/headphones-solid";
import HeadphonesOffSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/headphones-off-solid";
import SettingsSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/settings-solid";
import VideoCallSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call-solid";
import VideoCallOffSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/video-call-off-solid";
import ShareScreenSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/share-screen-solid";
import EndCallIcon from "@vector-im/compound-design-tokens/assets/web/icons/end-call";
import ChevronUpIcon from "@vector-im/compound-design-tokens/assets/web/icons/chevron-up";
import classNames from "classnames";

import styles from "./UserPanelView.module.css";
import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { useI18n } from "../../core/i18n/i18nContext";
import { type RenderIntercomAvatar, renderIntercomAvatar } from "../IntercomAvatar/IntercomAvatar";
import { MicUnavailableIcon, VideoUnavailableIcon } from "./DeviceUnavailableIcon";
import { SignalBars, signalLevel, type UserPanelConnectionQuality } from "./SignalBars";
import { ConnectionPopover, type UserPanelConnection } from "./ConnectionPopover";

/** Whether the user is around, as the homeserver has it. */
export type UserPanelPresence = "online" | "unavailable" | "offline" | "busy";

/** Why a microphone or a camera cannot be turned on: there is none, or its use is not allowed. */
export type UserPanelDeviceUnavailability = "no-device" | "no-permission";

/** The call the user is in. */
export interface UserPanelCall {
    /** The name of the call's room */
    roomName: string;
    /** Whether the connection is being re-established */
    reconnecting: boolean;
    /** Whether the camera is on */
    cameraOn: boolean;
    /** Why there is no camera to turn on, if there is none: the button then says so and does nothing */
    cameraUnavailable?: UserPanelDeviceUnavailability;
    /** Whether the user is sharing a screen */
    screenSharing: boolean;
    /** Whether a screen can be shared in the call at all */
    canShareScreen: boolean;
    /**
     * Whether the call's controls can be driven from here. False for a call that does not tell
     * its state (not the InterCom build of Element Call): only leaving is offered then.
     */
    controllable: boolean;
    /**
     * How good the connection is, where the call tells: the signal bars show it. Without it they
     * show connected or reconnecting, which is all that is known then.
     */
    quality?: UserPanelConnectionQuality;
    /** The details of the connection, while they are asked for (see `onConnectionDetails`) and the call tells them */
    connection?: UserPanelConnection;
    /**
     * When the call leaves by itself because everybody else left it, in ms since the epoch: a
     * line counts down to it and offers to stay. Undefined while nothing counts down.
     */
    aloneDeadline?: number;
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
    /** Whether the microphone is off: in the call, and in the next one, as it holds without a call too */
    muted: boolean;
    /**
     * Why there is no microphone to turn on, if there is none. The button shows that instead of
     * muted or unmuted, and does nothing; `muted` stays what the user chose.
     */
    micUnavailable?: UserPanelDeviceUnavailability;
    /** Whether the user is deafened (hears no call and is muted); holds without a call too */
    deafened: boolean;
    /** The call the user is in, if any */
    call?: UserPanelCall;
}

export interface UserPanelViewActions {
    /** Mutes or unmutes the microphone, with or without a call */
    onToggleMute: () => void;
    /** Deafens or undeafens the user, with or without a call */
    onToggleDeafen: () => void;
    /** Opens the settings */
    onOpenSettings: () => void;
    /** Opens the user's own menu or profile */
    onOpenProfile: () => void;
    /** Turns the camera on or off in the call */
    onToggleCamera: () => void;
    /**
     * Starts sharing a screen in the call at once, with the settings of the last share (the first
     * time, the call asks for them), or stops the share that is on
     */
    onToggleScreenShare: () => void;
    /** Opens the settings of the screen share: what to optimise for, resolution, audio sources */
    onOpenShareSettings: () => void;
    /** Leaves the call */
    onLeaveCall: () => void;
    /** Stays in a call the user was left alone in: its countdown starts over */
    onStayInCall: () => void;
    /** Shows the call's room */
    onJumpToCall: () => void;
    /** The details of the connection are being looked at from now on, or no longer: only then they are in the snapshot */
    onConnectionDetails: (open: boolean) => void;
    /** Shows or hides the call's diagnostics overlay */
    onOpenDiagnostics: () => void;
}

/** The view model of the user panel. */
export type UserPanelViewModel = ViewModel<UserPanelViewSnapshot, UserPanelViewActions>;

interface UserPanelViewProps {
    /** The view model */
    vm: UserPanelViewModel;
    /** Whether an update of the app is downloaded and waits for a restart: only then a settings button, with a dot, is shown */
    updateReady?: boolean;
    /** Draws the user's avatar: the app's own, which loads the picture as its other avatars do */
    renderAvatar?: RenderIntercomAvatar;
    /** The time, in ms since the epoch: what a countdown is told from. For tests and stories */
    now?: () => number;
}

/** The time left as minutes and seconds: "4:59", "0:07". */
export function formatCountdown(msLeft: number): string {
    const seconds = Math.max(0, Math.ceil(msLeft / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** What is left until a deadline, looked at again several times a second while there is one. */
function useTimeLeft(deadline: number | undefined, now: () => number): number | undefined {
    const [left, setLeft] = useState(() => (deadline === undefined ? undefined : deadline - now()));
    useEffect(() => {
        if (deadline === undefined) {
            setLeft(undefined);
            return;
        }
        const tick = (): void => setLeft(deadline - now());
        tick();
        const interval = setInterval(tick, 250);
        return (): void => clearInterval(interval);
    }, [deadline, now]);
    return left;
}

/** The least the card of the connection is wide: its rows do not fit in less */
const CONNECTION_MIN_WIDTH = 288;

/**
 * The panel at the bottom of the room list: who you are, with the microphone, deafen and settings
 * buttons beside it, and, while you are in a call, a strip above it that says so, leads to the
 * call and holds its camera, screen share and leave buttons.
 */
export function UserPanelView({
    vm,
    updateReady = false,
    renderAvatar,
    now = Date.now,
}: Readonly<UserPanelViewProps>): JSX.Element {
    const { translate: _t } = useI18n();
    const { userId, displayName, avatarUrl, presence, muted, micUnavailable, deafened, call } = useViewModel(vm);
    const micReasonId = useId();
    const cameraReasonId = useId();
    const shareReasonId = useId();
    const connectionId = useId();
    const panel = useRef<HTMLElement>(null);
    const connectionTrigger = useRef<HTMLButtonElement>(null);
    const connectionCard = useRef<HTMLDivElement>(null);
    const [connectionWanted, setConnectionWanted] = useState(false);
    const [connectionPlace, setConnectionPlace] = useState<{ left: number; bottom: number; width: number } | null>(
        null,
    );
    const inCall = call !== undefined;
    const aloneLeft = useTimeLeft(call?.aloneDeadline, now);
    const connectionOpen = connectionWanted && inCall;

    // The details are the call's: they close with it
    useEffect(() => {
        if (!inCall) setConnectionWanted(false);
    }, [inCall]);

    // The call tells the details only while they are looked at
    useEffect(() => {
        if (!connectionOpen) return;
        vm.onConnectionDetails(true);
        return (): void => vm.onConnectionDetails(false);
    }, [connectionOpen, vm]);

    // Over the panel, its left edge on the panel's, and within the window
    useLayoutEffect(() => {
        if (!connectionOpen) return;
        const measure = (): void => {
            const rect = panel.current?.getBoundingClientRect();
            if (!rect) return;
            const width = Math.max(rect.width, CONNECTION_MIN_WIDTH);
            setConnectionPlace({
                left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
                bottom: Math.max(8, window.innerHeight - rect.top + 8),
                width,
            });
        };
        measure();
        window.addEventListener("resize", measure);
        return (): void => window.removeEventListener("resize", measure);
    }, [connectionOpen]);

    const connectionPlaced = connectionOpen && connectionPlace !== null;
    useEffect(() => {
        if (!connectionPlaced) return;
        connectionCard.current?.focus();
        const close = (): void => setConnectionWanted(false);
        const onKey = (e: KeyboardEvent): void => {
            if (e.key !== "Escape") return;
            e.stopPropagation();
            close();
            connectionTrigger.current?.focus();
        };
        const inside = (target: EventTarget | null): boolean =>
            target instanceof Node &&
            (connectionCard.current?.contains(target) === true || connectionTrigger.current?.contains(target) === true);
        const onPointerDown = (e: PointerEvent): void => {
            if (!inside(e.target)) close();
        };
        // The keyboard walked out of the card
        const onFocusIn = (e: FocusEvent): void => {
            if (!inside(e.target)) close();
        };
        // A click into the call, which is another document, is seen here only as the focus leaving
        // the window. The card itself must not have it then, or it would count as still open
        const onBlur = (): void => {
            if (document.activeElement instanceof HTMLIFrameElement) close();
        };
        document.addEventListener("keydown", onKey, true);
        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("focusin", onFocusIn);
        window.addEventListener("blur", onBlur);
        return (): void => {
            document.removeEventListener("keydown", onKey, true);
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("focusin", onFocusIn);
            window.removeEventListener("blur", onBlur);
        };
    }, [connectionPlaced]);

    const presenceLabels: Record<UserPanelPresence, string> = {
        online: _t("intercom|user_panel|presence|online"),
        unavailable: _t("intercom|user_panel|presence|unavailable"),
        offline: _t("intercom|user_panel|presence|offline"),
        busy: _t("intercom|user_panel|presence|busy"),
    };
    const presenceLabel = presence ? presenceLabels[presence] : userId;
    const canControl = call?.controllable === true;
    // Mute and deafen hold with or without a call, so their buttons always work and always show it.
    // Deafened means muted too: the microphone button then says why it is off.
    const muteLabel = deafened
        ? _t("intercom|user_panel|unmute_deafened")
        : muted
          ? _t("intercom|user_panel|unmute")
          : _t("intercom|user_panel|mute");
    const deafenLabel = deafened ? _t("intercom|user_panel|undeafen") : _t("intercom|user_panel|deafen");
    // A device that is not there is not muted: its button says why it does nothing
    const micReason =
        micUnavailable === "no-device"
            ? _t("intercom|user_panel|no_microphone")
            : _t("intercom|user_panel|microphone_blocked");
    const cameraReason =
        call?.cameraUnavailable === "no-device"
            ? _t("intercom|user_panel|no_camera")
            : _t("intercom|user_panel|camera_blocked");
    const canShare = call?.canShareScreen !== false;

    const shareLabel = call?.screenSharing
        ? _t("intercom|user_panel|stop_sharing")
        : _t("intercom|user_panel|share_screen");

    return (
        <section
            ref={panel}
            className={classNames(styles.panel, "mx_IntercomUserPanel")}
            aria-label={_t("intercom|user_panel|label")}
            data-testid="intercom-user-panel"
        >
            {call && (
                <div className={styles.call} data-testid="intercom-call-strip">
                    <div className={styles.callStatus}>
                        <div className={styles.callInfo}>
                            {/* The bars and the state open the details of the connection */}
                            <button
                                ref={connectionTrigger}
                                type="button"
                                className={styles.callConnection}
                                aria-expanded={connectionOpen}
                                aria-controls={connectionOpen ? connectionId : undefined}
                                aria-haspopup="dialog"
                                title={_t("intercom|user_panel|connection|show")}
                                onClick={() => setConnectionWanted(!connectionOpen)}
                                data-testid="intercom-connection-trigger"
                            >
                                <span
                                    className={styles.callSignal}
                                    data-level={signalLevel(call.reconnecting, call.quality)}
                                >
                                    <SignalBars
                                        className={styles.signal}
                                        level={signalLevel(call.reconnecting, call.quality)}
                                    />
                                </span>
                                <span
                                    className={classNames(styles.callState, {
                                        [styles.reconnecting]: call.reconnecting,
                                    })}
                                    role="status"
                                >
                                    {call.reconnecting
                                        ? _t("intercom|user_panel|reconnecting")
                                        : _t("intercom|user_panel|voice_connected")}
                                </span>
                            </button>
                            {/* The room's name is the way back to the call */}
                            <button
                                type="button"
                                className={styles.callRoom}
                                onClick={vm.onJumpToCall}
                                title={_t("intercom|user_panel|jump_to_call")}
                                data-testid="intercom-jump-to-call"
                            >
                                {call.roomName}
                            </button>
                        </div>
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
                    {aloneLeft !== undefined && (
                        // Left alone in a private call: when it ends, and the ways to stay or go now.
                        // The seconds are not read out one by one; the whole is in the title
                        <div
                            className={styles.callAlone}
                            role="group"
                            aria-label={_t("intercom|user_panel|alone|label", { time: formatCountdown(aloneLeft) })}
                            title={_t("intercom|user_panel|alone|label", { time: formatCountdown(aloneLeft) })}
                            data-testid="intercom-call-alone"
                        >
                            <span className={styles.aloneText}>
                                <span className={styles.aloneWords}>{_t("intercom|user_panel|alone|alone")}</span>
                                <span aria-hidden>·</span>
                                <span className={styles.aloneMore}>{_t("intercom|user_panel|alone|leaving_in")}</span>
                                <span className={styles.aloneTime} data-testid="intercom-call-alone-time">
                                    {formatCountdown(aloneLeft)}
                                </span>
                            </span>
                            <button type="button" className={styles.aloneButton} onClick={vm.onStayInCall}>
                                {_t("intercom|user_panel|alone|stay")}
                            </button>
                            <button
                                type="button"
                                className={classNames(styles.aloneButton, styles.aloneLeave)}
                                onClick={vm.onLeaveCall}
                            >
                                {_t("intercom|user_panel|alone|leave")}
                            </button>
                        </div>
                    )}
                    {canControl && (
                        <div className={styles.callButtons}>
                            {call.cameraUnavailable ? (
                                <Tooltip description={cameraReason}>
                                    <button
                                        type="button"
                                        className={styles.callButton}
                                        aria-disabled="true"
                                        aria-label={_t("intercom|user_panel|camera")}
                                        aria-describedby={cameraReasonId}
                                        data-state={call.cameraUnavailable}
                                    >
                                        <VideoUnavailableIcon />
                                        <span className={styles.callLabel}>{_t("intercom|user_panel|camera")}</span>
                                        <span id={cameraReasonId} hidden>
                                            {cameraReason}
                                        </span>
                                    </button>
                                </Tooltip>
                            ) : (
                                <button
                                    type="button"
                                    className={classNames(styles.callButton, { [styles.on]: call.cameraOn })}
                                    aria-pressed={call.cameraOn}
                                    // Named and titled whether or not the words fit beside the icon
                                    aria-label={_t("intercom|user_panel|camera")}
                                    title={_t("intercom|user_panel|camera")}
                                    onClick={vm.onToggleCamera}
                                >
                                    {call.cameraOn ? <VideoCallSolidIcon /> : <VideoCallOffSolidIcon />}
                                    <span className={styles.callLabel}>{_t("intercom|user_panel|camera")}</span>
                                </button>
                            )}
                            {/* Two parts, as in the call: the button shares at once with what was used
                                last, the chevron opens the settings */}
                            <span className={classNames(styles.callSplit, { [styles.on]: call.screenSharing })}>
                                <button
                                    type="button"
                                    className={classNames(styles.callButton, { [styles.on]: call.screenSharing })}
                                    aria-pressed={call.screenSharing}
                                    aria-disabled={canShare ? undefined : "true"}
                                    aria-describedby={canShare ? undefined : shareReasonId}
                                    aria-label={shareLabel}
                                    title={canShare ? shareLabel : _t("intercom|user_panel|cannot_share")}
                                    onClick={canShare ? vm.onToggleScreenShare : undefined}
                                >
                                    <ShareScreenSolidIcon />
                                    <span className={styles.callLabel}>{shareLabel}</span>
                                </button>
                                <button
                                    type="button"
                                    className={classNames(styles.callButton, styles.callChevron, {
                                        [styles.on]: call.screenSharing,
                                    })}
                                    title={
                                        call.screenSharing
                                            ? _t("intercom|user_panel|share_audio")
                                            : _t("intercom|user_panel|share_settings")
                                    }
                                    aria-label={
                                        call.screenSharing
                                            ? _t("intercom|user_panel|share_audio")
                                            : _t("intercom|user_panel|share_settings")
                                    }
                                    aria-disabled={canShare ? undefined : "true"}
                                    onClick={canShare ? vm.onOpenShareSettings : undefined}
                                    data-testid="intercom-share-settings"
                                >
                                    <ChevronUpIcon />
                                </button>
                                {!canShare && (
                                    <span id={shareReasonId} hidden>
                                        {_t("intercom|user_panel|cannot_share")}
                                    </span>
                                )}
                            </span>
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
                        {renderIntercomAvatar(
                            { id: userId, name: displayName, url: avatarUrl, size: "32px" },
                            renderAvatar,
                        )}
                        {presence && <span className={styles.presence} data-presence={presence} />}
                    </span>
                    <span className={styles.names}>
                        <span className={styles.displayName}>{displayName}</span>
                        <span className={styles.presenceLabel}>{presenceLabel}</span>
                    </span>
                </button>
                {micUnavailable ? (
                    <>
                        <Tooltip description={micReason}>
                            <IconButton
                                size="32px"
                                className={classNames(styles.voice, styles.unavailable)}
                                aria-label={_t("intercom|user_panel|microphone")}
                                aria-describedby={micReasonId}
                                data-state={micUnavailable}
                                disabled
                            >
                                <MicUnavailableIcon />
                            </IconButton>
                        </Tooltip>
                        <span id={micReasonId} hidden>
                            {micReason}
                        </span>
                    </>
                ) : (
                    <IconButton
                        size="32px"
                        className={classNames(styles.voice, { [styles.off]: muted })}
                        aria-pressed={muted}
                        data-state={muted ? "muted" : "unmuted"}
                        tooltip={muteLabel}
                        onClick={vm.onToggleMute}
                    >
                        {muted ? <MicOffSolidIcon /> : <MicOnSolidIcon />}
                    </IconButton>
                )}
                <IconButton
                    size="32px"
                    className={classNames(styles.voice, { [styles.off]: deafened })}
                    aria-pressed={deafened}
                    data-state={deafened ? "deafened" : "hearing"}
                    tooltip={deafenLabel}
                    onClick={vm.onToggleDeafen}
                >
                    {deafened ? <HeadphonesOffSolidIcon /> : <HeadphonesSolidIcon />}
                </IconButton>
                {/* The settings are in the rail of spaces; the button here only stands for an update
                    that waits for a restart, with its dot */}
                {updateReady && (
                    <span className={styles.settings}>
                        <IconButton
                            size="32px"
                            tooltip={_t("intercom|user_panel|settings_update_ready")}
                            aria-label={_t("intercom|user_panel|settings_update_ready")}
                            onClick={vm.onOpenSettings}
                        >
                            <SettingsSolidIcon />
                        </IconButton>
                        <span className={styles.updateDot} data-testid="intercom-update-dot" />
                    </span>
                )}
            </div>
            {call &&
                connectionOpen &&
                connectionPlace &&
                createPortal(
                    <ConnectionPopover
                        ref={connectionCard}
                        id={connectionId}
                        place={connectionPlace}
                        level={signalLevel(call.reconnecting, call.quality)}
                        judged={call.quality !== undefined}
                        connection={call.connection}
                        onOpenDiagnostics={() => {
                            setConnectionWanted(false);
                            vm.onOpenDiagnostics();
                        }}
                    />,
                    document.body,
                )}
        </section>
    );
}
