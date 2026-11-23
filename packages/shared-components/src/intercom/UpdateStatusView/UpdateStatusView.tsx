/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, useId } from "react";
import classNames from "classnames";

import styles from "./UpdateStatusView.module.css";
import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { useI18n } from "../../core/i18n/i18nContext";
import { type UpdaterPhase } from "../UpdaterSettingsView";

/** How far a download is. */
export interface UpdateStatusDownload {
    /** Bytes received */
    done: number;
    /** Bytes of the whole file; 0 where that is not known */
    total: number;
    bytesPerSecond: number;
}

/** One step the updater took. */
export interface UpdateStatusLogLine {
    /** When, ready to show (a time of day) */
    time: string;
    text: string;
}

export interface UpdateStatusViewSnapshot {
    /** Where the update stands; nothing is shown while "idle" */
    phase: UpdaterPhase;
    /** The newer release, once one is known, e.g. `1.12.35-intercom.7` */
    latestVersion?: string;
    /** While downloading */
    download?: UpdateStatusDownload;
    /** The last steps, oldest first */
    log: UpdateStatusLogLine[];
    /** Whether the steps are shown */
    expanded: boolean;
}

export interface UpdateStatusViewActions {
    /** Shows or hides the steps */
    onToggleDetails: () => void;
    /** Installs the update that is ready and starts the app again */
    onRestart: () => void;
    /** Looks for the update again after a failure */
    onRetry: () => void;
    /** Opens the page of the newer release */
    onOpenReleasePage: () => void;
}

/** The view model of the update status bar. */
export type UpdateStatusViewModel = ViewModel<UpdateStatusViewSnapshot, UpdateStatusViewActions>;

interface UpdateStatusViewProps {
    /** The view model */
    vm: UpdateStatusViewModel;
}

/** `1.5 MB`, `186 MB`: decimal units, as download pages give them. */
export function formatUpdateBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
    if (bytes < 1000) return `${Math.round(bytes)} B`;
    const units = ["kB", "MB", "GB", "TB"];
    let value = bytes / 1000;
    let unit = 0;
    while (value >= 1000 && unit < units.length - 1) {
        value /= 1000;
        unit++;
    }
    return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

/**
 * A slim bar that says where an update of the app stands while there is something to say: a
 * thin progress line and one line of text that changes in place ("Checking…", "Downloading … 42 %",
 * "Verifying checksum…", "Unpacking…", "… is ready" with a restart button). A click on the text
 * shows the last steps with their times. A failure stays, with "Retry" and "Details". Nothing is
 * rendered while the updater is idle.
 */
export function UpdateStatusView({ vm }: Readonly<UpdateStatusViewProps>): JSX.Element | null {
    const { translate: _t } = useI18n();
    const { phase, latestVersion, download, log, expanded } = useViewModel(vm);
    const detailsId = useId();
    if (phase === "idle") return null;

    const version = latestVersion ?? "";
    let text: string;
    switch (phase) {
        case "checking":
            text = _t("intercom|update_status|checking");
            break;
        case "downloading": {
            const parts = [_t("intercom|update_status|downloading", { version })];
            if (download && download.total > 0) {
                parts.push(`${Math.floor((download.done / download.total) * 100)} %`);
                parts.push(`${formatUpdateBytes(download.done)} / ${formatUpdateBytes(download.total)}`);
            } else if (download && download.done > 0) {
                parts.push(formatUpdateBytes(download.done));
            }
            if (download && download.bytesPerSecond > 0) parts.push(`${formatUpdateBytes(download.bytesPerSecond)}/s`);
            text = parts.join(" · ");
            break;
        }
        case "verifying":
            text = _t("intercom|update_status|verifying");
            break;
        case "unpacking":
            text = _t("intercom|update_status|unpacking");
            break;
        case "ready":
            text = _t("intercom|update_status|ready", { version });
            break;
        case "installing":
            text = _t("intercom|update_status|installing");
            break;
        case "manual":
            text = _t("intercom|update_status|manual", { version });
            break;
        default:
            text = _t("intercom|update_status|failed");
    }

    // How much of the line is filled: what is known of a download, all of it at the end, and
    // otherwise a piece that moves (or stands still for who asked for less motion)
    const known = phase === "downloading" && download && download.total > 0;
    const fraction = known ? Math.min(1, download.done / download.total) : undefined;
    const settled = phase === "ready" || phase === "manual" || phase === "error";

    return (
        <section
            className={classNames(styles.bar, "mx_IntercomUpdateStatus")}
            aria-label={_t("intercom|update_status|label")}
            data-testid="intercom-update-status"
            data-phase={phase}
        >
            <div
                className={classNames(styles.track, {
                    [styles.indeterminate]: fraction === undefined && !settled,
                    [styles.done]: phase === "ready",
                    [styles.failed]: phase === "error",
                    [styles.quiet]: phase === "manual",
                })}
                role="progressbar"
                aria-label={_t("intercom|update_status|progress")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={fraction === undefined ? undefined : Math.round(fraction * 100)}
            >
                <div
                    className={styles.fill}
                    style={fraction === undefined ? undefined : { width: `${(fraction * 100).toFixed(1)}%` }}
                />
            </div>
            <div className={styles.row}>
                <button
                    type="button"
                    className={classNames(styles.line, { [styles.error]: phase === "error" })}
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    title={expanded ? _t("intercom|update_status|hide_details") : _t("intercom|update_status|details")}
                    onClick={vm.onToggleDetails}
                >
                    <span role="status">{text}</span>
                </button>
                {phase === "ready" && (
                    <button type="button" className={classNames(styles.action, styles.primary)} onClick={vm.onRestart}>
                        {_t("intercom|update_status|restart")}
                    </button>
                )}
                {phase === "manual" && (
                    <button type="button" className={styles.action} onClick={vm.onOpenReleasePage}>
                        {_t("intercom|update_status|release_page")}
                    </button>
                )}
                {phase === "error" && (
                    <>
                        <button type="button" className={styles.action} onClick={vm.onRetry}>
                            {_t("intercom|update_status|retry")}
                        </button>
                        <button type="button" className={styles.action} onClick={vm.onToggleDetails}>
                            {expanded
                                ? _t("intercom|update_status|hide_details")
                                : _t("intercom|update_status|details")}
                        </button>
                    </>
                )}
            </div>
            {expanded && (
                <ol id={detailsId} className={styles.log} aria-label={_t("intercom|update_status|log_label")}>
                    {log.length === 0 && <li className={styles.empty}>{_t("intercom|update_status|log_empty")}</li>}
                    {log.map((line, i) => (
                        // Lines are only ever added at the end and dropped at the start
                        <li key={`${log.length - i}:${line.time}`}>
                            <time>{line.time}</time> {line.text}
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}
