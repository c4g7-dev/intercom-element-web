/*
Copyright 2025 New Vector Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import path from "node:path";
import { fileURLToPath } from "node:url";
import { type JsonObject } from "shared-types";

import { loadJsonFile } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let buildConfig: BuildConfig;

interface BuildConfig {
    // Application User Model ID
    appId: string;
    // Protocol string used for OIDC callbacks
    protocol: string;
    // Subject name of the code signing cert used for Windows packages, if signed
    // used as a basis for the Tray GUID which must be rolled if the certificate changes.
    windowsCertSubjectName: string | undefined;
    // InterCom: the InterCom release this build is, e.g. "1.12.35-intercom.5". Written into
    // package.json when a release is packaged (INTERCOM_VERSION); absent from any other build.
    intercomVersion: string | undefined;
}

export function getBuildConfig(): BuildConfig {
    if (!buildConfig) {
        const packageJson = loadJsonFile(path.join(__dirname, "..", "package.json")) as JsonObject;
        buildConfig = {
            appId: (packageJson["electron_appId"] as string) || "chat.intercom.desktop",
            protocol: (packageJson["electron_protocol"] as string) || "com.c4g7.intercom",
            windowsCertSubjectName: packageJson["electron_windows_cert_sn"] as string,
            intercomVersion: (packageJson["intercomVersion"] as string) || undefined,
        };
    }

    return buildConfig;
}

/** InterCom: the InterCom release this build is, or undefined for a build that is not a release. */
export function getIntercomVersion(): string | undefined {
    return getBuildConfig().intercomVersion;
}
