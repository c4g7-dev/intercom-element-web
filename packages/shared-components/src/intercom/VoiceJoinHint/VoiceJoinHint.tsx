/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import classNames from "classnames";

import styles from "./VoiceJoinHint.module.css";
import { useI18n } from "../../core/i18n/i18nContext";

/** Where the user stands with a voice channel: a click would join it, or they are in it. */
export type VoiceChannelState = "join" | "connected";

interface VoiceJoinHintProps {
    /** Whether a click on the channel joins it or the user is in it already */
    state: VoiceChannelState;
}

/**
 * Says on a voice channel's row in the room list what a click does: "Join voice", or
 * "Connected" for the channel the user is in. Shown while the row is pointed at or focused;
 * the row's own label says the same to a screen reader, so this is hidden from it.
 */
export function VoiceJoinHint({ state }: Readonly<VoiceJoinHintProps>): JSX.Element {
    const { translate: _t } = useI18n();
    return (
        <span
            className={classNames(styles.hint, "mx_IntercomVoiceHint", { [styles.connected]: state === "connected" })}
            data-state={state}
            aria-hidden="true"
        >
            {state === "connected" ? _t("intercom|voice|connected") : _t("intercom|voice|join")}
        </span>
    );
}
