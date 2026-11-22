/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useEffect, useMemo, useState } from "react";

import { _t } from "../../languageHandler";
import BaseDialog from "../../components/views/dialogs/BaseDialog";
import DialogButtons from "../../components/views/elements/DialogButtons";
import { fileSize } from "../../utils/FileUtils";
import { galleryLayout } from "./grouping";

interface Props {
    /** The pictures chosen, in the order they will be sent. */
    files: File[];
    /**
     * @param confirmed - whether to send them
     * @param caption - text to send with the first of them, if any was typed
     */
    onFinished: (confirmed?: boolean, caption?: string) => void;
}

/**
 * Asks once for several pictures chosen together, instead of once per picture: shows them as
 * the gallery they will be in the room and takes an optional caption for it.
 */
export default function BatchUploadDialog({ files, onFinished }: Props): JSX.Element {
    const [caption, setCaption] = useState("");
    const urls = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
    useEffect(() => {
        return (): void => urls.forEach((url) => URL.revokeObjectURL(url));
    }, [urls]);

    const onCancel = useCallback((): void => onFinished(false), [onFinished]);
    const onUpload = useCallback((): void => {
        onFinished(true, caption.trim() || undefined);
    }, [caption, onFinished]);
    const onSubmit = useCallback(
        (ev: React.FormEvent): void => {
            ev.preventDefault();
            onUpload();
        },
        [onUpload],
    );

    const { visible, spans } = galleryLayout(files.length);
    const hidden = files.length - visible;
    const total = files.reduce((sum, file) => sum + file.size, 0);

    return (
        <BaseDialog
            className="mx_IntercomBatchUploadDialog"
            fixedWidth={false}
            onFinished={onCancel}
            title={_t("upload_file|batch_title", { count: files.length })}
            contentId="mx_Dialog_content"
        >
            <form id="mx_Dialog_content" onSubmit={onSubmit}>
                <div className="mx_IntercomGallery mx_IntercomBatchUploadDialog_preview" data-count={visible}>
                    {files.slice(0, visible).map((file, i) => (
                        <div key={urls[i]} className="mx_IntercomGallery_cell" data-span={spans[i]}>
                            <img className="mx_IntercomBatchUploadDialog_image" src={urls[i]} alt={file.name} />
                            {i === visible - 1 && hidden > 0 && (
                                <div className="mx_IntercomGallery_more" aria-hidden="true">
                                    +{hidden}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
                <p className="mx_IntercomBatchUploadDialog_summary">
                    {_t("upload_file|batch_summary", { count: files.length, size: fileSize(total) })}
                </p>
                <input
                    className="mx_IntercomBatchUploadDialog_caption"
                    type="text"
                    value={caption}
                    onChange={(ev): void => setCaption(ev.target.value)}
                    placeholder={_t("upload_file|batch_caption_placeholder")}
                    aria-label={_t("upload_file|batch_caption_placeholder")}
                    maxLength={2000}
                    autoComplete="off"
                />
            </form>

            <DialogButtons
                primaryButton={_t("action|upload")}
                onPrimaryButtonClick={onUpload}
                onCancel={onCancel}
                focus={true}
            />
        </BaseDialog>
    );
}
