/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { useEffect, useState } from "react";
import { type Capabilities, type MatrixClient } from "matrix-js-sdk/src/matrix";

/**
 * What the account settings need to know before they show anything about the account: whether
 * the account is managed somewhere else (a homeserver that signs in through OAuth, i.e. Matrix
 * Authentication Service) and what the server lets the user change.
 *
 * Both are answers of the server, so they arrive after the settings were opened. The settings used
 * to draw as if nothing were managed elsewhere and take sections away again once the answers
 * were there: e-mail addresses, phone numbers and "Deactivate account" were on the screen for a
 * moment on servers where they do not belong. Now the sections wait for the answers, and the
 * answers are asked for when the app starts, so that the settings mostly open with them at hand.
 */
export interface AccountCapabilities {
    /** Where the account is managed when not here; undefined if it is managed here */
    externalAccountManagementUrl?: string;
    /** The actions the place the account is managed at supports (MSC4191) */
    accountManagementActionsSupported?: string[];
    canMake3pidChanges: boolean;
    canSetDisplayName: boolean;
    canSetAvatar: boolean;
    canChangePassword: boolean;
}

interface Entry {
    promise: Promise<AccountCapabilities>;
    value?: AccountCapabilities;
    at: number;
}

const entries = new WeakMap<MatrixClient, Entry>();
/** After this long the answers are asked for again when the settings are opened. */
const MAX_AGE_MS = 10 * 60 * 1000;

async function load(client: MatrixClient): Promise<AccountCapabilities> {
    const [capabilities, authMetadata] = await Promise.all([
        client.getCapabilities().then(
            (c): Capabilities => c ?? {},
            (): Capabilities => ({}),
        ),
        client.getAuthMetadata().catch(() => undefined),
    ]);
    const changePassword = capabilities["m.change_password"];
    return {
        externalAccountManagementUrl: authMetadata?.account_management_uri,
        accountManagementActionsSupported: authMetadata?.account_management_actions_supported,
        // You can change your password so long as the capability isn't explicitly disabled
        canChangePassword: !changePassword || changePassword["enabled"] !== false,
        // https://spec.matrix.org/v1.7/client-server-api/#m3pid_changes-capability
        // Servers as old as v1.1 do not have it, so a missing one means yes
        canMake3pidChanges: !capabilities["m.3pid_changes"] || capabilities["m.3pid_changes"].enabled === true,
        canSetDisplayName: !capabilities["m.set_displayname"] || capabilities["m.set_displayname"].enabled === true,
        canSetAvatar: !capabilities["m.set_avatar_url"] || capabilities["m.set_avatar_url"].enabled === true,
    };
}

/**
 * Asks the server (once per client, and again when the answers are older than ten minutes).
 * Call it early, e.g. when the app has started, so that {@link knownAccountCapabilities} has the
 * answers by the time the settings are opened.
 */
export function fetchAccountCapabilities(client: MatrixClient, now = Date.now()): Promise<AccountCapabilities> {
    const existing = entries.get(client);
    // While a request is on its way, or its answer is fresh, there is nothing to ask
    if (existing && (!existing.value || now - existing.at < MAX_AGE_MS)) return existing.promise;

    const entry: Entry = { promise: load(client), value: existing?.value, at: now };
    entry.promise = entry.promise.then(
        (value) => {
            entry.value = value;
            return value;
        },
        (e) => {
            // Asked again next time rather than remembered as a failure
            if (entries.get(client) === entry) entries.delete(client);
            throw e;
        },
    );
    entry.promise.catch(() => undefined);
    entries.set(client, entry);
    return entry.promise;
}

/** The answers if the server has given them already; undefined while they are not known. */
export function knownAccountCapabilities(client: MatrixClient): AccountCapabilities | undefined {
    return entries.get(client)?.value;
}

/**
 * The answers for a component: undefined until they are known, which is the time to show a
 * placeholder and nothing about the account.
 */
export function useAccountCapabilities(client: MatrixClient): AccountCapabilities | undefined {
    const [value, setValue] = useState(() => knownAccountCapabilities(client));
    useEffect(() => {
        let current = true;
        setValue(knownAccountCapabilities(client));
        fetchAccountCapabilities(client).then(
            (v) => current && setValue(v),
            () => undefined,
        );
        return (): void => {
            current = false;
        };
    }, [client]);
    return value;
}
