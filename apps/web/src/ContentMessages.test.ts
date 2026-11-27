/*
Copyright 2026 Element Creations Ltd.
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import "vitest-canvas-mock";
import {
    type ISendEventResponse,
    type MatrixClient,
    MatrixError,
    RelationType,
    type UploadResponse,
} from "matrix-js-sdk/src/matrix";
import { type ImageInfo } from "matrix-js-sdk/src/types";
import encrypt, { type IEncryptedFile } from "matrix-encrypt-attachment";
import { createTestClient, flushPromises, mkEvent } from "test-utils";

import ContentMessages, { UploadCanceledError, isHidpiPng, uploadFile } from "./ContentMessages";
import { clearUploadedMediaCache, queryUploadedMediaCache } from "./utils/UploadedMediaCache";
import { doMaybeLocalRoomAction } from "./utils/local-room";
import { BlurhashEncoder } from "./BlurhashEncoder";
import Modal from "./Modal";
import ErrorDialog from "./components/views/dialogs/ErrorDialog";
import UploadConfirmDialog from "./components/views/dialogs/UploadConfirmDialog";
import UploadFailureDialog from "./components/views/dialogs/UploadFailureDialog";
import { type RoomUpload } from "./models/RoomUpload";
import { _t } from "./languageHandler";
import { PosthogAnalytics } from "./PosthogAnalytics";

vi.mock("matrix-encrypt-attachment", () => ({ default: { encryptAttachment: vi.fn().mockResolvedValue({}) } }));

vi.mock("./BlurhashEncoder", () => ({
    BlurhashEncoder: {
        instance: {
            getBlurhash: vi.fn(),
        },
    },
}));

vi.mock("./utils/local-room", () => ({
    doMaybeLocalRoomAction: vi.fn(),
}));

const createElement = document.createElement.bind(document);

vi.stubGlobal("OffscreenCanvas", undefined);

describe("ContentMessages", () => {
    const stickerUrl = "https://example.com/sticker";
    const roomId = "!room:example.com";
    const imageInfo = {} as unknown as ImageInfo;
    const text = "test sticker";
    let client: MatrixClient;
    let contentMessages: ContentMessages;
    let prom: Promise<ISendEventResponse>;

    beforeEach(() => {
        client = createTestClient();
        contentMessages = new ContentMessages();
        prom = Promise.resolve<ISendEventResponse>({ event_id: "$event_id" });
    });

    describe("sendStickerContentToRoom", () => {
        beforeEach(() => {
            vi.mocked(client.sendStickerMessage).mockReturnValue(prom);
            vi.mocked(doMaybeLocalRoomAction).mockImplementation(
                <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>, client?: MatrixClient) => {
                    return fn(roomId);
                },
            );
        });

        it("should forward the call to doMaybeLocalRoomAction", async () => {
            await contentMessages.sendStickerContentToRoom(stickerUrl, roomId, null, imageInfo, text, client);
            expect(client.sendStickerMessage).toHaveBeenCalledWith(roomId, null, stickerUrl, imageInfo, text);
        });
    });

    describe("sendContentToRoom", () => {
        const roomId = "!roomId:server";
        beforeEach(() => {
            Object.defineProperty(global.Image.prototype, "src", {
                // Define the property setter
                configurable: true,
                set(src) {
                    window.setTimeout(() => this.onload());
                },
            });
            Object.defineProperty(global.Image.prototype, "height", {
                configurable: true,
                get() {
                    return 600;
                },
            });
            Object.defineProperty(global.Image.prototype, "width", {
                configurable: true,
                get() {
                    return 800;
                },
            });
            vi.mocked(doMaybeLocalRoomAction).mockImplementation(
                <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>) => fn(roomId),
            );
            vi.mocked(BlurhashEncoder.instance.getBlurhash).mockResolvedValue("blurhashstring");
        });

        it("should use m.image for image files", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "image/jpeg" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.image",
                }),
            );
        });

        it("should use m.image for PNG files which cannot be parsed but successfully thumbnail", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "image/png" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.image",
                }),
            );
        });

        it("should fall back to m.file for invalid image files", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "image/jpeg" });
            vi.mocked(BlurhashEncoder.instance.getBlurhash).mockRejectedValue("NOT_AN_IMAGE");
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.file",
                }),
            );
        });

        it("should use m.video for video files", async () => {
            vi.spyOn(document, "createElement").mockImplementation((tagName) => {
                const element = createElement(tagName);
                if (tagName === "video") {
                    (<HTMLVideoElement>element).load = vi.fn();
                    (<HTMLVideoElement>element).play = () => element.onloadeddata!(new Event("loadeddata"));
                    (<HTMLVideoElement>element).pause = vi.fn();
                    Object.defineProperty(element, "videoHeight", {
                        get() {
                            return 600;
                        },
                    });
                    Object.defineProperty(element, "videoWidth", {
                        get() {
                            return 800;
                        },
                    });
                    Object.defineProperty(element, "duration", {
                        get() {
                            return 123;
                        },
                    });
                }
                return element;
            });

            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "video/mp4" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.video",
                    info: expect.objectContaining({
                        duration: 123000,
                    }),
                }),
            );
        });

        it("should use m.audio for audio files", async () => {
            vi.spyOn(document, "createElement").mockImplementation((tagName) => {
                const element = createElement(tagName);
                if (tagName === "audio") {
                    Object.defineProperty(element, "duration", {
                        get() {
                            return 621;
                        },
                    });
                    Object.defineProperty(element, "src", {
                        set() {
                            element.onloadedmetadata!(new Event("loadedmetadata"));
                        },
                    });
                }
                return element;
            });

            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "audio/mp3" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.audio",
                    info: expect.objectContaining({
                        duration: 621000,
                    }),
                }),
            );
        });

        it("should fall back to m.file for invalid audio files", async () => {
            vi.spyOn(document, "createElement").mockImplementation((tagName) => {
                const element = createElement(tagName);
                if (tagName === "audio") {
                    Object.defineProperty(element, "src", {
                        set() {
                            element.onerror!("fail");
                        },
                    });
                }
                return element;
            });
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "audio/mp3" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.file",
                }),
            );
        });

        it("should default to name 'Attachment' if file doesn't have a name", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "", { type: "text/plain" });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    url: "mxc://server/file",
                    msgtype: "m.file",
                    body: "Attachment",
                }),
            );
        });

        it("should keep RoomUpload's total and loaded values up to date", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "", { type: "text/plain" });
            const prom = contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            const [upload] = contentMessages.getCurrentUploads();

            expect(upload.loaded).toBe(0);
            expect(upload.total).toBe(file.size);
            await flushPromises();
            const { progressHandler } = vi.mocked(client.uploadContent).mock.calls[0][1]!;
            progressHandler!({ loaded: 123, total: 1234 });
            expect(upload.loaded).toBe(123);
            expect(upload.total).toBe(1234);
            await prom;
        });

        it("properly handles replies", async () => {
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            const file = new File([], "fileName", { type: "image/jpeg" });
            const replyToEvent = mkEvent({
                type: "m.room.message",
                user: "@bob:test",
                room: roomId,
                content: {},
                event: true,
            });
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, replyToEvent);
            expect(client.sendMessage).toHaveBeenCalledWith(
                roomId,
                null,
                expect.objectContaining({
                    "url": "mxc://server/file",
                    "msgtype": "m.image",
                    "m.mentions": {
                        user_ids: ["@bob:test"],
                    },
                }),
            );
        });

        it("handles 413 error", async () => {
            vi.mocked(client.uploadContent).mockRejectedValue(
                new MatrixError(
                    {
                        errcode: "M_TOO_LARGE",
                        error: "File size limit exceeded",
                    },
                    413,
                ),
            );
            const file = new File([], "fileName", { type: "image/jpeg" });
            const dialogSpy = vi.spyOn(Modal, "createDialog");
            await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
            expect(dialogSpy).toHaveBeenCalledWith(
                ErrorDialog,
                expect.objectContaining({
                    description: _t("upload_failed_size", { fileName: "fileName" }),
                }),
            );
            dialogSpy.mockRestore();
        });
    });

    describe("getCurrentUploads", () => {
        const file1 = new File([], "file1");
        const file2 = new File([], "file2");
        const roomId = "!roomId:server";

        beforeEach(() => {
            vi.mocked(doMaybeLocalRoomAction).mockImplementation(
                <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>) => fn(roomId),
            );
        });

        it("should return only uploads for the given relation", async () => {
            const relation = {
                rel_type: RelationType.Thread,
                event_id: "!threadId:server",
            };
            const p1 = contentMessages.sendContentToRoom(file1, roomId, relation, client, undefined);
            const p2 = contentMessages.sendContentToRoom(file2, roomId, undefined, client, undefined);

            const uploads = contentMessages.getCurrentUploads(relation);
            expect(uploads).toHaveLength(1);
            expect(uploads[0].relation).toEqual(relation);
            expect(uploads[0].fileName).toEqual("file1");
            await Promise.all([p1, p2]);
        });

        it("should return only uploads for no relation when not passed one", async () => {
            const relation = {
                rel_type: RelationType.Thread,
                event_id: "!threadId:server",
            };
            const p1 = contentMessages.sendContentToRoom(file1, roomId, relation, client, undefined);
            const p2 = contentMessages.sendContentToRoom(file2, roomId, undefined, client, undefined);

            const uploads = contentMessages.getCurrentUploads();
            expect(uploads).toHaveLength(1);
            expect(uploads[0].relation).toEqual(undefined);
            expect(uploads[0].fileName).toEqual("file2");
            await Promise.all([p1, p2]);
        });
    });

    describe("cancelUpload", () => {
        it("should cancel in-flight upload", async () => {
            const deferred = Promise.withResolvers<UploadResponse>();
            vi.mocked(client.uploadContent).mockReturnValue(deferred.promise);
            const file1 = new File([], "file1");
            const prom = contentMessages.sendContentToRoom(file1, roomId, undefined, client, undefined);
            await flushPromises();
            const { abortController } = vi.mocked(client.uploadContent).mock.calls[0][1]!;
            expect(abortController!.signal.aborted).toBeFalsy();
            const [upload] = contentMessages.getCurrentUploads();
            contentMessages.cancelUpload(upload);
            expect(abortController!.signal.aborted).toBeTruthy();
            deferred.resolve({} as UploadResponse);
            await prom;
        });
    });
});

describe("uploadFile", () => {
    let client: MatrixClient;

    beforeEach(() => {
        vi.clearAllMocks();
        client = createTestClient();
    });

    it("should not encrypt the file if the room isn't encrypted", async () => {
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
        const progressHandler = vi.fn();
        const file = new Blob([]);

        const res = await uploadFile(client, "!roomId:server", file, progressHandler);

        expect(res.url).toBe("mxc://server/file");
        expect(res.file).toBeFalsy();
        expect(encrypt.encryptAttachment).not.toHaveBeenCalled();
        expect(client.uploadContent).toHaveBeenCalledWith(file, expect.objectContaining({ progressHandler }));
    });

    it("should encrypt the file if the room is encrypted", async () => {
        vi.spyOn(client.getCrypto()!, "isEncryptionEnabledInRoom").mockResolvedValue(true);
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
        vi.mocked(encrypt.encryptAttachment).mockResolvedValue({
            data: new ArrayBuffer(123),
            info: {} as IEncryptedFile,
        });
        const progressHandler = vi.fn();
        const file = new Blob(["123"]);

        const res = await uploadFile(client, "!roomId:server", file, progressHandler);

        expect(res.url).toBeFalsy();
        expect(res.file).toEqual(
            expect.objectContaining({
                url: "mxc://server/file",
            }),
        );
        expect(encrypt.encryptAttachment).toHaveBeenCalled();
        expect(client.uploadContent).toHaveBeenCalledWith(
            expect.any(Blob),
            expect.objectContaining({
                progressHandler,
                includeFilename: false,
                type: "application/octet-stream",
            }),
        );
        expect(vi.mocked(client.uploadContent).mock.calls[0][0]).not.toBe(file);
    });

    it("should keep the uploaded file so it does not have to be downloaded again", async () => {
        clearUploadedMediaCache();
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/plain" });
        const file = new Blob(["hello"]);

        await uploadFile(client, "!roomId:server", file);

        expect(queryUploadedMediaCache("mxc://server/plain")).toBe(file);
    });

    it("should keep the plaintext of an encrypted upload rather than the ciphertext", async () => {
        clearUploadedMediaCache();
        vi.spyOn(client.getCrypto()!, "isEncryptionEnabledInRoom").mockResolvedValue(true);
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/encrypted" });
        vi.mocked(encrypt.encryptAttachment).mockResolvedValue({
            data: new ArrayBuffer(123),
            info: {} as IEncryptedFile,
        });
        const file = new Blob(["hello"]);

        await uploadFile(client, "!roomId:server", file);

        expect(queryUploadedMediaCache("mxc://server/encrypted")).toBe(file);
    });

    it("should throw UploadCanceledError upon aborting the upload", async () => {
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://foo/bar" });
        const file = new Blob([]);
        const controller = new AbortController();
        controller.abort();

        await expect(uploadFile(client, "!roomId:server", file, undefined, controller)).rejects.toThrow(
            UploadCanceledError,
        );
    });
});

describe("sendContentListToRoom analytics", () => {
    const roomId = "!roomId:server";
    let client: MatrixClient;
    let contentMessages: ContentMessages;
    let trackEvent: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        client = createTestClient();
        vi.mocked(client.getMediaConfig).mockResolvedValue({});
        vi.mocked(doMaybeLocalRoomAction).mockImplementation(
            <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>) => fn(roomId),
        );
        contentMessages = new ContentMessages();
        vi.spyOn(contentMessages, "sendContentToRoom").mockResolvedValue("sent");
        trackEvent = vi.spyOn(PosthogAnalytics.instance, "trackEvent").mockImplementation(() => {});
        // Automatically continue through the per-file confirmation dialog.
        vi.spyOn(Modal, "createDialog").mockImplementation((component: unknown, ...rest: any[]) => {
            if (component === UploadConfirmDialog) {
                return { finished: Promise.resolve([true, false]) } as any;
            }
            // Any other dialog (e.g. the fetching-media-config spinner) never resolves on its own.
            return { finished: new Promise(() => {}), close: vi.fn() } as any;
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function mkFile(type: string, name = "file"): File {
        return new File(["content"], name, { type });
    }

    it("tracks AttachmentSend with the most common file type when files are sent", async () => {
        const files = [mkFile("image/png", "a.png"), mkFile("image/jpeg", "b.jpg"), mkFile("video/mp4", "c.mp4")];
        await contentMessages.sendContentListToRoom(files, roomId, undefined, undefined, client);

        expect(trackEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                eventName: "AttachmentSend",
                count: 3,
                kind: "local",
                type: "image",
            }),
        );
    });

    it("marks the attachment as a reply and in-thread when applicable", async () => {
        const replyToEvent = { getId: () => "$event" } as any;
        const relation = { rel_type: "m.thread" } as any;
        await contentMessages.sendContentListToRoom([mkFile("text/plain")], roomId, relation, replyToEvent, client);

        expect(trackEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                eventName: "AttachmentSend",
                isReply: true,
                inThread: true,
            }),
        );
    });

    it("tracks AttachmentCancel when the user cancels at the confirmation dialog", async () => {
        vi.spyOn(Modal, "createDialog").mockImplementation((component: unknown) => {
            if (component === UploadConfirmDialog) {
                return { finished: Promise.resolve([false, false]) } as any;
            }
            return { finished: new Promise(() => {}), close: vi.fn() } as any;
        });

        await contentMessages.sendContentListToRoom([mkFile("text/plain")], roomId, undefined, undefined, client);

        expect(trackEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                eventName: "AttachmentCancel",
                kind: "local",
                stage: "Confirmation",
            }),
        );
        expect(contentMessages.sendContentToRoom).not.toHaveBeenCalled();
    });
});

describe("isHidpiPng", () => {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const chunk = (type: string, data: number[]): number[] => [
        (data.length >>> 24) & 0xff,
        (data.length >>> 16) & 0xff,
        (data.length >>> 8) & 0xff,
        data.length & 0xff,
        ...[...type].map((c) => c.charCodeAt(0)),
        ...data,
        0,
        0,
        0,
        0, // CRC, which is not looked at
    ];
    const png = (...chunks: number[][]): Blob => new Blob([new Uint8Array([...signature, ...chunks.flat()])]);
    const ihdr = chunk("IHDR", new Array(13).fill(0));
    const hidpi = [0x00, 0x00, 0x16, 0x25, 0x00, 0x00, 0x16, 0x25, 0x01];

    it("finds the hi-dpi pHYs chunk of a macOS screenshot", async () => {
        await expect(isHidpiPng(png(ihdr, chunk("pHYs", hidpi), chunk("IDAT", [1, 2, 3])))).resolves.toBe(true);
    });

    it("finds it behind a colour profile larger than what is read at once", async () => {
        const profile = chunk("iCCP", new Array(200_000).fill(7));
        await expect(isHidpiPng(png(ihdr, profile, chunk("pHYs", hidpi), chunk("IDAT", [1])))).resolves.toBe(true);
    });

    it("says no for another density, for no pHYs and for what is not a PNG", async () => {
        const other = [0x00, 0x00, 0x0b, 0x13, 0x00, 0x00, 0x0b, 0x13, 0x01];
        await expect(isHidpiPng(png(ihdr, chunk("pHYs", other), chunk("IDAT", [1])))).resolves.toBe(false);
        await expect(isHidpiPng(png(ihdr, chunk("IDAT", [1]), chunk("pHYs", hidpi)))).resolves.toBe(false);
        await expect(isHidpiPng(new Blob(["not a png at all, just text"]))).resolves.toBe(false);
        await expect(isHidpiPng(new Blob([]))).resolves.toBe(false);
    });
});

describe("InterCom upload pipeline", () => {
    const roomId = "!roomId:server";
    let client: MatrixClient;
    let contentMessages: ContentMessages;

    beforeEach(() => {
        client = createTestClient();
        contentMessages = new ContentMessages();
        vi.mocked(doMaybeLocalRoomAction).mockImplementation(
            <T>(roomId: string, fn: (actualRoomId: string) => Promise<T>) => fn(roomId),
        );
        vi.mocked(client.sendMessage).mockResolvedValue({ event_id: "$event" });
        vi.mocked(BlurhashEncoder.instance.getBlurhash).mockResolvedValue("blurhashstring");
        Object.defineProperty(global.Image.prototype, "src", {
            configurable: true,
            set() {
                window.setTimeout(() => this.onload());
            },
        });
        Object.defineProperty(global.Image.prototype, "height", { configurable: true, get: () => 3000 });
        Object.defineProperty(global.Image.prototype, "width", { configurable: true, get: () => 4000 });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("starts uploading the file before its thumbnail is made", async () => {
        const order: string[] = [];
        vi.mocked(client.uploadContent).mockImplementation(async () => {
            order.push("upload");
            return { content_uri: "mxc://server/file" };
        });
        vi.mocked(BlurhashEncoder.instance.getBlurhash).mockImplementation(async () => {
            order.push("blurhash");
            return "blurhashstring";
        });
        const file = new File([new Uint8Array(200_000)], "photo.jpg", { type: "image/jpeg" });
        await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
        expect(order[0]).toBe("upload");
        expect(order).toContain("blurhash");
        expect(client.sendMessage).toHaveBeenCalledWith(
            roomId,
            null,
            expect.objectContaining({ msgtype: "m.image", url: "mxc://server/file" }),
        );
    });

    it("makes the blurhash from a small copy of the thumbnail", async () => {
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
        const file = new File([new Uint8Array(200_000)], "photo.jpg", { type: "image/jpeg" });
        await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
        const imageData = vi.mocked(BlurhashEncoder.instance.getBlurhash).mock.calls[0][0];
        expect(Math.max(imageData.width, imageData.height)).toBeLessThanOrEqual(64);
        expect(client.sendMessage).toHaveBeenCalledWith(
            roomId,
            null,
            expect.objectContaining({
                info: expect.objectContaining({ "w": 4000, "h": 3000, "xyz.amorgan.blurhash": "blurhashstring" }),
            }),
        );
    });

    it("writes where the time went to the diagnostics log, without the file name", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
        const file = new File([new Uint8Array(1000)], "secret-name.zip", { type: "application/zip" });
        await contentMessages.sendContentToRoom(file, roomId, undefined, client, undefined);
        const records = log.mock.calls
            .map(([line]) => String(line))
            .filter((line) => line.startsWith("[intercom-diag] "))
            .map((line) => JSON.parse(line.slice("[intercom-diag] ".length)));
        expect(records.every((r) => r.type === "upload_phase")).toBe(true);
        expect(records.map((r) => r.phase)).toEqual(expect.arrayContaining(["http", "send_event", "total"]));
        const total = records.find((r) => r.phase === "total");
        expect(total).toMatchObject({ outcome: "sent", bytes: 1000, mime: "application/zip", kind: "m.file" });
        expect(JSON.stringify(records)).not.toContain("secret-name");
    });

    const pictures = (...names: string[]): File[] =>
        names.map((name) => new File([new Uint8Array(10)], name, { type: "image/jpeg" }));
    const sentContents = (): Record<string, any>[] =>
        vi.mocked(client.sendMessage).mock.calls.map((call) => call[2] as unknown as Record<string, any>);

    describe("sendAttachments", () => {
        beforeEach(() => {
            vi.spyOn(Modal, "createDialog");
            vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
            vi.spyOn(PosthogAnalytics.instance, "trackEvent").mockImplementation(() => {});
        });

        it("sends several pictures as one batch, without asking, with the caption on the first", async () => {
            const outcomes = contentMessages.sendAttachments(
                pictures("a.jpg", "b.jpg", "c.jpg"),
                roomId,
                undefined,
                undefined,
                client,
                { body: "our trip" },
            );
            await expect(Promise.all(outcomes)).resolves.toEqual(["sent", "sent", "sent"]);

            expect(Modal.createDialog).not.toHaveBeenCalled();
            const contents = sentContents();
            expect(contents.map((c) => c.body)).toEqual(["our trip", "b.jpg", "c.jpg"]);
            expect(contents[0].filename).toBe("a.jpg");
            expect(contents[1].filename).toBeUndefined();
            // The three are marked as one batch, in the order they were chosen
            const marks = contents.map((c) => c["io.intercom.gallery"] as { id: string; index: number; count: number });
            expect(marks.map((m) => [m.index, m.count])).toEqual([
                [0, 3],
                [1, 3],
                [2, 3],
            ]);
            expect(typeof marks[0].id).toBe("string");
            expect(new Set(marks.map((m) => m.id)).size).toBe(1);
            expect(PosthogAnalytics.instance.trackEvent).toHaveBeenCalledWith(
                expect.objectContaining({ eventName: "AttachmentSend", count: 3, type: "image" }),
            );
        });

        it("keeps the formatting and the mentions of a caption", async () => {
            const [outcome] = contentMessages.sendAttachments(pictures("a.jpg"), roomId, undefined, undefined, client, {
                "body": "look, @bob",
                "format": "org.matrix.custom.html",
                "formatted_body": "<b>look</b>, @bob",
                "m.mentions": { user_ids: ["@bob:example.org"] },
            });
            await outcome;

            const [content] = sentContents();
            expect(content).toMatchObject({
                "msgtype": "m.image",
                "body": "look, @bob",
                "filename": "a.jpg",
                "format": "org.matrix.custom.html",
                "formatted_body": "<b>look</b>, @bob",
                "m.mentions": { user_ids: ["@bob:example.org"] },
            });
            // One picture is no gallery
            expect(content["io.intercom.gallery"]).toBeUndefined();
        });

        it("does not mark files that are not all pictures as a batch", async () => {
            const files = [...pictures("a.jpg"), new File(["text"], "notes.txt", { type: "text/plain" })];
            await Promise.all(contentMessages.sendAttachments(files, roomId, undefined, undefined, client));

            const contents = sentContents();
            expect(contents.map((c) => c.msgtype)).toEqual(["m.image", "m.file"]);
            expect(contents.map((c) => c.body)).toEqual(["a.jpg", "notes.txt"]);
            expect(contents.some((c) => "io.intercom.gallery" in c)).toBe(false);
        });

        it("hands out the upload of each file", async () => {
            const uploads: [number, RoomUpload][] = [];
            await Promise.all(
                contentMessages.sendAttachments(
                    pictures("a.jpg", "b.jpg"),
                    roomId,
                    undefined,
                    undefined,
                    client,
                    undefined,
                    (index, upload) => uploads.push([index, upload]),
                ),
            );
            expect(uploads.map(([index, upload]) => [index, upload.fileName])).toEqual([
                [0, "a.jpg"],
                [1, "b.jpg"],
            ]);
        });

        it("says which file failed to upload and which could not be sent", async () => {
            vi.mocked(Modal.createDialog).mockReturnValue({ finished: new Promise(() => {}), close: vi.fn() } as any);
            // Not an error of the connection: those are tried once more
            vi.mocked(client.uploadContent).mockRejectedValueOnce(new MatrixError({ errcode: "M_FORBIDDEN" }, 403));
            const file = new File(["text"], "notes.txt", { type: "text/plain" });
            await expect(
                contentMessages.sendAttachments([file], roomId, undefined, undefined, client)[0],
            ).resolves.toBe("failed");
            expect(client.sendMessage).not.toHaveBeenCalled();

            vi.mocked(client.sendMessage).mockRejectedValueOnce(new Error("no connection"));
            await expect(
                contentMessages.sendAttachments([file], roomId, undefined, undefined, client)[0],
            ).resolves.toBe("not_sent");
        });
    });

    describe("filterUploadable", () => {
        it("refuses files over the homeserver's limit with the upload failure dialog", async () => {
            vi.mocked(client.getMediaConfig).mockResolvedValue({ "m.upload.size": 100 });
            const small = new File([new Uint8Array(10)], "small.bin");
            const large = new File([new Uint8Array(1000)], "large.bin");
            vi.spyOn(Modal, "createDialog").mockImplementation(((component: unknown) => ({
                // "Upload the others" in the dialog; the spinner stays until it is closed
                finished: component === UploadFailureDialog ? Promise.resolve([true]) : new Promise(() => {}),
                close: vi.fn(),
            })) as unknown as typeof Modal.createDialog);

            await expect(contentMessages.filterUploadable([small, large], client)).resolves.toEqual([small]);
            expect(Modal.createDialog).toHaveBeenCalledWith(
                UploadFailureDialog,
                expect.objectContaining({ badFiles: [large], totalFiles: 2 }),
            );
        });

        it("gives back nothing when the dialog is cancelled, and everything when there is no limit", async () => {
            vi.mocked(client.getMediaConfig).mockResolvedValue({ "m.upload.size": 100 });
            const small = new File([new Uint8Array(10)], "small.bin");
            const large = new File([new Uint8Array(1000)], "large.bin");
            vi.spyOn(Modal, "createDialog").mockImplementation(((component: unknown) => ({
                finished: component === UploadFailureDialog ? Promise.resolve([false]) : new Promise(() => {}),
                close: vi.fn(),
            })) as unknown as typeof Modal.createDialog);
            await expect(contentMessages.filterUploadable([small, large], client)).resolves.toEqual([]);

            const unlimited = new ContentMessages();
            vi.mocked(client.getMediaConfig).mockResolvedValue({});
            await expect(unlimited.filterUploadable([small, large], client)).resolves.toEqual([small, large]);
        });
    });

    it("asks about each picture when they do not come from the composer's tray", async () => {
        vi.spyOn(Modal, "createDialog").mockImplementation(((component: unknown) => ({
            // "Upload all" in the first dialog; the spinner stays until it is closed
            finished: component === UploadConfirmDialog ? Promise.resolve([true, true]) : new Promise(() => {}),
            close: vi.fn(),
        })) as unknown as typeof Modal.createDialog);
        vi.mocked(client.getMediaConfig).mockResolvedValue({});
        vi.mocked(client.uploadContent).mockResolvedValue({ content_uri: "mxc://server/file" });
        vi.spyOn(PosthogAnalytics.instance, "trackEvent").mockImplementation(() => {});

        await contentMessages.sendContentListToRoom(pictures("a.jpg", "b.jpg"), roomId, undefined, undefined, client);
        await vi.waitFor(() => expect(client.sendMessage).toHaveBeenCalledTimes(2));

        expect(vi.mocked(Modal.createDialog).mock.calls.filter(([c]) => c === UploadConfirmDialog)).toHaveLength(1);
        expect(sentContents().some((c) => "io.intercom.gallery" in c)).toBe(false);
    });
});
