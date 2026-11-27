/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    type AttachmentTrayItem,
    type AttachmentTrayViewActions,
    type AttachmentTrayViewSnapshot,
    BaseViewModel,
} from "@element-hq/web-shared-components";

import { AttachmentTrayStore, type TrayAttachment } from "../../intercom/attachments/AttachmentTrayStore";
import { _t } from "../../languageHandler";
import { fileSize } from "../../utils/FileUtils";

interface Props {
    /** The key of the tray to show, see `attachmentTrayKey` */
    trayKey: string;
    /** The store the tray is in; the shared one unless a test brings its own */
    store?: AttachmentTrayStore;
}

function toItem(attachment: TrayAttachment): AttachmentTrayItem {
    return {
        id: attachment.id,
        name: attachment.file.name || _t("common|attachment"),
        size: fileSize(attachment.file.size),
        kind: attachment.kind,
        thumbnailUrl: attachment.previewUrl,
        status: attachment.status,
        progress: attachment.total > 0 ? Math.min(1, attachment.loaded / attachment.total) : 0,
    };
}

/**
 * Shows one tray of the {@link AttachmentTrayStore} in a composer: the files that wait there
 * for the next message, and how far their uploads are once it was sent.
 */
export class AttachmentTrayViewModel
    extends BaseViewModel<AttachmentTrayViewSnapshot, Props>
    implements AttachmentTrayViewActions
{
    private readonly store: AttachmentTrayStore;

    public constructor(props: Props) {
        const store = props.store ?? AttachmentTrayStore.instance;
        super(props, { items: store.getAttachments(props.trayKey).map(toItem) });
        this.store = store;
        this.disposables.track(store.subscribe(props.trayKey, this.onTrayChanged));
    }

    private onTrayChanged = (): void => {
        this.snapshot.set({ items: this.store.getAttachments(this.props.trayKey).map(toItem) });
    };

    public onRemove = (id: string): void => {
        this.store.remove(this.props.trayKey, id);
    };

    public onRetry = (id: string): void => {
        this.store.retry(this.props.trayKey, id);
    };
}
