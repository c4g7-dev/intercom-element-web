/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "test-utils-rtl";
import { getMockClientWithEventEmitter, mockClientMethodsUser } from "test-utils";

import HelpUserSettingsTab from "./HelpUserSettingsTab";
import MatrixClientContext from "../../../../../contexts/MatrixClientContext";
import SdkConfig from "../../../../../SdkConfig";

describe("<HelpUserSettingsTab />", () => {
    const mockClient = getMockClientWithEventEmitter({
        ...mockClientMethodsUser("@alice:server.org"),
        getCrypto: vi.fn().mockReturnValue(undefined),
        getHomeserverUrl: vi.fn().mockReturnValue("https://server.org"),
        getIdentityServerUrl: vi.fn().mockReturnValue(undefined),
        getAccessToken: vi.fn().mockReturnValue("token"),
    });

    const getComponent = () =>
        render(<HelpUserSettingsTab />, {
            wrapper: ({ children }) => (
                <MatrixClientContext.Provider value={mockClient}>{children}</MatrixClientContext.Provider>
            ),
        });

    afterEach(() => {
        SdkConfig.reset();
    });

    it("says that a rebranded build is based on Element", () => {
        SdkConfig.add({ brand: "InterCom" });
        getComponent();

        expect(screen.getByText(/InterCom is an unofficial, modified build/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Element" })).toHaveAttribute(
            "href",
            "https://github.com/element-hq/element-web",
        );
    });

    it("does not say so in an Element build", () => {
        getComponent();

        expect(screen.queryByText(/unofficial, modified build/)).not.toBeInTheDocument();
    });
});
