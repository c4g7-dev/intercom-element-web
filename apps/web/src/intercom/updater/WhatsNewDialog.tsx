/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { WhatsNewView } from "@element-hq/web-shared-components";

import { _t } from "../../languageHandler";
import BaseDialog from "../../components/views/dialogs/BaseDialog";
import { RELEASES_URL, type UpdaterReleaseNotes } from "./Updater";

interface Props {
    /** The release that runs now */
    version: string;
    /** The notes of the releases the update brought, newest first */
    notes: UpdaterReleaseNotes[];
    onFinished: () => void;
}

/** "What's new in InterCom <version>", shown once after an update; see WhatsNew.ts. */
export function WhatsNewDialog({ version, notes, onFinished }: Props): JSX.Element {
    return (
        <BaseDialog
            className="mx_IntercomWhatsNewDialog"
            title={_t("intercom|whats_new|title", { version })}
            onFinished={onFinished}
            hasCancel
            fixedWidth={false}
        >
            <WhatsNewView
                version={version}
                notes={notes.map(({ version, body }) => ({ version, body }))}
                releasesUrl={RELEASES_URL}
                heading={false}
                onDismiss={onFinished}
            />
        </BaseDialog>
    );
}
