/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import MicOffSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/mic-off-solid";
import HeadphonesOffSolidIcon from "@vector-im/compound-design-tokens/assets/web/icons/headphones-off-solid";
import classNames from "classnames";

import styles from "./VoiceParticipantsView.module.css";
import { LatticeMark } from "../LatticeMark";
import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { useI18n } from "../../core/i18n/i18nContext";
import { type RenderIntercomAvatar, renderIntercomAvatar } from "../IntercomAvatar/IntercomAvatar";

/** Somebody who is in the call of a voice room. */
export interface VoiceParticipant {
    /** The user's ID */
    id: string;
    /** The name to show */
    name: string;
    /** HTTP URL of the avatar, if they have one */
    avatarUrl?: string;
    /** Whether they are talking right now */
    speaking: boolean;
    /** Whether their microphone is off */
    muted: boolean;
    /** Whether they hear nobody (known for the user themselves only) */
    deafened: boolean;
    /** Whether they are sharing a screen */
    live: boolean;
    /**
     * Set for a moment when the participant comes or goes: "joining" right after they joined the
     * call, "leaving" while they are still listed after having left it.
     */
    transition?: "joining" | "leaving";
}

export interface VoiceParticipantsViewSnapshot {
    /** The name of the room, for the list's label */
    roomName: string;
    /** Who is in the call, in the order to show them */
    participants: VoiceParticipant[];
}

export interface VoiceParticipantsViewActions {
    /** Called when the list is clicked: joins the call, or shows it when already in it */
    onJoin: () => void;
}

/** The view model of the list of people in a voice room's call. */
export type VoiceParticipantsViewModel = ViewModel<VoiceParticipantsViewSnapshot, VoiceParticipantsViewActions>;

interface VoiceParticipantsViewProps {
    /** The view model */
    vm: VoiceParticipantsViewModel;
    /** Draws a participant's avatar: the app's own, which loads the picture as its other avatars do */
    renderAvatar?: RenderIntercomAvatar;
}

/**
 * The people in the call of a voice room, shown under the room in the room list: avatar with a
 * ring and the mark's three moving bars while they talk, name, and what is off (microphone, hearing) or on (a shared screen).
 * Renders nothing while nobody is in the call.
 */
export function VoiceParticipantsView({ vm, renderAvatar }: Readonly<VoiceParticipantsViewProps>): JSX.Element | null {
    const { translate: _t } = useI18n();
    const { roomName, participants } = useViewModel(vm);
    if (participants.length === 0) return null;

    return (
        <ul
            className={classNames(styles.list, "mx_IntercomVoiceParticipants")}
            aria-label={_t("intercom|voice|in_call_label", { roomName })}
            data-testid="voice-participants"
        >
            {participants.map((participant) => (
                <li
                    key={participant.id}
                    className={classNames({
                        [styles.joining]: participant.transition === "joining",
                        [styles.leaving]: participant.transition === "leaving",
                    })}
                    data-transition={participant.transition}
                >
                    <button
                        type="button"
                        className={styles.participant}
                        onClick={vm.onJoin}
                        tabIndex={-1}
                        title={
                            participant.transition === "joining"
                                ? _t("intercom|voice|joined", { name: participant.name })
                                : participant.transition === "leaving"
                                  ? _t("intercom|voice|left", { name: participant.name })
                                  : undefined
                        }
                    >
                        <span
                            className={classNames(styles.avatar, { [styles.speaking]: participant.speaking })}
                            data-speaking={participant.speaking}
                        >
                            {renderIntercomAvatar(
                                {
                                    id: participant.id,
                                    name: participant.name,
                                    url: participant.avatarUrl,
                                    size: "24px",
                                },
                                renderAvatar,
                            )}
                        </span>
                        <span className={styles.name} title={participant.name}>
                            {participant.name}
                        </span>
                        {participant.speaking && !participant.muted && !participant.deafened && (
                            <LatticeMark variant="speaking" size="14px" className={styles.speakingMark} />
                        )}
                        {participant.live && (
                            <span className={styles.live} title={_t("intercom|voice|sharing_screen")}>
                                {_t("intercom|voice|live")}
                            </span>
                        )}
                        {participant.muted && !participant.deafened && (
                            <MicOffSolidIcon
                                className={styles.icon}
                                width="16px"
                                height="16px"
                                aria-label={_t("intercom|voice|muted")}
                            />
                        )}
                        {participant.deafened && (
                            <HeadphonesOffSolidIcon
                                className={styles.icon}
                                width="16px"
                                height="16px"
                                aria-label={_t("intercom|voice|deafened")}
                            />
                        )}
                    </button>
                </li>
            ))}
        </ul>
    );
}
