/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX } from "react";
import { LatticeMark } from "@element-hq/web-shared-components";

import { _t } from "../languageHandler";

interface LatticeLoadingProps {
    /** `loading` while the app starts, `connecting` while a call is being joined */
    variant?: "loading" | "connecting";
    /** A line under the mark, e.g. "Connecting" */
    message?: string;
    /** Width and height of the mark, as a CSS length */
    size?: string;
}

/**
 * Lattice's moving mark in the middle of whatever it is put in, where the app shows that it is
 * starting or that a call is being joined. It stands where a {@link Spinner} stood and answers to
 * the same role and test id, so that what waits for the spinner to go waits for this.
 */
export function LatticeLoading({ variant = "loading", message, size = "72px" }: LatticeLoadingProps): JSX.Element {
    return (
        <div className="mx_Spinner mx_LatticeLoading">
            <div
                className="mx_LatticeLoading_mark"
                role="progressbar"
                aria-label={message ?? _t("common|loading")}
                data-testid="spinner"
            >
                <LatticeMark variant={variant} size={size} />
            </div>
            {message && <div className="mx_LatticeLoading_message">{message}</div>}
        </div>
    );
}
