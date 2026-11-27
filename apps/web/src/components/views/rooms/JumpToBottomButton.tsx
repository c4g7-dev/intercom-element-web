/*
Copyright 2019-2024 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { JumpToPresentBar, type JumpToPresentMode } from "@element-hq/web-shared-components";

interface IProps {
    numUnreadMessages?: number;
    highlight: boolean;
    onScrollToBottomClick: () => void;
    /**
     * InterCom: the bar "You're viewing older messages" when far back, the small arrow when a
     * little way up (see `jumpToPresentMode`). Without it, the arrow.
     */
    mode?: JumpToPresentMode;
}

/**
 * InterCom: the way back to the newest messages of the classic timeline, the same as the new
 * timeline's (the shared {@link JumpToPresentBar}) in place of Element's round button.
 */
const JumpToBottomButton: React.FC<IProps> = (props) => {
    return (
        <JumpToPresentBar
            mode={props.mode ?? "near"}
            newMessages={props.numUnreadMessages ?? 0}
            highlight={props.highlight}
            onJump={props.onScrollToBottomClick}
        />
    );
};

export default JumpToBottomButton;
