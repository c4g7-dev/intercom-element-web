/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MatrixClient } from "matrix-js-sdk/src/matrix";
import { createTestClient, flushPromises } from "test-utils";

import ContentMessages, { type AttachmentOutcome } from "../../ContentMessages";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { RoomUpload } from "../../models/RoomUpload";
import { AttachmentTrayStore } from "../../intercom/attachments/AttachmentTrayStore";
import { AttachmentTrayViewModel } from "./AttachmentTrayViewModel";

const ROOM = "!lounge:example.org";

describe("AttachmentTrayViewModel", () => {
    let client: MatrixClient;
    let contentMessages: ContentMessages;
    let store: AttachmentTrayStore;
    let settle: ((outcome: AttachmentOutcome) => void)[];
    let startUpload: ((index: number) => RoomUpload) | undefined;

    beforeEach(() => {
        client = createTestClient();
        contentMessages = new ContentMessages();
        settle = [];
        vi.spyOn(contentMessages, "sendAttachments").mockImplementation(
            (files, roomId, relation, _reply, _client, _caption, onUpload) => {
                startUpload = (index) => {
                    const upload = new RoomUpload(roomId, files[index].name, relation, files[index].size);
                    onUpload?.(index, upload);
                    return upload;
                };
                return files.map((_file, i) => new Promise<AttachmentOutcome>((resolve) => (settle[i] = resolve)));
            },
        );
        let n = 0;
        vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:preview-${++n}`);
        vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
        store = new AttachmentTrayStore(() => contentMessages);
    });

    afterEach(() => {
        store.destroy();
        vi.restoreAllMocks();
    });

    it("shows the files of its tray with their names, sizes and previews", () => {
        store.add(ROOM, [
            new File([new Uint8Array(2048)], "cat.png", { type: "image/png" }),
            new File([new Uint8Array(10)], "notes.pdf", { type: "application/pdf" }),
        ]);
        store.add("!other:example.org", [new File(["x"], "elsewhere.txt")]);
        const vm = new AttachmentTrayViewModel({ trayKey: ROOM, store });

        expect(vm.getSnapshot().items).toEqual([
            {
                id: expect.any(String),
                name: "cat.png",
                size: "2 KB",
                kind: "image",
                thumbnailUrl: "blob:preview-1",
                status: "pending",
                progress: 0,
            },
            {
                id: expect.any(String),
                name: "notes.pdf",
                size: "10 B",
                kind: "file",
                thumbnailUrl: undefined,
                status: "pending",
                progress: 0,
            },
        ]);
        vm.dispose();
    });

    it("follows the tray: files added, their progress, and their leaving", async () => {
        const vm = new AttachmentTrayViewModel({ trayKey: ROOM, store });
        const listener = vi.fn();
        vm.subscribe(listener);
        expect(vm.getSnapshot().items).toEqual([]);

        store.add(ROOM, [new File([new Uint8Array(200)], "cat.png", { type: "image/png" })]);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(vm.getSnapshot().items.map((item) => item.status)).toEqual(["pending"]);

        store.send(ROOM, { roomId: ROOM, client });
        const upload = startUpload!(0);
        upload.onProgress({ loaded: 50, total: 200 });
        defaultDispatcher.dispatch({ action: Action.UploadProgress, upload }, true);
        expect(vm.getSnapshot().items[0]).toMatchObject({ status: "uploading", progress: 0.25 });

        settle[0]("sent");
        await flushPromises();
        expect(vm.getSnapshot().items).toEqual([]);
        vm.dispose();
    });

    it("removes a file and sends a failed one again", async () => {
        store.add(ROOM, [new File(["a"], "a.txt"), new File(["b"], "b.txt")]);
        const vm = new AttachmentTrayViewModel({ trayKey: ROOM, store });
        const [first, second] = vm.getSnapshot().items;

        vm.onRemove(first.id);
        expect(vm.getSnapshot().items.map((item) => item.name)).toEqual(["b.txt"]);

        store.send(ROOM, { roomId: ROOM, client });
        settle[0]("failed");
        await flushPromises();
        expect(vm.getSnapshot().items[0].status).toBe("failed");

        vm.onRetry(second.id);
        expect(contentMessages.sendAttachments).toHaveBeenCalledTimes(2);
        expect(vm.getSnapshot().items[0].status).toBe("uploading");
        vm.dispose();
    });

    it("stops following once it is disposed of", () => {
        const vm = new AttachmentTrayViewModel({ trayKey: ROOM, store });
        const listener = vi.fn();
        vm.subscribe(listener);
        vm.dispose();
        store.add(ROOM, [new File(["a"], "a.txt")]);
        expect(listener).not.toHaveBeenCalled();
    });
});
