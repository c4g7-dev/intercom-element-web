/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import React from "react";
import { act, render, screen } from "test-utils-rtl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ToastContainer, { getOrCreateToastHost, TOAST_HOST_ID } from "./ToastContainer";
import ToastStore from "../../stores/ToastStore";
import { GenericToast } from "@element-hq/web-shared-components";
import { getOrCreateMasterContainer } from "../views/elements/PersistedElement";

/** Whether `a` comes before `b` in the document, which is what is drawn under what for the app's containers. */
const isBefore = (a: Element, b: Element): boolean =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("where toasts are drawn, against a call", () => {
    let app: HTMLDivElement;

    beforeEach(() => {
        document.body.innerHTML = "";
        app = document.createElement("div");
        app.id = "matrixchat";
        document.body.appendChild(app);
    });

    afterEach(() => {
        ToastStore.sharedInstance().reset();
        document.body.innerHTML = "";
    });

    it("puts the persisted elements straight after the app, also when a dialog's container was there first", () => {
        const dialogs = document.createElement("div");
        dialogs.id = "mx_Dialog_Container";
        document.body.appendChild(dialogs);

        const persisted = getOrCreateMasterContainer();
        expect(app.nextElementSibling).toBe(persisted);
        // What is drawn later is on top: the dialogs are over the call
        expect(isBefore(persisted, dialogs)).toBe(true);
    });

    it("draws a toast outside the app, after the persisted elements and before dialogs and menus", () => {
        const dialogs = document.createElement("div");
        dialogs.id = "mx_Dialog_Container";
        document.body.appendChild(dialogs);
        const persisted = getOrCreateMasterContainer();

        render(<ToastContainer />, { container: app.appendChild(document.createElement("div")) });
        act(() => {
            ToastStore.sharedInstance().addOrReplaceToast({
                key: "t",
                title: "Incoming call",
                component: GenericToast,
                props: { description: "Mira Okafor", primaryLabel: "Accept", onPrimaryClick: () => {} },
                priority: 10,
            });
        });

        const toast = screen.getByRole("alert");
        const host = document.getElementById(TOAST_HOST_ID)!;
        expect(host).toContainElement(toast);
        // Not inside the app, whose whole stacking context is under a call
        expect(app).not.toContainElement(toast);
        expect(persisted.nextElementSibling).toBe(host);
        expect(isBefore(persisted, host)).toBe(true);
        expect(isBefore(host, dialogs)).toBe(true);
        expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument();
    });

    it("keeps the toasts' container after the persisted elements when that container is made later", () => {
        const host = getOrCreateToastHost();
        const persisted = getOrCreateMasterContainer();
        expect(getOrCreateToastHost()).toBe(host);
        expect(persisted.nextElementSibling).toBe(host);
    });
});
