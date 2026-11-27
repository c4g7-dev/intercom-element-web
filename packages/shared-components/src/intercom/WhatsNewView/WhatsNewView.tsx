/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, useId } from "react";
import { Button, Heading } from "@vector-im/compound-web";

import styles from "./WhatsNewView.module.css";
import { useI18n } from "../../core/i18n/i18nContext";
import { type ReleaseNotesEntry, ReleaseNotesView } from "../ReleaseNotesView";

interface WhatsNewViewProps {
    /** The release that runs now, e.g. `1.12.35-intercom.13` */
    version: string;
    /** The notes of the releases the update brought, newest first */
    notes: ReleaseNotesEntry[];
    /** Where all release notes are, opened outside the app */
    releasesUrl: string;
    /** Whether the view carries its own title; false inside a dialog that has it in its frame */
    heading?: boolean;
    /** "Got it" */
    onDismiss: () => void;
}

/**
 * What is new after an update: "What's new in Lattice <version>", the notes of every release
 * the update brought in a list that scrolls, "Got it" and a link to all release notes. The body
 * of a dialog; whoever shows it gives it the frame.
 */
export function WhatsNewView({
    version,
    notes,
    releasesUrl,
    heading = true,
    onDismiss,
}: Readonly<WhatsNewViewProps>): JSX.Element {
    const { translate: _t } = useI18n();
    const titleId = useId();
    return (
        <section
            className={styles.root}
            aria-labelledby={heading ? titleId : undefined}
            aria-label={heading ? undefined : _t("intercom|whats_new|title", { version })}
            data-testid="intercom-whats-new"
        >
            <header className={styles.head}>
                {heading && (
                    <Heading as="h2" size="sm" weight="semibold" id={titleId} className={styles.title}>
                        {_t("intercom|whats_new|title", { version })}
                    </Heading>
                )}
                <p className={styles.subtitle}>{_t("intercom|whats_new|subtitle")}</p>
            </header>
            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a list that scrolls must be reachable with the keyboard to be scrolled */}
            <div className={styles.scroll} tabIndex={0}>
                <ReleaseNotesView notes={notes} titledByFirst={notes[0]?.version === version} />
            </div>
            <footer className={styles.foot}>
                <a className={styles.all} href={releasesUrl} target="_blank" rel="noreferrer noopener">
                    {_t("intercom|whats_new|all_notes")}
                </a>
                <Button size="md" kind="primary" autoFocus onClick={onDismiss}>
                    {_t("intercom|whats_new|got_it")}
                </Button>
            </footer>
        </section>
    );
}
