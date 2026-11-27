/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    type IEventRelation,
    type MatrixClient,
    type MatrixEvent,
    MsgType,
    THREAD_RELATION_TYPE,
} from "matrix-js-sdk/src/matrix";
import { type RoomMessageEventContent } from "matrix-js-sdk/src/types";
import { logger } from "matrix-js-sdk/src/logger";

import ContentMessages, { type AttachmentCaption, type AttachmentOutcome } from "../../ContentMessages";
import defaultDispatcher from "../../dispatcher/dispatcher";
import { Action } from "../../dispatcher/actions";
import { type ActionPayload } from "../../dispatcher/payloads";
import { type UploadProgressPayload } from "../../dispatcher/payloads/UploadPayload";
import { type RoomUpload } from "../../models/RoomUpload";
import { TimelineRenderingType } from "../../contexts/RoomContext";

/** How a file is shown in the tray: with a thumbnail made of the file itself, or as a chip. */
export type TrayAttachmentKind = "image" | "video" | "file";

/**
 * Where a file of the tray stands:
 * - `pending`: waiting for the message to be sent
 * - `uploading`: on its way
 * - `failed`: its upload failed; it is sent again with the next message, or on its own
 */
export type TrayAttachmentStatus = "pending" | "uploading" | "failed";

/** One file waiting in a composer's attachment tray. */
export interface TrayAttachment {
    /** Unique within the session */
    readonly id: string;
    readonly file: File;
    readonly kind: TrayAttachmentKind;
    /** An object URL of the file, for pictures and videos; revoked when the file leaves the tray */
    readonly previewUrl?: string;
    readonly status: TrayAttachmentStatus;
    /** Bytes uploaded so far */
    readonly loaded: number;
    /** Bytes to upload: the file's size, until the upload says otherwise (an encrypted file is larger) */
    readonly total: number;
}

/** What the composer gives when it sends its tray. */
export interface TraySendOptions {
    roomId: string;
    /** The relation of the composer (a thread), sent with each file */
    relation?: IEventRelation;
    /** The event being replied to, if any */
    replyToEvent?: MatrixEvent;
    client: MatrixClient;
    /**
     * The message typed beside the files, already made into content. It is sent as the caption
     * when that is possible, see {@link AttachmentTrayStore.send}.
     */
    text?: RoomMessageEventContent;
}

/** What {@link AttachmentTrayStore.send} did with the text and when the files are done. */
export interface TraySendResult {
    /** Whether the text went with the files as their caption. If not, it is still to be sent. */
    textSent: boolean;
    /** Resolves when every file was sent, failed or was cancelled. Never rejects. */
    finished: Promise<void>;
}

/**
 * The key of the tray of a composer: the room, and the thread if the composer is that of a
 * thread. The room's own composer and the one of its timeline in the side panel share a tray.
 */
export function attachmentTrayKey(roomId: string, relation?: IEventRelation): string {
    if (relation?.rel_type === THREAD_RELATION_TYPE.name && relation.event_id) {
        return `${roomId}|${relation.event_id}`;
    }
    return roomId;
}

function kindOf(file: File): TrayAttachmentKind {
    if (file.type.startsWith("image/")) return "image";
    if (file.type.startsWith("video/")) return "video";
    return "file";
}

const NO_ATTACHMENTS: readonly TrayAttachment[] = Object.freeze([]);

/**
 * The files chosen in a composer (pasted, picked with its upload button or dropped on the room)
 * that wait there, above the text, to be sent with the next message.
 *
 * There is one tray per room and thread. Trays are kept while the session lasts, so that the
 * files are still there after a look at another room, and are not written anywhere.
 */
export class AttachmentTrayStore {
    private static internalInstance?: AttachmentTrayStore;

    public static get instance(): AttachmentTrayStore {
        AttachmentTrayStore.internalInstance ??= new AttachmentTrayStore();
        return AttachmentTrayStore.internalInstance;
    }

    private readonly trays = new Map<string, readonly TrayAttachment[]>();
    private readonly listeners = new Map<string, Set<() => void>>();
    /** The uploads on their way, and the file of the tray each of them is */
    private readonly uploads = new Map<RoomUpload, { key: string; id: string }>();
    /** What each tray was last sent with: a failed file is sent again with the same */
    private readonly lastSend = new Map<string, Omit<TraySendOptions, "text" | "replyToEvent">>();
    private nextId = 1;

    private readonly dispatcherRef: string;

    /**
     * @param contentMessages - Gives the ContentMessages the files are sent with; the shared one
     *     unless a test brings its own.
     */
    public constructor(private readonly contentMessages: () => ContentMessages = ContentMessages.sharedInstance) {
        this.dispatcherRef = defaultDispatcher.register(this.onAction);
    }

    /** Empties the store and ends its listening. The shared instance lives as long as the app. */
    public destroy(): void {
        this.reset();
        defaultDispatcher.unregister(this.dispatcherRef);
    }

    /** The files of a tray, in the order they are sent. The same array until the tray changes. */
    public getAttachments(key: string): readonly TrayAttachment[] {
        return this.trays.get(key) ?? NO_ATTACHMENTS;
    }

    /** Whether a tray has files that the next message takes with it. */
    public hasSendable(key: string): boolean {
        return this.getAttachments(key).some((attachment) => attachment.status !== "uploading");
    }

    /**
     * Calls `listener` whenever the tray of `key` changes.
     * @returns A function that ends this.
     */
    public subscribe(key: string, listener: () => void): () => void {
        let listeners = this.listeners.get(key);
        if (!listeners) {
            listeners = new Set();
            this.listeners.set(key, listeners);
        }
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0 && this.listeners.get(key) === listeners) this.listeners.delete(key);
        };
    }

    /** Puts files at the end of a tray, as they are: use {@link addFiles} for files not checked yet. */
    public add(key: string, files: File[]): void {
        if (!files.length) return;
        const added = files.map((file): TrayAttachment => {
            const kind = kindOf(file);
            return {
                id: `attachment-${this.nextId++}`,
                file,
                kind,
                previewUrl: kind === "file" ? undefined : URL.createObjectURL(file),
                status: "pending",
                loaded: 0,
                total: file.size,
            };
        });
        this.set(key, [...this.getAttachments(key), ...added]);
    }

    /**
     * Puts the files chosen in a composer into its tray. Files larger than the homeserver takes
     * are refused with the upload failure dialog, as they always were, and not added.
     * @param context - The timeline the composer belongs to; that composer is given the focus.
     * @returns How many files were added.
     */
    public async addFiles(
        files: File[],
        roomId: string,
        relation: IEventRelation | undefined,
        client: MatrixClient,
        context = TimelineRenderingType.Room,
    ): Promise<number> {
        const okFiles = await this.contentMessages().filterUploadable(files, client);
        this.add(attachmentTrayKey(roomId, relation), okFiles);
        if (okFiles.length) {
            // The files are sent with Enter, so that is where the cursor has to be
            defaultDispatcher.dispatch({ action: Action.FocusSendMessageComposer, context });
        }
        return okFiles.length;
    }

    /** Takes a file out of a tray. One that is being uploaded is stopped. */
    public remove(key: string, id: string): void {
        for (const [upload, target] of this.uploads) {
            if (target.key === key && target.id === id) {
                this.uploads.delete(upload);
                this.contentMessages().cancelUpload(upload);
            }
        }
        this.set(
            key,
            this.getAttachments(key).filter((attachment) => attachment.id !== id),
        );
    }

    /**
     * Takes the last file that is not on its way out of a tray.
     * @returns Whether there was one.
     */
    public removeLast(key: string): boolean {
        const attachments = this.getAttachments(key);
        for (let i = attachments.length - 1; i >= 0; i--) {
            if (attachments[i].status !== "uploading") {
                this.remove(key, attachments[i].id);
                return true;
            }
        }
        return false;
    }

    /**
     * Empties a tray of the files that wait in it. Files on their way stay: they belong to a
     * message that was sent already.
     * @returns Whether there was anything to take out.
     */
    public clear(key: string): boolean {
        const attachments = this.getAttachments(key);
        const kept = attachments.filter((attachment) => attachment.status === "uploading");
        if (kept.length === attachments.length) return false;
        this.set(key, kept);
        return true;
    }

    /**
     * Sends the files that wait in a tray, as one batch.
     *
     * Where the text typed beside them goes:
     * - Only pictures: the text is the caption of the first one, and the pictures are one gallery
     *   (one of them alone is a picture with a caption).
     * - Only other files: the files go first, and the caller sends the text as a message after them.
     * - Pictures and other files together: these are not marked as a gallery, just as they were
     *   not before the tray, so the text is sent the way it is for files: as a message after
     *   them. A caption would hang on whichever file happened to be first.
     * - Text that is not plain (an emote, a notice made by a command) is never a caption.
     *
     * The files stay in the tray while they are uploaded and leave it one by one as they are
     * sent. One whose upload failed stays, marked as failed.
     */
    public send(key: string, { text, replyToEvent, ...context }: TraySendOptions): TraySendResult {
        const ids = new Set(
            this.getAttachments(key)
                .filter((attachment) => attachment.status !== "uploading")
                .map((attachment) => attachment.id),
        );
        if (!ids.size) return { textSent: false, finished: Promise.resolve() };
        this.lastSend.set(key, context);

        const sending = this.getAttachments(key).filter((attachment) => ids.has(attachment.id));
        const allPictures = sending.every((attachment) => attachment.kind === "image");
        let caption: AttachmentCaption | undefined;
        if (text?.body.trim() && text.msgtype === MsgType.Text && allPictures) {
            caption = {
                "body": text.body,
                "format": "format" in text ? text.format : undefined,
                "formatted_body": "formatted_body" in text ? text.formatted_body : undefined,
                "m.mentions": text["m.mentions"],
            };
        }

        return {
            textSent: !!caption,
            finished: this.upload(key, sending, context, replyToEvent, caption),
        };
    }

    /**
     * Sends a file whose upload failed once more, on its own and with what it was sent with.
     */
    public retry(key: string, id: string): void {
        const context = this.lastSend.get(key);
        const attachment = this.getAttachments(key).find((candidate) => candidate.id === id);
        if (!context || attachment?.status !== "failed") return;
        void this.upload(key, [attachment], context);
    }

    /** Forgets every tray. For the end of a session, and for tests. */
    public reset(): void {
        const keys = [...this.trays.keys()];
        this.uploads.clear();
        this.lastSend.clear();
        for (const key of keys) this.set(key, []);
    }

    private upload(
        key: string,
        sending: readonly TrayAttachment[],
        { roomId, relation, client }: Omit<TraySendOptions, "text" | "replyToEvent">,
        replyToEvent?: MatrixEvent,
        caption?: AttachmentCaption,
    ): Promise<void> {
        for (const attachment of sending) {
            this.update(key, attachment.id, { status: "uploading", loaded: 0, total: attachment.file.size });
        }

        const outcomes = this.contentMessages().sendAttachments(
            sending.map((attachment) => attachment.file),
            roomId,
            relation,
            replyToEvent,
            client,
            caption,
            (index, upload) => {
                const { id } = sending[index];
                // Taken out of the tray before its upload began
                if (!this.getAttachments(key).some((attachment) => attachment.id === id)) {
                    this.contentMessages().cancelUpload(upload);
                    return;
                }
                this.uploads.set(upload, { key, id });
            },
        );

        return Promise.all(
            outcomes.map(async (outcome, index) => {
                let result: AttachmentOutcome;
                try {
                    result = await outcome;
                } catch (e) {
                    logger.warn("Failed to send an attachment of the tray", e);
                    result = "failed";
                }
                this.onOutcome(key, sending[index].id, result);
            }),
        ).then(() => undefined);
    }

    private onOutcome(key: string, id: string, outcome: AttachmentOutcome): void {
        for (const [upload, target] of this.uploads) {
            if (target.key === key && target.id === id) this.uploads.delete(upload);
        }
        if (outcome === "failed") {
            // ContentMessages said so in its "Upload Failed" dialog; here the file stays, to be
            // sent again or taken out
            this.update(key, id, { status: "failed", loaded: 0 });
        } else {
            // Sent, cancelled, or uploaded with its message left unsent in the room: in each
            // case the tray is done with it
            this.set(
                key,
                this.getAttachments(key).filter((attachment) => attachment.id !== id),
            );
        }
    }

    private onAction = (payload: ActionPayload): void => {
        if (payload.action === Action.UploadProgress) {
            const { upload } = payload as UploadProgressPayload;
            const target = this.uploads.get(upload);
            if (target) this.update(target.key, target.id, { loaded: upload.loaded, total: upload.total });
        } else if (payload.action === Action.OnLoggedOut) {
            this.reset();
        }
    };

    private update(
        key: string,
        id: string,
        change: Partial<Pick<TrayAttachment, "status" | "loaded" | "total">>,
    ): void {
        const attachments = this.getAttachments(key);
        const current = attachments.find((attachment) => attachment.id === id);
        if (!current) return;
        const next = { ...current, ...change };
        if (next.status === current.status && next.loaded === current.loaded && next.total === current.total) return;
        this.set(
            key,
            attachments.map((attachment) => (attachment === current ? next : attachment)),
        );
    }

    private set(key: string, attachments: readonly TrayAttachment[]): void {
        const before = this.getAttachments(key);
        if (before === attachments || (before.length === 0 && attachments.length === 0)) return;
        // What left the tray has no use for its preview any more
        for (const attachment of before) {
            if (attachment.previewUrl && !attachments.some((kept) => kept.id === attachment.id)) {
                URL.revokeObjectURL(attachment.previewUrl);
            }
        }
        if (attachments.length) {
            this.trays.set(key, attachments);
        } else {
            this.trays.delete(key);
            this.lastSend.delete(key);
        }
        this.listeners.get(key)?.forEach((listener) => listener());
    }
}
