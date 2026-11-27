/*
Copyright 2024 New Vector Ltd.
Copyright 2016-2021 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { UnreadSinceBar } from "@element-hq/web-shared-components";

import { type ButtonEvent } from "../elements/AccessibleButton";

interface IProps {
    onScrollUpClick: () => void;
    onCloseClick: (e: ButtonEvent) => void;
    /** InterCom: whether the bar is shown; it stays mounted for its live region */
    visible?: boolean;
    /** InterCom: how many messages after the read marker are unread; null when not known */
    count?: number | null;
    /** InterCom: when the first of them was sent, formatted; null when not known */
    since?: string | null;
}

/**
 * InterCom: the unread messages above, as the new timeline shows them (the shared
 * {@link UnreadSinceBar}): "12 new messages since 14:32" and "Mark as read" along the top of the
 * timeline, in place of Element's round button and its small ✕.
 */
export default class TopUnreadMessagesBar extends React.PureComponent<IProps> {
    public render(): React.ReactNode {
        return (
            <UnreadSinceBar
                visible={this.props.visible ?? true}
                count={this.props.count ?? null}
                since={this.props.since ?? null}
                onJump={this.props.onScrollUpClick}
                onMarkAsRead={this.props.onCloseClick}
            />
        );
    }
}
