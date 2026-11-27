/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import classNames from "classnames";
import { Tooltip } from "@vector-im/compound-web";
import { ArrowDownIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { useI18n } from "../../core/i18n/i18nContext";
import type { JumpToPresentMode } from "./jumpToPresent";
import styles from "./JumpToPresentBar.module.css";

/** Props of {@link JumpToPresentBar}. */
export interface JumpToPresentBarProps {
    /** What to show, see {@link jumpToPresentMode} */
    mode: JumpToPresentMode;
    /** How many messages from others arrived since the reader left the newest one */
    newMessages: number;
    /** Whether one of those messages mentions the reader */
    highlight?: boolean;
    /** Called when the reader asks for the newest messages: the timeline scrolls, or loads, to them */
    onJump: () => void;
}

/**
 * The way back to the newest messages, at the bottom of the timeline, just above the composer.
 *
 * Far back (or when the newest messages are not loaded) it is a slim bar across the timeline,
 * "You're viewing older messages" or "N new messages", with a "Jump to present" button. A little
 * way up it is a small arrow at the edge, with the count of new messages beside it. At the newest
 * message there is nothing.
 *
 * Stays mounted whatever the mode, so that its live region exists before it has something to say:
 * screen readers announce the bar when it appears and when its count changes.
 */
export function JumpToPresentBar({
    mode,
    newMessages,
    highlight = false,
    onJump,
}: Readonly<JumpToPresentBarProps>): JSX.Element {
    const { translate: _t } = useI18n();

    const hasNew = newMessages > 0;
    const status = hasNew
        ? _t("intercom|timeline|new_messages", { count: newMessages })
        : _t("intercom|timeline|viewing_older");
    // The small arrow says nothing while nothing new has arrived
    const announcement = mode === "far" || (mode === "near" && hasNew) ? status : "";

    return (
        <div
            className={classNames(styles.dock, "mx_IntercomJumpToPresent")}
            data-mode={mode}
            data-testid="jump-to-present"
        >
            <span className={styles.visuallyHidden} aria-live="polite" aria-atomic="true">
                {announcement}
            </span>
            {mode === "far" && (
                <div className={styles.bar} data-new={hasNew || undefined} data-highlight={highlight || undefined}>
                    {/* Read out by the live region above */}
                    <span className={styles.status} aria-hidden="true" data-testid="jump-to-present-status">
                        {hasNew && <span className={styles.dot} />}
                        {status}
                    </span>
                    <button type="button" className={styles.jump} onClick={onJump}>
                        {_t("intercom|timeline|jump_to_present")}
                        <ArrowDownIcon width="16px" height="16px" aria-hidden="true" />
                    </button>
                </div>
            )}
            {mode === "near" && (
                <Tooltip
                    label={
                        hasNew
                            ? _t("intercom|timeline|jump_to_present_new", { count: newMessages })
                            : _t("intercom|timeline|jump_to_present")
                    }
                    placement="left"
                >
                    <button
                        type="button"
                        className={styles.pill}
                        data-new={hasNew || undefined}
                        data-highlight={highlight || undefined}
                        onClick={onJump}
                    >
                        {hasNew && <span className={styles.count}>{newMessages}</span>}
                        <ArrowDownIcon width="16px" height="16px" aria-hidden="true" />
                    </button>
                </Tooltip>
            )}
        </div>
    );
}
