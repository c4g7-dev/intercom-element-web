/*
 * Copyright 2024 New Vector Ltd.
 * Copyright 2024 The Matrix.org Foundation C.I.C.
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, fireEvent, waitFor } from "test-utils-rtl";
import fetchMock from "@fetch-mock/vitest";
import { MatrixEvent } from "matrix-js-sdk/src/matrix";
import { stubClient } from "test-utils";

import ImageView from "./ImageView";
import { FileDownloader } from "../../../utils/FileDownloader";
import Modal from "../../../Modal";
import ErrorDialog from "../dialogs/ErrorDialog";

vi.mock("../../../utils/FileDownloader");

describe("<ImageView />", () => {
    afterEach(() => {
        vi.resetAllMocks();
    });

    it("renders correctly", () => {
        const { container } = render(<ImageView src="https://example.com/image.png" onFinished={vi.fn()} />);
        expect(container).toMatchSnapshot();
    });

    it("steps through a gallery with its buttons and the arrow keys", () => {
        const onFinished = vi.fn();
        const onNext = vi.fn();
        const { getByRole, queryByRole } = render(
            <ImageView
                src="https://example.com/image.png"
                onFinished={onFinished}
                navigation={{ index: 1, total: 3, onNext }}
            />,
        );
        // The first of a gallery has nothing before it
        expect(queryByRole("button", { name: "Previous image" })).toBeNull();

        fireEvent.click(getByRole("button", { name: "Next image" }));
        expect(onFinished).toHaveBeenCalledTimes(1);
        expect(onNext).toHaveBeenCalledTimes(1);

        fireEvent.keyDown(getByRole("dialog"), { key: "ArrowRight" });
        expect(onNext).toHaveBeenCalledTimes(2);
        fireEvent.keyDown(getByRole("dialog"), { key: "ArrowLeft" });
        expect(onNext).toHaveBeenCalledTimes(2);
        expect(onFinished).toHaveBeenCalledTimes(2);
    });

    it("should download on click", async () => {
        fetchMock.get("https://example.com/image.png", "TESTFILE");
        const { getByRole } = render(
            <ImageView src="https://example.com/image.png" name="filename.png" onFinished={vi.fn()} />,
        );
        fireEvent.click(getByRole("button", { name: "Download" }));
        await waitFor(() =>
            expect(vi.mocked(FileDownloader).mock.instances[0].download).toHaveBeenCalledWith({
                blob: expect.anything(),
                name: "filename.png",
            }),
        );
        expect(fetchMock).toHaveFetched("https://example.com/image.png");
    });

    it("should use event as download source if given", async () => {
        stubClient();

        const event = new MatrixEvent({
            event_id: "$eventId",
            type: "m.image",
            content: {
                body: "fromEvent.png",
                url: "mxc://test.dummy/fromEvent.png",
                file_name: "filename.png",
            },
            origin_server_ts: new Date(2000, 0, 1, 0, 0, 0, 0).getTime(),
        });

        fetchMock.get("http://this.is.a.url/test.dummy/fromEvent.png", "TESTFILE");
        const { getByRole } = render(
            <ImageView src="https://test.dummy/fromSrc.png" name="fromName.png" onFinished={vi.fn()} mxEvent={event} />,
        );
        fireEvent.click(getByRole("button", { name: "Download" }));
        await waitFor(() =>
            expect(vi.mocked(FileDownloader).mock.instances[0].download).toHaveBeenCalledWith({
                blob: expect.anything(),
                name: "fromEvent.png",
            }),
        );
        expect(fetchMock).toHaveFetched("http://this.is.a.url/test.dummy/fromEvent.png");
    });

    it("should start download on Ctrl+S", async () => {
        fetchMock.get("https://example.com/image.png", "TESTFILE");

        const { container } = render(
            <ImageView src="https://example.com/image.png" name="filename.png" onFinished={vi.fn()} />,
        );

        const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
        dialog?.focus();

        fireEvent.keyDown(dialog!, { key: "s", code: "KeyS", ctrlKey: true });

        await waitFor(() => {
            expect(vi.mocked(FileDownloader).mock.instances[0].download).toHaveBeenCalledWith({
                blob: expect.anything(),
                name: "filename.png",
            });
        });

        expect(fetchMock).toHaveFetched("https://example.com/image.png");
    });

    it("should handle download errors", async () => {
        const modalSpy = vi.spyOn(Modal, "createDialog");
        fetchMock.get("https://example.com/image.png", { status: 500 });
        const { getByRole } = render(
            <ImageView src="https://example.com/image.png" name="filename.png" onFinished={vi.fn()} />,
        );
        fireEvent.click(getByRole("button", { name: "Download" }));
        await waitFor(() =>
            expect(modalSpy).toHaveBeenCalledWith(
                ErrorDialog,
                expect.objectContaining({
                    title: "Download failed",
                }),
            ),
        );
    });
});
