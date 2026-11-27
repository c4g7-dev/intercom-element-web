/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useState } from "react";
import { UpdaterSettingsView, useCreateAutoDisposedViewModel } from "@element-hq/web-shared-components";

import { _t } from "../../languageHandler";
import SettingsTab from "../../components/views/settings/tabs/SettingsTab";
import { SettingsSection } from "../../components/views/settings/shared/SettingsSection";
import { SettingsSubsection } from "../../components/views/settings/shared/SettingsSubsection";
import { UpdaterSettingsViewModel } from "../../viewmodels/intercom/UpdaterSettingsViewModel";
import Field from "../../components/views/elements/Field";
import { ALONE_TIMEOUT_CHOICES, type AloneTimeout, getAloneTimeout, readAloneTimeout } from "../AloneTimeout";
import { changeAloneTimeout } from "../CallActions";

/** How a choice of the time to stay alone in a call for is written. */
function aloneTimeoutLabel(timeout: AloneTimeout): string {
    return timeout === "never"
        ? _t("intercom|calls|alone_timeout_never")
        : _t("intercom|calls|alone_timeout_minutes", { count: Math.round(timeout / 60) });
}

/** Settings → InterCom: what is InterCom's own. Its updates, and how long a call waits for you alone. */
export function IntercomUserSettingsTab(): JSX.Element {
    const vm = useCreateAutoDisposedViewModel(() => new UpdaterSettingsViewModel());
    const [aloneTimeout, setAloneTimeout] = useState(getAloneTimeout);
    return (
        <SettingsTab>
            <SettingsSection>
                <SettingsSubsection
                    heading={_t("intercom|updater|heading")}
                    description={_t("intercom|updater|description")}
                >
                    <UpdaterSettingsView vm={vm} />
                </SettingsSubsection>
                <SettingsSubsection
                    heading={_t("intercom|calls|heading")}
                    description={_t("intercom|calls|alone_timeout_description")}
                >
                    <Field
                        element="select"
                        label={_t("intercom|calls|alone_timeout_label")}
                        value={String(aloneTimeout)}
                        onChange={(e) => {
                            const chosen = readAloneTimeout(e.target.value);
                            setAloneTimeout(chosen);
                            // Kept, and a call that is on takes it at once
                            void changeAloneTimeout(chosen);
                        }}
                        data-testid="intercom-alone-timeout"
                    >
                        {ALONE_TIMEOUT_CHOICES.map((choice) => (
                            <option key={String(choice)} value={String(choice)}>
                                {aloneTimeoutLabel(choice)}
                            </option>
                        ))}
                    </Field>
                </SettingsSubsection>
            </SettingsSection>
        </SettingsTab>
    );
}
