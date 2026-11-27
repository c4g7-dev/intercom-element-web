/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type IEventRelation, type MatrixClient, MsgType, THREAD_RELATION_TYPE } from "matrix-js-sdk/src/matrix";
import { type RoomMessageEventContent } from "matrix-js-sdk/src/types";
import { createTestClient, flushPromises } from "test-utils";

import ContentMessages, { type AttachmentCaption, type AttachmentOutcome } from "../../ContentMessages";
import Modal from "../../Modal";
import UploadFailureDialog from "../../components/views/dialogs/UploadFailureDialog";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { RoomUpload } from "../../models/RoomUpload";
import { TimelineRenderingType } from "../../contexts/RoomContext";
import { AttachmentTrayStore, attachmentTrayKey } from "./AttachmentTrayStore";

const ROOM = "!lounge:example.org";
const OTHER_ROOM = "!kitchen:example.org";
const THREAD: IEventRelation = { rel_type: THREAD_RELATION_TYPE.name, event_id: "$root" };

const picture = (name: string, bytes = 10): File => new File([new Uint8Array(bytes)], name, { type: "image/png" });
const video = (name: string): File => new File([new Uint8Array(10)], name, { type: "video/mp4" });
const doc = (name: string, bytes = 10): File => new File([new Uint8Array(bytes)], name, { type: "application/pdf" });
const text = (body: string, extra: Partial<RoomMessageEventContent> = {}): RoomMessageEventContent =>
    ({ msgtype: MsgType.Text, body, ...extra }) as RoomMessageEventContent;

/** One call of ContentMessages.sendAttachments, with the means to say how each file fared. */
interface SentBatch {
    files: File[];
    roomId: string;
    relation?: IEventRelation;
    caption?: AttachmentCaption;
    /** Begins the upload of the file at `index` and gives it back */
    start(index: number): RoomUpload;
    /** Ends the file at `index` */
    settle(index: number, outcome: AttachmentOutcome): void;
}

describe("AttachmentTrayStore", () => {
    let client: MatrixClient;
    let contentMessages: ContentMessages;
    let store: AttachmentTrayStore;
    let batches: SentBatch[];
    let urls: string[];
    let revoked: string[];

    beforeEach(() => {
        client = createTestClient();
        vi.mocked(client.getMediaConfig).mockResolvedValue({ "m.upload.size": 1000 });
        contentMessages = new ContentMessages();
        batches = [];
        vi.spyOn(contentMessages, "sendAttachments").mockImplementation(
            (files, roomId, relation, _replyToEvent, _client, caption, onUpload) => {
                const resolvers: ((outcome: AttachmentOutcome) => void)[] = [];
                const outcomes = files.map(
                    (_file, i) => new Promise<AttachmentOutcome>((resolve) => (resolvers[i] = resolve)),
                );
                batches.push({
                    files,
                    roomId,
                    relation,
                    caption,
                    start: (index) => {
                        const upload = new RoomUpload(roomId, files[index].name, relation, files[index].size);
                        onUpload?.(index, upload);
                        return upload;
                    },
                    settle: (index, outcome) => resolvers[index](outcome),
                });
                return outcomes;
            },
        );
        vi.spyOn(contentMessages, "cancelUpload");

        urls = [];
        revoked = [];
        vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
            const url = `blob:preview-${urls.length + 1}`;
            urls.push(url);
            return url;
        });
        vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => void revoked.push(url));

        store = new AttachmentTrayStore(() => contentMessages);
    });

    afterEach(() => {
        store.destroy();
        vi.restoreAllMocks();
    });

    const names = (key: string): string[] => store.getAttachments(key).map((attachment) => attachment.file.name);
    const statuses = (key: string): string[] => store.getAttachments(key).map((attachment) => attachment.status);
    const send = (key: string, message?: RoomMessageEventContent, relation?: IEventRelation) =>
        store.send(key, { roomId: ROOM, relation, client, text: message });

    describe("keys", () => {
        it("has one tray per room and one per thread", () => {
            expect(attachmentTrayKey(ROOM)).toBe(ROOM);
            expect(attachmentTrayKey(ROOM, THREAD)).not.toBe(attachmentTrayKey(ROOM));
            expect(attachmentTrayKey(ROOM, { ...THREAD, event_id: "$other" })).not.toBe(
                attachmentTrayKey(ROOM, THREAD),
            );
            expect(attachmentTrayKey(OTHER_ROOM, THREAD)).not.toBe(attachmentTrayKey(ROOM, THREAD));
            // A relation that is no thread is the room's own composer
            expect(attachmentTrayKey(ROOM, { key: "foo" })).toBe(ROOM);
        });

        it("keeps the trays apart, and keeps them while another is looked at", () => {
            store.add(attachmentTrayKey(ROOM), [picture("room.png")]);
            store.add(attachmentTrayKey(ROOM, THREAD), [doc("thread.pdf")]);
            store.add(attachmentTrayKey(OTHER_ROOM), [picture("other.png"), doc("other.pdf")]);

            expect(names(ROOM)).toEqual(["room.png"]);
            expect(names(attachmentTrayKey(ROOM, THREAD))).toEqual(["thread.pdf"]);
            expect(names(OTHER_ROOM)).toEqual(["other.png", "other.pdf"]);

            store.clear(OTHER_ROOM);
            expect(names(OTHER_ROOM)).toEqual([]);
            expect(names(ROOM)).toEqual(["room.png"]);
        });
    });

    describe("adding and removing", () => {
        it("adds files in their order, with a preview for pictures and videos only", () => {
            store.add(ROOM, [picture("a.png"), doc("b.pdf")]);
            store.add(ROOM, [video("c.mp4")]);

            const attachments = store.getAttachments(ROOM);
            expect(attachments.map((a) => [a.file.name, a.kind, a.status, a.previewUrl])).toEqual([
                ["a.png", "image", "pending", "blob:preview-1"],
                ["b.pdf", "file", "pending", undefined],
                ["c.mp4", "video", "pending", "blob:preview-2"],
            ]);
            expect(new Set(attachments.map((a) => a.id)).size).toBe(3);
            expect(store.hasSendable(ROOM)).toBe(true);
            expect(store.hasSendable(OTHER_ROOM)).toBe(false);
        });

        it("tells who listens to a tray, and nobody else", () => {
            const listener = vi.fn();
            const other = vi.fn();
            const stop = store.subscribe(ROOM, listener);
            store.subscribe(OTHER_ROOM, other);

            store.add(ROOM, [picture("a.png")]);
            expect(listener).toHaveBeenCalledTimes(1);
            // Nothing added, nothing said
            store.add(ROOM, []);
            expect(listener).toHaveBeenCalledTimes(1);
            expect(other).not.toHaveBeenCalled();

            stop();
            store.add(ROOM, [picture("b.png")]);
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it("gives the same list until the tray changes", () => {
            expect(store.getAttachments(ROOM)).toBe(store.getAttachments(ROOM));
            store.add(ROOM, [picture("a.png")]);
            const before = store.getAttachments(ROOM);
            expect(store.getAttachments(ROOM)).toBe(before);
            store.add(ROOM, [picture("b.png")]);
            expect(store.getAttachments(ROOM)).not.toBe(before);
        });

        it("removes one file and lets go of its preview", () => {
            store.add(ROOM, [picture("a.png"), picture("b.png")]);
            const [first] = store.getAttachments(ROOM);

            store.remove(ROOM, first.id);
            expect(names(ROOM)).toEqual(["b.png"]);
            expect(revoked).toEqual(["blob:preview-1"]);

            store.remove(ROOM, "no-such-id");
            expect(names(ROOM)).toEqual(["b.png"]);
        });

        it("removes the last file, one at a time", () => {
            store.add(ROOM, [picture("a.png"), doc("b.pdf")]);
            expect(store.removeLast(ROOM)).toBe(true);
            expect(names(ROOM)).toEqual(["a.png"]);
            expect(store.removeLast(ROOM)).toBe(true);
            expect(store.removeLast(ROOM)).toBe(false);
            expect(store.hasSendable(ROOM)).toBe(false);
        });

        it("clears a tray, and says whether there was anything in it", () => {
            store.add(ROOM, [picture("a.png"), video("b.mp4"), doc("c.pdf")]);
            expect(store.clear(ROOM)).toBe(true);
            expect(names(ROOM)).toEqual([]);
            expect(revoked).toEqual(["blob:preview-1", "blob:preview-2"]);
            expect(store.clear(ROOM)).toBe(false);
        });

        it("forgets every tray when the session ends", () => {
            store.add(ROOM, [picture("a.png")]);
            store.add(OTHER_ROOM, [doc("b.pdf")]);
            defaultDispatcher.dispatch({ action: Action.OnLoggedOut }, true);
            expect(names(ROOM)).toEqual([]);
            expect(names(OTHER_ROOM)).toEqual([]);
            expect(revoked).toEqual(["blob:preview-1"]);
        });
    });

    describe("the homeserver's size limit", () => {
        beforeEach(() => {
            vi.spyOn(defaultDispatcher, "dispatch").mockImplementation(() => {});
        });

        it("refuses a file that is too large with the upload failure dialog and adds the others", async () => {
            const createDialog = vi.spyOn(Modal, "createDialog").mockImplementation(((component: unknown) => ({
                // The dialog's "upload the others"; the spinner of the limit's fetch stays until closed
                finished: component === UploadFailureDialog ? Promise.resolve([true]) : new Promise(() => {}),
                close: vi.fn(),
            })) as unknown as typeof Modal.createDialog);
            const large = doc("large.pdf", 5000);

            await expect(
                store.addFiles([picture("small.png"), large], ROOM, THREAD, client, TimelineRenderingType.Thread),
            ).resolves.toBe(1);

            expect(createDialog).toHaveBeenCalledWith(
                UploadFailureDialog,
                expect.objectContaining({ badFiles: [large], totalFiles: 2 }),
            );
            expect(names(attachmentTrayKey(ROOM, THREAD))).toEqual(["small.png"]);
            expect(names(ROOM)).toEqual([]);
            // The composer the files went to has the cursor
            expect(defaultDispatcher.dispatch).toHaveBeenCalledWith({
                action: Action.FocusSendMessageComposer,
                context: TimelineRenderingType.Thread,
            });
        });

        it("adds nothing when every file is too large", async () => {
            vi.spyOn(Modal, "createDialog").mockImplementation(((component: unknown) => ({
                finished: component === UploadFailureDialog ? Promise.resolve([false]) : new Promise(() => {}),
                close: vi.fn(),
            })) as unknown as typeof Modal.createDialog);

            await expect(store.addFiles([doc("large.pdf", 5000)], ROOM, undefined, client)).resolves.toBe(0);
            expect(names(ROOM)).toEqual([]);
            expect(defaultDispatcher.dispatch).not.toHaveBeenCalled();
        });

        it("adds files within the limit without a dialog", async () => {
            const createDialog = vi.spyOn(Modal, "createDialog").mockImplementation((() => ({
                finished: new Promise(() => {}),
                close: vi.fn(),
            })) as unknown as typeof Modal.createDialog);
            await expect(store.addFiles([picture("a.png"), doc("b.pdf")], ROOM, undefined, client)).resolves.toBe(2);
            expect(createDialog.mock.calls.some(([component]) => component === UploadFailureDialog)).toBe(false);
            expect(names(ROOM)).toEqual(["a.png", "b.pdf"]);
        });
    });

    describe("sending", () => {
        it("sends pictures as one batch with the text as their caption", () => {
            store.add(ROOM, [picture("a.png"), picture("b.png"), picture("c.png")]);
            const { textSent } = send(
                ROOM,
                text("our trip", {
                    "format": "org.matrix.custom.html",
                    "formatted_body": "<i>our trip</i>",
                    "m.mentions": { user_ids: ["@bob:example.org"] },
                }),
            );

            expect(textSent).toBe(true);
            expect(batches).toHaveLength(1);
            expect(batches[0].files.map((file) => file.name)).toEqual(["a.png", "b.png", "c.png"]);
            expect(batches[0].roomId).toBe(ROOM);
            expect(batches[0].caption).toEqual({
                "body": "our trip",
                "format": "org.matrix.custom.html",
                "formatted_body": "<i>our trip</i>",
                "m.mentions": { user_ids: ["@bob:example.org"] },
            });
        });

        it("sends one picture with the text as its caption", () => {
            store.add(ROOM, [picture("a.png")]);
            expect(send(ROOM, text("look")).textSent).toBe(true);
            expect(batches[0].caption?.body).toBe("look");
        });

        it("leaves the text to be sent after files that are no pictures", async () => {
            store.add(ROOM, [doc("a.pdf"), doc("b.pdf")]);
            const { textSent, finished } = send(ROOM, text("the papers"));

            expect(textSent).toBe(false);
            expect(batches[0].files.map((file) => file.name)).toEqual(["a.pdf", "b.pdf"]);
            expect(batches[0].caption).toBeUndefined();

            // The text waits for both files
            const done = vi.fn();
            void finished.then(done);
            batches[0].settle(0, "sent");
            await flushPromises();
            expect(done).not.toHaveBeenCalled();
            batches[0].settle(1, "sent");
            await flushPromises();
            expect(done).toHaveBeenCalled();
        });

        it("leaves the text to be sent after a mixed set, as for files", () => {
            store.add(ROOM, [picture("a.png"), doc("b.pdf"), video("c.mp4")]);
            expect(send(ROOM, text("all of it")).textSent).toBe(false);
            expect(batches).toHaveLength(1);
            expect(batches[0].files.map((file) => file.name)).toEqual(["a.png", "b.pdf", "c.mp4"]);
            expect(batches[0].caption).toBeUndefined();
        });

        it("does not make a caption of an emote, nor of blank text", () => {
            store.add(ROOM, [picture("a.png")]);
            expect(send(ROOM, { msgtype: MsgType.Emote, body: "waves" } as RoomMessageEventContent).textSent).toBe(
                false,
            );
            batches[0].settle(0, "sent");

            store.add(OTHER_ROOM, [picture("b.png")]);
            expect(send(OTHER_ROOM, text("   ")).textSent).toBe(false);
            expect(batches[1].caption).toBeUndefined();
        });

        it("sends files without any text", () => {
            store.add(ROOM, [picture("a.png"), picture("b.png")]);
            expect(send(ROOM).textSent).toBe(false);
            expect(batches[0].files).toHaveLength(2);
            expect(batches[0].caption).toBeUndefined();
        });

        it("sends with the thread of the composer", () => {
            const key = attachmentTrayKey(ROOM, THREAD);
            store.add(key, [picture("a.png")]);
            store.add(ROOM, [picture("room.png")]);
            send(key, undefined, THREAD);
            expect(batches[0].relation).toBe(THREAD);
            expect(batches[0].files.map((file) => file.name)).toEqual(["a.png"]);
            // The room's own tray is not touched
            expect(statuses(ROOM)).toEqual(["pending"]);
        });

        it("does nothing with an empty tray", async () => {
            const { textSent, finished } = send(ROOM, text("just text"));
            expect(textSent).toBe(false);
            await expect(finished).resolves.toBeUndefined();
            expect(batches).toHaveLength(0);
        });
    });

    describe("uploading", () => {
        it("keeps the files while they are uploaded and takes each out when it is sent", async () => {
            store.add(ROOM, [picture("a.png"), picture("b.png")]);
            const { finished } = send(ROOM);

            expect(statuses(ROOM)).toEqual(["uploading", "uploading"]);
            // What is on its way is not sent a second time
            expect(store.hasSendable(ROOM)).toBe(false);

            batches[0].settle(0, "sent");
            await flushPromises();
            expect(names(ROOM)).toEqual(["b.png"]);

            batches[0].settle(1, "sent");
            await finished;
            expect(names(ROOM)).toEqual([]);
            expect(revoked).toEqual(["blob:preview-1", "blob:preview-2"]);
        });

        it("follows the progress of each upload", () => {
            store.add(ROOM, [picture("a.png", 100), picture("b.png", 200)]);
            const listener = vi.fn();
            store.subscribe(ROOM, listener);
            send(ROOM);
            const first = batches[0].start(0);
            const second = batches[0].start(1);
            listener.mockClear();

            first.onProgress({ loaded: 40, total: 100 });
            defaultDispatcher.dispatch({ action: Action.UploadProgress, upload: first }, true);
            // An encrypted file is larger than the file it was made of
            second.onProgress({ loaded: 55, total: 220 });
            defaultDispatcher.dispatch({ action: Action.UploadProgress, upload: second }, true);

            expect(store.getAttachments(ROOM).map((a) => [a.loaded, a.total])).toEqual([
                [40, 100],
                [55, 220],
            ]);
            expect(listener).toHaveBeenCalledTimes(2);

            // The progress of an upload that is none of the tray's changes nothing
            listener.mockClear();
            defaultDispatcher.dispatch({ action: Action.UploadProgress, upload: new RoomUpload(ROOM, "x.png") }, true);
            expect(listener).not.toHaveBeenCalled();
        });

        it("keeps a file whose upload failed, and sends it again with the next message", async () => {
            store.add(ROOM, [picture("a.png"), doc("b.pdf")]);
            const { finished } = send(ROOM);
            batches[0].settle(0, "sent");
            batches[0].settle(1, "failed");
            await finished;

            expect(names(ROOM)).toEqual(["b.pdf"]);
            expect(statuses(ROOM)).toEqual(["failed"]);
            expect(store.hasSendable(ROOM)).toBe(true);

            store.add(ROOM, [picture("c.png")]);
            send(ROOM);
            expect(batches[1].files.map((file) => file.name)).toEqual(["b.pdf", "c.png"]);
            expect(statuses(ROOM)).toEqual(["uploading", "uploading"]);
        });

        it("sends a failed file again on its own when asked to", async () => {
            const key = attachmentTrayKey(ROOM, THREAD);
            store.add(key, [doc("a.pdf"), doc("b.pdf")]);
            const { finished } = send(key, text("the papers"), THREAD);
            batches[0].settle(0, "failed");
            batches[0].settle(1, "sent");
            await finished;
            const [failed] = store.getAttachments(key);

            store.retry(key, failed.id);
            expect(batches).toHaveLength(2);
            expect(batches[1].files.map((file) => file.name)).toEqual(["a.pdf"]);
            expect(batches[1].relation).toBe(THREAD);
            expect(batches[1].caption).toBeUndefined();
            expect(statuses(key)).toEqual(["uploading"]);

            // Only a failed file is sent again
            store.retry(key, failed.id);
            expect(batches).toHaveLength(2);

            batches[1].settle(0, "sent");
            await flushPromises();
            expect(names(key)).toEqual([]);
        });

        it("takes out a file that was cancelled, and one whose message is left unsent in the room", async () => {
            store.add(ROOM, [picture("a.png"), picture("b.png"), picture("c.png")]);
            const { finished } = send(ROOM);
            batches[0].settle(0, "cancelled");
            batches[0].settle(1, "not_sent");
            batches[0].settle(2, "failed");
            await finished;
            expect(names(ROOM)).toEqual(["c.png"]);
        });

        it("stops the upload of a file that is removed", async () => {
            store.add(ROOM, [picture("a.png"), picture("b.png")]);
            send(ROOM);
            const upload = batches[0].start(0);
            const [first, second] = store.getAttachments(ROOM);

            store.remove(ROOM, first.id);
            expect(contentMessages.cancelUpload).toHaveBeenCalledExactlyOnceWith(upload);
            expect(names(ROOM)).toEqual(["b.png"]);

            // Removed before its upload began: stopped as soon as it does
            store.remove(ROOM, second.id);
            const late = batches[0].start(1);
            expect(contentMessages.cancelUpload).toHaveBeenLastCalledWith(late);

            batches[0].settle(0, "cancelled");
            batches[0].settle(1, "cancelled");
            await flushPromises();
            expect(names(ROOM)).toEqual([]);
        });

        it("leaves files on their way alone when the tray is cleared, and takes new ones with the next message", () => {
            store.add(ROOM, [picture("a.png")]);
            send(ROOM);
            store.add(ROOM, [picture("b.png"), doc("c.pdf")]);
            expect(statuses(ROOM)).toEqual(["uploading", "pending", "pending"]);

            // Backspace takes the last waiting file, Escape the rest of them
            expect(store.removeLast(ROOM)).toBe(true);
            expect(names(ROOM)).toEqual(["a.png", "b.png"]);
            send(ROOM, text("one more"));
            expect(batches[1].files.map((file) => file.name)).toEqual(["b.png"]);

            store.add(ROOM, [doc("d.pdf")]);
            expect(store.clear(ROOM)).toBe(true);
            expect(names(ROOM)).toEqual(["a.png", "b.png"]);
            expect(store.clear(ROOM)).toBe(false);
            expect(contentMessages.cancelUpload).not.toHaveBeenCalled();
        });
    });
});
