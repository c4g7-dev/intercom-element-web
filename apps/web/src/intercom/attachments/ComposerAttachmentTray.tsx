/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useSyncExternalStore } from "react";
import { AttachmentTrayView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";
import { type IEventRelation } from "matrix-js-sdk/src/matrix";

import { AttachmentTrayViewModel } from "../../viewmodels/composer/AttachmentTrayViewModel";
import { AttachmentTrayStore, attachmentTrayKey } from "./AttachmentTrayStore";

interface Props {
    /** The room of the composer */
    roomId: string;
    /** The relation of the composer: a thread has a tray of its own */
    relation?: IEventRelation;
}

function Tray({ trayKey }: Readonly<{ trayKey: string }>): JSX.Element {
    const vm = useCreateAutoDisposedViewModel(() => new AttachmentTrayViewModel({ trayKey }));
    return <AttachmentTrayView vm={vm} className="mx_IntercomAttachmentTray" />;
}

/**
 * The attachment tray of a composer: the files pasted, picked or dropped there, above its text,
 * until they are sent with the next message.
 */
export function ComposerAttachmentTray({ roomId, relation }: Readonly<Props>): JSX.Element {
    const trayKey = attachmentTrayKey(roomId, relation);
    // A composer that goes on to another room or thread shows another tray
    return <Tray key={trayKey} trayKey={trayKey} />;
}

/**
 * Whether the tray of a composer has files that its next message takes with it: then there is
 * something to send although nothing is typed.
 */
export function useHasPendingAttachments(roomId: string, relation?: IEventRelation): boolean {
    const trayKey = attachmentTrayKey(roomId, relation);
    const subscribe = useCallback(
        (onChange: () => void) => AttachmentTrayStore.instance.subscribe(trayKey, onChange),
        [trayKey],
    );
    return useSyncExternalStore(subscribe, () => AttachmentTrayStore.instance.hasSendable(trayKey));
}
