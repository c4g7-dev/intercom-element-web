/*
 * Copyright 2026 The InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import classNames from "classnames";
import {
    CloseIcon,
    DocumentIcon,
    ErrorSolidIcon,
    PlaySolidIcon,
    RestartIcon,
} from "@vector-im/compound-design-tokens/assets/web/icons";

import styles from "./AttachmentTrayView.module.css";
import { type ViewModel, useViewModel } from "../../../core/viewmodel";
import { useI18n } from "../../../core/i18n/i18nContext";

/** One file of the tray. */
export interface AttachmentTrayItem {
    /** Stays the same for as long as the file is in the tray */
    id: string;
    /** The file's name */
    name: string;
    /** The file's size, ready to show, e.g. `1.2 MB` */
    size: string;
    /** A picture and a video are shown by a thumbnail of themselves, any other file by a chip */
    kind: "image" | "video" | "file";
    /** What to show of a picture or a video: a URL of the file itself */
    thumbnailUrl?: string;
    /** "pending" until the message is sent, then "uploading", and "failed" if that did not work */
    status: "pending" | "uploading" | "failed";
    /** How much of the file is uploaded, from 0 to 1; looked at while "uploading" */
    progress: number;
}

export interface AttachmentTrayViewSnapshot {
    /** The files, in the order they will be sent. Nothing is rendered when there are none. */
    items: AttachmentTrayItem[];
}

export interface AttachmentTrayViewActions {
    /** Takes a file out of the tray; one that is being uploaded is stopped */
    onRemove: (id: string) => void;
    /** Sends a file whose upload failed once more */
    onRetry: (id: string) => void;
}

/** The view model of the composer's attachment tray. */
export type AttachmentTrayViewModel = ViewModel<AttachmentTrayViewSnapshot, AttachmentTrayViewActions>;

interface AttachmentTrayViewProps {
    /** The view model */
    vm: AttachmentTrayViewModel;
    /** Extra CSS classes for the tray */
    className?: string;
}

function Preview({ item }: Readonly<{ item: AttachmentTrayItem }>): JSX.Element {
    if (item.kind === "image" && item.thumbnailUrl) {
        // The name stands right below, so the picture itself says nothing more
        return <img className={styles.media} src={item.thumbnailUrl} alt="" draggable={false} />;
    }
    if (item.kind === "video" && item.thumbnailUrl) {
        return (
            <>
                {/* Not played here: only its first frame is wanted */}
                <video className={styles.media} src={item.thumbnailUrl} preload="metadata" muted playsInline />
                <PlaySolidIcon className={styles.badge} aria-hidden="true" />
            </>
        );
    }
    return <DocumentIcon className={styles.fileIcon} aria-hidden="true" />;
}

/**
 * The files that wait in the composer to be sent with the next message, in a row above the text:
 * a picture or a video as a thumbnail, any other file as a chip with its icon, and under each its
 * name and size. Every file has a button that takes it out. While the message is being sent the
 * files stay, each with how far its upload is; one whose upload failed says so and can be sent
 * again. Nothing is rendered while there are no files.
 */
export function AttachmentTrayView({ vm, className }: Readonly<AttachmentTrayViewProps>): JSX.Element | null {
    const { translate: _t } = useI18n();
    const { items } = useViewModel(vm);
    if (items.length === 0) return null;

    return (
        <ul
            className={classNames(styles.tray, className)}
            aria-label={_t("composer|attachments|label")}
            data-testid="attachment-tray"
        >
            {items.map((item) => {
                const percent = Math.round(Math.min(1, Math.max(0, item.progress)) * 100);
                return (
                    <li key={item.id} className={styles.card} data-status={item.status} data-kind={item.kind}>
                        <div className={styles.preview}>
                            <Preview item={item} />
                            {item.status === "uploading" && (
                                <div className={styles.overlay}>
                                    <span className={styles.percent} aria-hidden="true">
                                        {percent} %
                                    </span>
                                    <div
                                        className={styles.track}
                                        role="progressbar"
                                        aria-label={_t("composer|attachments|uploading", { name: item.name })}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-valuenow={percent}
                                    >
                                        <div className={styles.fill} style={{ width: `${percent}%` }} />
                                    </div>
                                </div>
                            )}
                            {item.status === "failed" && (
                                <div className={styles.overlay}>
                                    <button
                                        type="button"
                                        className={styles.retry}
                                        aria-label={_t("composer|attachments|retry", { name: item.name })}
                                        title={_t("composer|attachments|retry_title")}
                                        onClick={() => vm.onRetry(item.id)}
                                    >
                                        <RestartIcon aria-hidden="true" />
                                    </button>
                                </div>
                            )}
                        </div>
                        <div className={styles.meta}>
                            <span className={styles.name} title={item.name}>
                                {item.name}
                            </span>
                            {item.status === "failed" ? (
                                <span className={classNames(styles.detail, styles.error)} role="status">
                                    <ErrorSolidIcon aria-hidden="true" />
                                    {_t("composer|attachments|failed")}
                                </span>
                            ) : (
                                <span className={styles.detail}>{item.size}</span>
                            )}
                        </div>
                        <button
                            type="button"
                            className={styles.remove}
                            aria-label={_t("composer|attachments|remove", { name: item.name })}
                            onClick={() => vm.onRemove(item.id)}
                        >
                            <CloseIcon aria-hidden="true" />
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
