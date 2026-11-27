/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import classNames from "classnames";
import { DownloadIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import styles from "./UpdateRailButtonView.module.css";
import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { useI18n } from "../../core/i18n/i18nContext";
import { type ReleaseNotesEntry, ReleaseNotesView } from "../ReleaseNotesView";

/**
 * What the button stands for. hidden: nothing newer is known. available: a newer release is
 * known and not downloaded. downloading; preparing (the checksum, unpacking); ready: a click
 * installs it. installing: the app is about to start again. manual: a newer release that this
 * install cannot put in place. failed: the download or the installation went wrong.
 */
export type UpdateRailButtonState =
    | "hidden"
    | "available"
    | "downloading"
    | "preparing"
    | "ready"
    | "installing"
    | "manual"
    | "failed";

export interface UpdateRailButtonViewSnapshot {
    state: UpdateRailButtonState;
    /** The newer release, e.g. `1.12.35-intercom.13` */
    version?: string;
    /** 0 to 100 while downloading; undefined where the size is not known */
    percent?: number;
    /** Whether the update installs itself, and the app starts again, once it is ready: the button was clicked */
    installWhenReady: boolean;
    /** The notes of the releases the update brings, newest first */
    notes: ReleaseNotesEntry[];
}

export interface UpdateRailButtonViewActions {
    /**
     * The click: installs the update and starts the app again, now if it is ready and otherwise
     * as soon as it is; for a release the install cannot put in place, opens its page.
     */
    onUpdate: () => void;
    /** Opens the page of the release */
    onOpenReleasePage: () => void;
}

/** The view model of the update button. */
export type UpdateRailButtonViewModel = ViewModel<UpdateRailButtonViewSnapshot, UpdateRailButtonViewActions>;

interface UpdateRailButtonViewProps {
    /** The view model */
    vm: UpdateRailButtonViewModel;
    /** Whether the rail is expanded: the button then carries its name beside the icon */
    expanded?: boolean;
}

/** How long the card stays after the pointer left the button, to be reached across the gap. */
const CLOSE_DELAY_MS = 180;
const RING_RADIUS = 17;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The update button of the rail of spaces, above the settings: a download arrow with a red dot
 * while a newer release is available, on its way or ready, and nothing while the app is up to
 * date. A ring around it fills as the download goes.
 *
 * Pointing at it, or focusing it, opens a card beside it: "InterCom <version>", where the update
 * stands, and what is new in it. One click is all it takes: a ready update is installed and the
 * app started again; one on its way is installed as soon as it is downloaded and checked.
 */
export function UpdateRailButtonView({
    vm,
    expanded = false,
}: Readonly<UpdateRailButtonViewProps>): JSX.Element | null {
    const { translate: _t } = useI18n();
    const { state, version = "", percent, installWhenReady, notes } = useViewModel(vm);
    const [open, setOpen] = useState(false);
    const [place, setPlace] = useState<{ left: number; bottom: number } | null>(null);
    const button = useRef<HTMLButtonElement>(null);
    const card = useRef<HTMLDivElement>(null);
    const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
    const cardId = useId();

    const show = useCallback((): void => {
        clearTimeout(closing.current);
        setOpen(true);
    }, []);
    const hideSoon = useCallback((): void => {
        clearTimeout(closing.current);
        closing.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
    }, []);
    useEffect(() => () => clearTimeout(closing.current), []);

    // Beside the button, its foot level with the button's, and within the window
    useLayoutEffect(() => {
        if (!open || !button.current) return;
        const measure = (): void => {
            const rect = button.current?.getBoundingClientRect();
            if (!rect) return;
            setPlace({ left: rect.right + 12, bottom: Math.max(8, window.innerHeight - rect.bottom - 4) });
        };
        measure();
        window.addEventListener("resize", measure);
        return (): void => window.removeEventListener("resize", measure);
    }, [open, state]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return (): void => document.removeEventListener("keydown", onKey);
    }, [open]);

    if (state === "hidden") return null;

    const percentText = percent === undefined ? undefined : `${Math.floor(percent)} %`;
    let status: string;
    let hint: string | undefined;
    switch (state) {
        case "available":
            status = _t("intercom|update_button|available");
            hint = _t("intercom|update_button|hint_download");
            break;
        case "downloading":
            status = percentText
                ? _t("intercom|update_button|downloading_percent", { percent: percentText })
                : _t("intercom|update_button|downloading");
            hint = installWhenReady
                ? _t("intercom|update_button|hint_will_restart")
                : _t("intercom|update_button|hint_install_when_ready");
            break;
        case "preparing":
            status = _t("intercom|update_button|preparing");
            hint = installWhenReady
                ? _t("intercom|update_button|hint_will_restart")
                : _t("intercom|update_button|hint_install_when_ready");
            break;
        case "ready":
            status = _t("intercom|update_button|ready");
            hint = _t("intercom|update_button|hint_restart");
            break;
        case "installing":
            status = _t("intercom|update_button|installing");
            break;
        case "manual":
            status = _t("intercom|update_button|manual");
            hint = _t("intercom|update_button|hint_release_page");
            break;
        default:
            status = _t("intercom|update_button|failed");
            hint = _t("intercom|update_button|hint_retry");
    }
    // What a tooltip would say: the name of the button for screen readers
    const label = _t("intercom|update_button|label", { version, status });
    const busy = state === "downloading" || state === "preparing" || state === "installing";

    return (
        <div
            className={classNames(styles.root, "mx_IntercomUpdateRailButton", { [styles.expanded]: expanded })}
            data-testid="intercom-update-rail"
            data-state={state}
            onMouseEnter={show}
            onMouseLeave={hideSoon}
            onFocus={show}
            onBlur={(e) => {
                const next = e.relatedTarget as Node | null;
                if (next && (e.currentTarget.contains(next) || card.current?.contains(next))) return;
                hideSoon();
            }}
        >
            <button
                ref={button}
                type="button"
                className={classNames(styles.button, {
                    [styles.ready]: state === "ready",
                    [styles.armed]: installWhenReady && busy,
                    [styles.failed]: state === "failed",
                })}
                aria-label={label}
                aria-describedby={open ? cardId : undefined}
                aria-busy={busy || undefined}
                disabled={state === "installing"}
                onClick={vm.onUpdate}
            >
                <span className={styles.icon}>
                    {state === "downloading" && (
                        <svg className={styles.ring} viewBox="0 0 40 40" aria-hidden="true">
                            <circle className={styles.ringTrack} cx="20" cy="20" r={RING_RADIUS} />
                            <circle
                                className={classNames(styles.ringFill, { [styles.ringUnknown]: percent === undefined })}
                                cx="20"
                                cy="20"
                                r={RING_RADIUS}
                                strokeDasharray={RING_LENGTH}
                                strokeDashoffset={RING_LENGTH * (1 - (percent ?? 25) / 100)}
                            />
                        </svg>
                    )}
                    <DownloadIcon width="20px" height="20px" aria-hidden="true" />
                    <span className={styles.dot} data-testid="intercom-update-rail-dot" />
                </span>
                {expanded && <span className={styles.name}>{_t("intercom|update_button|name")}</span>}
            </button>
            {open &&
                place &&
                createPortal(
                    <div
                        ref={card}
                        id={cardId}
                        className={classNames(styles.card, "mx_IntercomUpdateRailCard")}
                        style={{ left: place.left, bottom: place.bottom }}
                        role="tooltip"
                        data-testid="intercom-update-rail-card"
                        onMouseEnter={show}
                        onMouseLeave={hideSoon}
                    >
                        <div className={styles.head}>
                            <span className={styles.title}>{_t("intercom|update_button|title", { version })}</span>
                            <span className={classNames(styles.status, { [styles.statusFailed]: state === "failed" })}>
                                {status}
                            </span>
                            {state === "downloading" && (
                                <progress
                                    className={styles.progress}
                                    value={percent === undefined ? undefined : Math.floor(percent)}
                                    max={100}
                                    aria-label={_t("intercom|updater|download_progress")}
                                />
                            )}
                        </div>
                        {notes.length > 0 && (
                            <div className={styles.whatsNew}>
                                <span className={styles.whatsNewTitle}>
                                    {_t("intercom|update_button|whats_new", { version: notes[0].version })}
                                </span>
                                {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a list that scrolls must be reachable with the keyboard to be scrolled */}
                                <div className={styles.scroll} tabIndex={0}>
                                    <ReleaseNotesView notes={notes} compact titledByFirst />
                                </div>
                            </div>
                        )}
                        {hint && <div className={styles.hint}>{hint}</div>}
                    </div>,
                    document.body,
                )}
        </div>
    );
}
