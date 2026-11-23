/*
Copyright 2019-2024 New Vector Ltd.
Copyright 2019 The Matrix.org Foundation C.I.C.
Copyright 2019 Michael Telatynski <7t3chguy@gmail.com>

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useContext } from "react";
import { HTTPError } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";

import { UserFriendlyError, _t } from "../../../../../languageHandler";
import UserProfileSettings from "../../UserProfileSettings";
import SettingsStore from "../../../../../settings/SettingsStore";
import AccessibleButton from "../../../elements/AccessibleButton";
import DeactivateAccountDialog from "../../../dialogs/DeactivateAccountDialog";
import Modal from "../../../../../Modal";
import { UIFeature } from "../../../../../settings/UIFeature";
import ErrorDialog, { extractErrorMessageFromError } from "../../../dialogs/ErrorDialog";
import ChangePassword from "../../ChangePassword";
import SettingsTab from "../SettingsTab";
import { SettingsSection } from "../../shared/SettingsSection";
import { SettingsSubsection, SettingsSubsectionText } from "../../shared/SettingsSubsection";
import { UserPersonalInfoSettings } from "../../UserPersonalInfoSettings";
import { SDKContext } from "../../../../../contexts/SDKContext.ts";
import { useAccountCapabilities } from "../../../../../intercom/AccountCapabilities";

interface IProps {
    closeSettingsFn: () => void;
    /**
     * If true, the status control starts in custom status mode, ready for the user to enter a custom status.
     */
    startCustomStatus?: boolean;
}

interface AccountSectionProps {
    canChangePassword: boolean;
    onPasswordChangeError: (e: Error) => void;
    onPasswordChanged: () => void;
}

const AccountSection: React.FC<AccountSectionProps> = ({
    canChangePassword,
    onPasswordChangeError,
    onPasswordChanged,
}) => {
    if (!canChangePassword) return <></>;

    return (
        <SettingsSection>
            <SettingsSubsection
                heading={_t("settings|general|account_section")}
                stretchContent
                data-testid="accountSection"
            >
                <SettingsSubsectionText>{_t("settings|general|password_change_section")}</SettingsSubsectionText>
                <ChangePassword
                    rowClassName=""
                    buttonKind="primary"
                    onError={onPasswordChangeError}
                    onFinished={onPasswordChanged}
                />
            </SettingsSubsection>
        </SettingsSection>
    );
};

interface ManagementSectionProps {
    onDeactivateClicked: () => void;
}

const ManagementSection: React.FC<ManagementSectionProps> = ({ onDeactivateClicked }) => {
    return (
        <SettingsSection heading={_t("settings|general|deactivate_section")}>
            <SettingsSubsection
                heading={_t("settings|general|account_management_section")}
                data-testid="account-management-section"
                description={_t("settings|general|deactivate_warning")}
            >
                <AccessibleButton onClick={onDeactivateClicked} kind="danger">
                    {_t("settings|general|deactivate_section")}
                </AccessibleButton>
            </SettingsSubsection>
        </SettingsSection>
    );
};

const AccountUserSettingsTab: React.FC<IProps> = ({ closeSettingsFn, startCustomStatus }) => {
    const sdkContext = useContext(SDKContext);
    const cli = sdkContext.client!;
    // InterCom: undefined until the server has said where the account is managed and what may be
    // changed. Nothing that depends on it is drawn before: on a server with delegated sign-in
    // the e-mail addresses, the password and "Deactivate account" used to show for a moment.
    const capabilities = useAccountCapabilities(cli);

    const onPasswordChangeError = useCallback((err: Error): void => {
        logger.error("Failed to change password: " + err);

        let underlyingError = err;
        if (err instanceof UserFriendlyError && err.cause instanceof Error) {
            underlyingError = err.cause;
        }

        const errorMessage = extractErrorMessageFromError(
            err,
            _t("settings|general|error_password_change_unknown", {
                stringifiedError: String(err),
            }),
        );

        let errorMessageToDisplay = errorMessage;
        if (underlyingError instanceof HTTPError && underlyingError.httpStatus === 403) {
            errorMessageToDisplay = _t("settings|general|error_password_change_403");
        } else if (underlyingError instanceof HTTPError) {
            errorMessageToDisplay = _t("settings|general|error_password_change_http", {
                errorMessage,
                httpStatus: underlyingError.httpStatus,
            });
        }

        // TODO: Figure out a design that doesn't involve replacing the current dialog
        Modal.createDialog(ErrorDialog, {
            title: _t("settings|general|error_password_change_title"),
            description: errorMessageToDisplay,
        });
    }, []);

    const onPasswordChanged = useCallback((): void => {
        const description = _t("settings|general|password_change_success");
        // TODO: Figure out a design that doesn't involve replacing the current dialog
        Modal.createDialog(ErrorDialog, {
            title: _t("common|success"),
            description,
        });
    }, []);

    const onDeactivateClicked = useCallback((): void => {
        const { finished } = Modal.createDialog(DeactivateAccountDialog);
        void finished.then(([success]) => {
            if (success) closeSettingsFn();
        });
    }, [closeSettingsFn]);

    if (!capabilities) {
        return (
            <SettingsTab data-testid="mx_AccountUserSettingsTab">
                <div
                    className="mx_IntercomSettingsPlaceholder"
                    data-testid="account-settings-loading"
                    role="status"
                    aria-busy="true"
                    aria-label={_t("common|loading")}
                >
                    <div className="mx_IntercomSettingsPlaceholder_avatar" />
                    <div className="mx_IntercomSettingsPlaceholder_line" />
                    <div className="mx_IntercomSettingsPlaceholder_line mx_IntercomSettingsPlaceholder_line_short" />
                    <div className="mx_IntercomSettingsPlaceholder_block" />
                </div>
            </SettingsTab>
        );
    }
    const { externalAccountManagementUrl, canMake3pidChanges, canSetDisplayName, canSetAvatar, canChangePassword } =
        capabilities;

    let accountManagementSection: JSX.Element | undefined;
    const isAccountManagedExternally = Boolean(externalAccountManagementUrl);
    if (SettingsStore.getValue(UIFeature.Deactivate) && !isAccountManagedExternally) {
        accountManagementSection = <ManagementSection onDeactivateClicked={onDeactivateClicked} />;
    }

    return (
        <SettingsTab data-testid="mx_AccountUserSettingsTab">
            <UserProfileSettings
                externalAccountManagementUrl={externalAccountManagementUrl}
                canSetDisplayName={canSetDisplayName}
                canSetAvatar={canSetAvatar}
                startCustomStatus={startCustomStatus}
            />
            {(!isAccountManagedExternally || canMake3pidChanges) && (
                <UserPersonalInfoSettings canMake3pidChanges={canMake3pidChanges} />
            )}
            <AccountSection
                canChangePassword={canChangePassword}
                onPasswordChanged={onPasswordChanged}
                onPasswordChangeError={onPasswordChangeError}
            />
            {accountManagementSection}
        </SettingsTab>
    );
};

export default AccountUserSettingsTab;
