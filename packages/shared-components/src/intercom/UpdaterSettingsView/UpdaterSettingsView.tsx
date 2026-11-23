/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import { Button, Form, SettingsToggleInput, Text } from "@vector-im/compound-web";

import styles from "./UpdaterSettingsView.module.css";
import { type ViewModel, useViewModel } from "../../core/viewmodel";
import { useI18n } from "../../core/i18n/i18nContext";

/**
 * Where the updater stands. idle: nothing newer is known. ready: downloaded and checked, a
 * restart installs it. manual: there is a newer release that this install cannot put in place
 * by itself.
 */
export type UpdaterPhase = "idle" | "checking" | "downloading" | "ready" | "manual" | "error";

/** Why the app does not look for updates. */
export type UpdaterUnsupportedReason = "unpackaged" | "no-version" | "disabled-by-flag" | "platform" | "web";

export interface UpdaterSettingsViewSnapshot {
    /** Whether this app can look for updates at all */
    supported: boolean;
    /** Why not, where it cannot */
    reason?: UpdaterUnsupportedReason;
    /** The InterCom release that is running, e.g. `1.12.35-intercom.5` */
    currentVersion?: string;
    /** Whether the app looks for updates by itself */
    autoCheck: boolean;
    phase: UpdaterPhase;
    /** The newer release, once one is known */
    latestVersion?: string;
    /** 0 to 1 while downloading */
    progress?: number;
    /** What went wrong, in the phase "error" */
    error?: string;
    /** When the last check ended, ready to show; undefined before the first one */
    lastChecked?: string;
}

export interface UpdaterSettingsViewActions {
    /** Turns the automatic check on or off */
    onAutoCheckChange: (on: boolean) => void;
    /** Looks for an update now */
    onCheckNow: () => void;
    /** Installs the update that is ready and starts the app again */
    onRestart: () => void;
    /** Opens the page of the newer release, or of all releases */
    onOpenReleasePage: () => void;
}

/** The view model of the update settings. */
export type UpdaterSettingsViewModel = ViewModel<UpdaterSettingsViewSnapshot, UpdaterSettingsViewActions>;

interface UpdaterSettingsViewProps {
    /** The view model */
    vm: UpdaterSettingsViewModel;
}

/**
 * The update settings of InterCom: the version that runs, whether to look for updates
 * automatically, a button to look now, and what was found.
 */
export function UpdaterSettingsView({ vm }: Readonly<UpdaterSettingsViewProps>): JSX.Element {
    const { translate: _t } = useI18n();
    const { supported, reason, currentVersion, autoCheck, phase, latestVersion, progress, error, lastChecked } =
        useViewModel(vm);

    let status: string;
    switch (phase) {
        case "checking":
            status = _t("intercom|updater|checking");
            break;
        case "downloading":
            status = _t("intercom|updater|downloading", {
                version: latestVersion ?? "",
                percent: `${Math.round((progress ?? 0) * 100)}%`,
            });
            break;
        case "ready":
            status = _t("intercom|updater|ready", { version: latestVersion ?? "" });
            break;
        case "manual":
            status = _t("intercom|updater|manual", { version: latestVersion ?? "" });
            break;
        case "error":
            status = _t("intercom|updater|error", { message: error ?? "" });
            break;
        default:
            status = lastChecked
                ? _t("intercom|updater|up_to_date_checked", { when: lastChecked })
                : _t("intercom|updater|not_checked");
    }

    const unsupportedText: Record<UpdaterUnsupportedReason, string> = {
        "unpackaged": _t("intercom|updater|unsupported|unpackaged"),
        "no-version": _t("intercom|updater|unsupported|no_version"),
        "disabled-by-flag": _t("intercom|updater|unsupported|disabled_by_flag"),
        "platform": _t("intercom|updater|unsupported|platform"),
        "web": _t("intercom|updater|unsupported|web"),
    };

    return (
        <Form.Root className={styles.root} data-testid="intercom-updater-settings" onSubmit={(e) => e.preventDefault()}>
            <dl className={styles.facts}>
                <dt>{_t("intercom|updater|version")}</dt>
                <dd>{currentVersion ?? _t("intercom|updater|version_unknown")}</dd>
                <dt>{_t("intercom|updater|channel")}</dt>
                <dd>{_t("intercom|updater|channel_stable")}</dd>
            </dl>
            {!supported ? (
                <Text size="md" className={styles.note} role="note">
                    {unsupportedText[reason ?? "web"]}
                </Text>
            ) : (
                <>
                    <SettingsToggleInput
                        name="intercom_auto_update"
                        label={_t("intercom|updater|auto_check")}
                        helpMessage={_t("intercom|updater|auto_check_help")}
                        checked={autoCheck}
                        onChange={(e) => vm.onAutoCheckChange(e.target.checked)}
                    />
                    <div className={styles.status}>
                        <Text size="md" role="status" className={phase === "error" ? styles.error : undefined}>
                            {status}
                        </Text>
                        {phase === "downloading" && (
                            <progress
                                className={styles.progress}
                                value={Math.round((progress ?? 0) * 100)}
                                max={100}
                                aria-label={_t("intercom|updater|download_progress")}
                            />
                        )}
                    </div>
                    <div className={styles.buttons}>
                        {phase === "ready" && (
                            <Button size="md" kind="primary" onClick={vm.onRestart}>
                                {_t("intercom|updater|restart")}
                            </Button>
                        )}
                        <Button
                            size="md"
                            kind="secondary"
                            disabled={phase === "checking" || phase === "downloading"}
                            onClick={vm.onCheckNow}
                        >
                            {_t("intercom|updater|check_now")}
                        </Button>
                        <Button size="md" kind="tertiary" onClick={vm.onOpenReleasePage}>
                            {latestVersion ? _t("intercom|updater|release_notes") : _t("intercom|updater|all_releases")}
                        </Button>
                    </div>
                </>
            )}
        </Form.Root>
    );
}
