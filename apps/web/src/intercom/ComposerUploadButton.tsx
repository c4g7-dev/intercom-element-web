/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { UploadButton } from "@element-hq/web-shared-components";
import PlusIcon from "@vector-im/compound-design-tokens/assets/web/icons/plus";

import { useRoomUploadViewModel } from "../viewmodels/room/RoomUploadViewModel";

/** The composer's upload button where InterCom has it: a "+" before the text, not among the buttons after it. */
export function ComposerUploadButton(): JSX.Element {
    const vm = useRoomUploadViewModel();
    return (
        <UploadButton vm={vm} className="mx_IntercomComposerUpload">
            <PlusIcon />
        </UploadButton>
    );
}
