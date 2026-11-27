/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, type MouseEvent } from "react";
import classNames from "classnames";
import { Tooltip } from "@vector-im/compound-web";
import { ArrowDownIcon, ArrowUpIcon, CheckIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { useI18n } from "../../core/i18n/i18nContext";
import styles from "./UnreadSinceBar.module.css";

/** Props of {@link UnreadSinceBar}. */
export interface UnreadSinceBarProps {
    /** Whether there are unread messages out of view to point to */
    visible: boolean;
    /** How many messages after the read marker are unread; null when that is not known */
    count: number | null;
    /** When the first of them was sent, formatted for the reader; null when that is not known */
    since: string | null;
    /** Where the first unread message is: above the viewport (the default) or below it */
    direction?: "above" | "below";
    /** Called on the bar: the timeline scrolls, or loads, to the first unread message */
    onJump: () => void;
    /** Called on "Mark as read" */
    onMarkAsRead: (ev: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * The unread messages the reader has not reached, as a slim bar along the top of the timeline:
 * "12 new messages since 14:32", which leads to the first of them, and "Mark as read".
 *
 * Stays mounted while hidden, so that its live region exists before it has something to say.
 */
export function UnreadSinceBar({
    visible,
    count,
    since,
    direction = "above",
    onJump,
    onMarkAsRead,
}: Readonly<UnreadSinceBarProps>): JSX.Element {
    const { translate: _t } = useI18n();

    let text: string;
    if (count !== null && since !== null) text = _t("intercom|timeline|new_messages_since", { count, time: since });
    else if (count !== null) text = _t("intercom|timeline|new_messages", { count });
    else if (since !== null) text = _t("intercom|timeline|new_since", { time: since });
    else text = _t("intercom|timeline|new_messages_unknown");

    return (
        <div className={classNames(styles.dock, "mx_IntercomUnreadSince")} data-testid="unread-since">
            <span className={styles.visuallyHidden} aria-live="polite" aria-atomic="true">
                {visible ? text : ""}
            </span>
            {visible && (
                <div className={styles.bar}>
                    <Tooltip description={_t("room|jump_read_marker")} placement="bottom">
                        <button type="button" className={styles.jump} onClick={onJump}>
                            {direction === "below" ? (
                                <ArrowDownIcon width="16px" height="16px" aria-hidden="true" />
                            ) : (
                                <ArrowUpIcon width="16px" height="16px" aria-hidden="true" />
                            )}
                            <span className={styles.text}>{text}</span>
                        </button>
                    </Tooltip>
                    <button type="button" className={styles.markRead} onClick={onMarkAsRead}>
                        {_t("intercom|timeline|mark_as_read")}
                        <CheckIcon width="16px" height="16px" aria-hidden="true" />
                    </button>
                </div>
            )}
        </div>
    );
}
