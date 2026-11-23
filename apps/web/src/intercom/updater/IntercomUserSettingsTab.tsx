/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { UpdaterSettingsView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";

import { _t } from "../../languageHandler";
import SettingsTab from "../../components/views/settings/tabs/SettingsTab";
import { SettingsSection } from "../../components/views/settings/shared/SettingsSection";
import { SettingsSubsection } from "../../components/views/settings/shared/SettingsSubsection";
import { UpdaterSettingsViewModel } from "../../viewmodels/intercom/UpdaterSettingsViewModel";

/** Settings → InterCom: what is InterCom's own. For now, its updates. */
export function IntercomUserSettingsTab(): JSX.Element {
    const vm = useCreateAutoDisposedViewModel(() => new UpdaterSettingsViewModel());
    return (
        <SettingsTab>
            <SettingsSection>
                <SettingsSubsection
                    heading={_t("intercom|updater|heading")}
                    description={_t("intercom|updater|description")}
                >
                    <UpdaterSettingsView vm={vm} />
                </SettingsSubsection>
            </SettingsSection>
        </SettingsTab>
    );
}
