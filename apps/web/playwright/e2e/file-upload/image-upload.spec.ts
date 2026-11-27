/*
Copyright 2024 New Vector Ltd.
Copyright 2024 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { test, expect } from "../../element-web-test";
import { getSampleFilePath } from "../../sample-files";

test.describe("Image Upload", () => {
    test.use({
        displayName: "Alice",
    });

    test.beforeEach(async ({ page, app, user }) => {
        await app.client.createRoom({ name: "My Pictures" });
        await app.viewRoomByName("My Pictures");

        // Wait until configuration is finished
        await expect(
            page
                .locator(".mx_GenericEventListSummary[data-layout='group'] .mx_GenericEventListSummary_summary")
                .getByText(`${user.displayName} created and configured the room.`),
        ).toBeVisible();
    });

    test("should show image preview when uploading an image", async ({ app }) => {
        await app.setComposerInputFiles("room", getSampleFilePath("riot.png"));

        // The picture waits in the composer's attachment tray, where it can be taken out again
        const tray = app.getComposer().getByRole("list", { name: "Attachments" });
        await expect(tray.getByRole("listitem")).toHaveCount(1);
        await expect(tray.getByText("riot.png")).toBeVisible();
        await expect(tray.getByRole("button", { name: "Remove attachment riot.png" })).toBeEnabled();
        await expect(app.getComposer().getByRole("button", { name: "Send message" })).toBeEnabled();
    });

    test("should allow upload via drag and drop", { tag: "@screenshot" }, async ({ page, app }) => {
        await app.composerDragAndUploadFiles("room", getSampleFilePath("riot.png"), "image/png");
        await app.timeline.scrollToBottom();
        const imgTile = page.locator(".mx_ImageBody").first();
        await expect(imgTile).toBeVisible();
    });
});
