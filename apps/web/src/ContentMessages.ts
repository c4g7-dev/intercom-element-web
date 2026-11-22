/*
Copyright 2024 New Vector Ltd.
Copyright 2020 The Matrix.org Foundation C.I.C.
Copyright 2019 New Vector Ltd
Copyright 2015, 2016 OpenMarket Ltd

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import {
    type MatrixClient,
    MsgType,
    HTTPError,
    type IEventRelation,
    type ISendEventResponse,
    type MatrixEvent,
    type UploadOpts,
    type UploadProgress,
    THREAD_RELATION_TYPE,
} from "matrix-js-sdk/src/matrix";
import {
    type ImageInfo,
    type AudioInfo,
    type VideoInfo,
    type EncryptedFile,
    type MediaEventContent,
    type MediaEventInfo,
} from "matrix-js-sdk/src/types";
import encrypt from "matrix-encrypt-attachment";
import { logger } from "matrix-js-sdk/src/logger";
import { removeElement } from "matrix-js-sdk/src/utils";
import type { AttachmentSend } from "@matrix-org/analytics-events/types/typescript/AttachmentSend";
import type { AttachmentCancel } from "@matrix-org/analytics-events/types/typescript/AttachmentCancel";

import dis from "./dispatcher/dispatcher";
import { _t } from "./languageHandler";
import Modal from "./Modal";
import Spinner from "./components/views/elements/Spinner";
import { Action } from "./dispatcher/actions";
import {
    type UploadCanceledPayload,
    type UploadErrorPayload,
    type UploadFinishedPayload,
    type UploadProgressPayload,
    type UploadStartedPayload,
} from "./dispatcher/payloads/UploadPayload";
import { RoomUpload } from "./models/RoomUpload";
import SettingsStore from "./settings/SettingsStore";
import { decorateStartSendingTime, sendRoundTripMetric } from "./sendTimePerformanceMetrics";
import { TimelineRenderingType } from "./contexts/RoomContext";
import { addReplyToMessageContent } from "./utils/Reply";
import ErrorDialog from "./components/views/dialogs/ErrorDialog";
import UploadFailureDialog from "./components/views/dialogs/UploadFailureDialog";
import UploadConfirmDialog from "./components/views/dialogs/UploadConfirmDialog";
import { createThumbnail } from "./utils/image-media";
import { attachMentions, attachRelation } from "./utils/messages.ts";
import { doMaybeLocalRoomAction } from "./utils/local-room";
import { blobIsAnimated, mayBeAnimated } from "./utils/Image.ts";
import { PosthogAnalytics } from "./PosthogAnalytics.ts";
import { cacheUploadedMedia } from "./utils/UploadedMediaCache";
import { UploadTrace, type UploadTracePart } from "./intercom/UploadDiagnostics";
import BatchUploadDialog from "./intercom/gallery/BatchUploadDialog";

// scraped out of a macOS hidpi (5660ppm) screenshot png
//                  5669 px (x-axis)      , 5669 px (y-axis)      , per metre
const PHYS_HIDPI = [0x00, 0x00, 0x16, 0x25, 0x00, 0x00, 0x16, 0x25, 0x01];

export class UploadCanceledError extends Error {}
export class UploadFailedError extends Error {
    public constructor(cause: any) {
        super();
        this.cause = cause;
    }
}

interface IMediaConfig {
    "m.upload.size"?: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// How much of a PNG is read at a time when looking for its pHYs chunk
const PNG_HEADER_WINDOW = 1 << 16;
// A PNG has a handful of chunks before its image data; more than this is not a header any more
const PNG_MAX_HEADER_CHUNKS = 64;

/**
 * Whether a PNG says that it is a hi-dpi (macOS "retina") screenshot, which is shown at half its
 * pixel size. Only the chunks before the image data are read, not the file: pHYs always comes
 * before the first IDAT.
 */
export async function isHidpiPng(file: Blob): Promise<boolean> {
    try {
        let windowStart = 0;
        let window = new DataView(await file.slice(0, PNG_HEADER_WINDOW).arrayBuffer());
        if (window.byteLength < PNG_SIGNATURE.length + 8) return false;
        if (PNG_SIGNATURE.some((byte, i) => window.getUint8(i) !== byte)) return false;

        let offset = PNG_SIGNATURE.length;
        for (let i = 0; i < PNG_MAX_HEADER_CHUNKS; i++) {
            // A chunk is its length, its type, its data and a CRC
            if (offset + 8 > file.size) return false;
            if (offset + 8 + PHYS_HIDPI.length > windowStart + window.byteLength) {
                windowStart = offset;
                window = new DataView(await file.slice(offset, offset + PNG_HEADER_WINDOW).arrayBuffer());
                if (window.byteLength < 8) return false;
            }
            const at = offset - windowStart;
            const length = window.getUint32(at);
            const type = String.fromCharCode(
                window.getUint8(at + 4),
                window.getUint8(at + 5),
                window.getUint8(at + 6),
                window.getUint8(at + 7),
            );
            if (type === "pHYs") {
                if (length !== PHYS_HIDPI.length || at + 8 + length > window.byteLength) return false;
                return PHYS_HIDPI.every((val, j) => window.getUint8(at + 8 + j) === val);
            }
            if (type === "IDAT" || type === "IEND") return false;
            offset += 12 + length;
        }
    } catch (e) {
        console.error("Failed to parse PNG", e);
    }
    return false;
}

/**
 * Load a file into a newly created image element.
 *
 * @param {File} imageFile The file to load in an image element.
 * @returns {Promise} A promise that resolves with the html image element.
 */
async function loadImageElement(imageFile: File): Promise<HTMLImageElement> {
    // Load the file into an html element
    const img = new Image();
    const objectUrl = URL.createObjectURL(imageFile);
    const imgPromise = new Promise<HTMLImageElement>((resolve, reject) => {
        img.onload = function (): void {
            URL.revokeObjectURL(objectUrl);
            resolve(img);
        };
        img.onerror = function (e): void {
            URL.revokeObjectURL(objectUrl);
            reject(e);
        };
    });
    img.src = objectUrl;
    return imgPromise;
}

/**
 * Decodes an image file to something that can be drawn, with its size.
 *
 * The file is decoded off the main thread where the browser can do that (createImageBitmap);
 * an <img> is the fallback, for SVGs and for browsers without it.
 */
async function decodeImage(
    imageFile: File,
    trace?: UploadTrace,
): Promise<{ source: HTMLImageElement | ImageBitmap; width: number; height: number; close: () => void }> {
    const start = performance.now();
    if (typeof createImageBitmap === "function" && imageFile.type !== "image/svg+xml") {
        try {
            const bitmap = await createImageBitmap(imageFile);
            trace?.mark("decode", performance.now() - start, { via: "bitmap" });
            return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
        } catch {
            // Not something createImageBitmap reads; an <img> may still
        }
    }
    const img = await loadImageElement(imageFile);
    trace?.mark("decode", performance.now() - start, { via: "img" });
    return { source: img, width: img.width, height: img.height, close: () => undefined };
}

// Minimum size for image files before we generate a thumbnail for them.
const IMAGE_SIZE_THRESHOLD_THUMBNAIL = 1 << 15; // 32KB
// Minimum size improvement for image thumbnails, if both are not met then don't bother uploading thumbnail.
const IMAGE_THUMBNAIL_MIN_REDUCTION_SIZE = 1 << 16; // 1MB
const IMAGE_THUMBNAIL_MIN_REDUCTION_PERCENT = 0.1; // 10%
// We don't apply these thresholds to video thumbnails as a poster image is always useful
// and videos tend to be much larger.

// Image mime types for which to always include a thumbnail for even if it is larger than the input for wider support.
const ALWAYS_INCLUDE_THUMBNAIL = ["image/avif", "image/webp", "image/svg+xml"];

/**
 * Read the metadata for an image file and create and upload a thumbnail of the image.
 *
 * @param {MatrixClient} matrixClient A matrixClient to upload the thumbnail with.
 * @param {String} roomId The ID of the room the image will be uploaded in.
 * @param {File} imageFile The image to read and thumbnail.
 * @returns {Promise} A promise that resolves with the attachment info.
 */
async function infoForImageFile(
    matrixClient: MatrixClient,
    roomId: string,
    imageFile: File,
    trace?: UploadTrace,
): Promise<ImageInfo> {
    let thumbnailType = "image/png";
    if (imageFile.type === "image/jpeg") {
        thumbnailType = "image/jpeg";
    }

    // We don't await these immediately so they can happen in the background.
    // A type that cannot be animated needs no look into the file.
    const isAnimatedPromise = mayBeAnimated(imageFile.type)
        ? (trace?.time("animated_check", () => blobIsAnimated(imageFile)) ?? blobIsAnimated(imageFile))
        : Promise.resolve(undefined);
    // check for hi-dpi PNGs and fudge display resolution as needed.
    // this is mainly needed for macOS screencaps
    const hidpiPromise =
        imageFile.type === "image/png"
            ? (trace?.time("png_header", () => isHidpiPng(imageFile)) ?? isHidpiPng(imageFile))
            : Promise.resolve(false);
    // Neither is to fail the upload, or to go unhandled when decoding fails first
    isAnimatedPromise.catch(() => undefined);

    const decoded = await decodeImage(imageFile, trace);
    let result: Awaited<ReturnType<typeof createThumbnail>>;
    try {
        const hidpi = await hidpiPromise;
        const width = hidpi ? decoded.width >> 1 : decoded.width;
        const height = hidpi ? decoded.height >> 1 : decoded.height;
        result = await createThumbnail(
            decoded.source,
            width,
            height,
            thumbnailType,
            true,
            trace && { trace, prefix: "thumb_" },
        );
    } finally {
        decoded.close();
    }
    const imageInfo = result.info;

    const isAnimated = await isAnimatedPromise.catch(() => undefined);
    if (isAnimated !== undefined) {
        imageInfo["org.matrix.msc4230.is_animated"] = isAnimated;
    }

    // For lesser supported image types, always include the thumbnail even if it is larger
    if (!ALWAYS_INCLUDE_THUMBNAIL.includes(imageFile.type)) {
        // we do all sizing checks here because we still rely on thumbnail generation for making a blurhash from.
        const sizeDifference = imageFile.size - imageInfo.thumbnail_info!.size!;
        if (
            // image is small enough already
            imageFile.size <= IMAGE_SIZE_THRESHOLD_THUMBNAIL ||
            // thumbnail is not sufficiently smaller than original
            (sizeDifference <= IMAGE_THUMBNAIL_MIN_REDUCTION_SIZE &&
                sizeDifference <= imageFile.size * IMAGE_THUMBNAIL_MIN_REDUCTION_PERCENT)
        ) {
            delete imageInfo["thumbnail_info"];
            return imageInfo;
        }
    }

    const uploadResult = await uploadFile(
        matrixClient,
        roomId,
        result.thumbnail,
        undefined,
        undefined,
        trace && { trace, prefix: "thumb_" },
    );

    imageInfo["thumbnail_url"] = uploadResult.url;
    imageInfo["thumbnail_file"] = uploadResult.file;
    return imageInfo;
}

/**
 * Load a file into a newly created audio element and load the metadata
 *
 * @param {File} audioFile The file to load in an audio element.
 * @returns {Promise} A promise that resolves with the audio element.
 */
function loadAudioElement(audioFile: File): Promise<HTMLAudioElement> {
    return new Promise((resolve, reject) => {
        // Load the file into a html element
        const audio = document.createElement("audio");
        audio.preload = "metadata";
        audio.muted = true;

        // An object URL lets the element read what it needs from the file. A data URL, as used to
        // be made here, is the whole file in base64 in memory before the first byte is looked at.
        const objectUrl = URL.createObjectURL(audioFile);
        audio.onloadedmetadata = async function (): Promise<void> {
            URL.revokeObjectURL(objectUrl);
            resolve(audio);
        };
        audio.onerror = function (e): void {
            URL.revokeObjectURL(objectUrl);
            reject(e);
        };
        audio.src = objectUrl;
    });
}

/**
 * Read the metadata for an audio file.
 *
 * @param {File} audioFile The audio to read.
 * @returns {Promise} A promise that resolves with the attachment info.
 */
async function infoForAudioFile(audioFile: File): Promise<AudioInfo> {
    const audio = await loadAudioElement(audioFile);
    return { duration: Math.ceil(audio.duration * 1000) };
}

/**
 * Load a file into a newly created video element and pull some strings
 * in an attempt to guarantee the first frame will be showing.
 *
 * @param {File} videoFile The file to load in a video element.
 * @returns {Promise} A promise that resolves with the video element.
 */
function loadVideoElement(videoFile: File): Promise<{ video: HTMLVideoElement; release: () => void }> {
    return new Promise((resolve, reject) => {
        // Load the file into a html element
        const video = document.createElement("video");
        video.preload = "metadata";
        video.playsInline = true;
        video.muted = true;

        // Chrome chokes on quicktime but likes mp4, and `file.type` is
        // read only, so do this horrible hack to unbreak quicktime
        const source: Blob =
            videoFile.type === "video/quicktime" ? new Blob([videoFile], { type: "video/mp4" }) : videoFile;
        // An object URL, not a data URL: the element reads the first frame from the file instead
        // of the whole video being turned into base64 in memory first.
        const objectUrl = URL.createObjectURL(source);
        // The element shows its frame for as long as it has its source, so the URL is given
        // back by the caller once the thumbnail is drawn.
        const release = (): void => {
            URL.revokeObjectURL(objectUrl);
        };

        // Wait until we have enough data to thumbnail the first frame.
        video.onloadeddata = async function (): Promise<void> {
            resolve({ video, release });
            video.pause();
        };
        video.onerror = function (e): void {
            release();
            reject(e);
        };

        video.src = objectUrl;
        video.load();
        void video.play();
    });
}

/**
 * Read the metadata for a video file and create and upload a thumbnail of the video.
 *
 * @param {MatrixClient} matrixClient A matrixClient to upload the thumbnail with.
 * @param {String} roomId The ID of the room the video will be uploaded to.
 * @param {File} videoFile The video to read and thumbnail.
 * @returns {Promise} A promise that resolves with the attachment info.
 */
async function infoForVideoFile(
    matrixClient: MatrixClient,
    roomId: string,
    videoFile: File,
    trace?: UploadTrace,
): Promise<VideoInfo> {
    const thumbnailType = "image/jpeg";
    const tracePart = trace && { trace, prefix: "thumb_" };

    const videoInfo: VideoInfo = {};
    const loadStart = performance.now();
    const { video, release } = await loadVideoElement(videoFile);
    trace?.mark("decode", performance.now() - loadStart, { via: "video" });
    let result: Awaited<ReturnType<typeof createThumbnail>>;
    try {
        videoInfo.duration = Math.ceil(video.duration * 1000);
        result = await createThumbnail(video, video.videoWidth, video.videoHeight, thumbnailType, true, tracePart);
    } finally {
        release();
    }
    Object.assign(videoInfo, result.info);
    const uploaded = await uploadFile(matrixClient, roomId, result.thumbnail, undefined, undefined, tracePart);
    videoInfo.thumbnail_url = uploaded.url;
    videoInfo.thumbnail_file = uploaded.file;
    return videoInfo;
}

/**
 * Read the file as an ArrayBuffer.
 * @param {File} file The file to read
 * @returns {Promise} A promise that resolves with an ArrayBuffer when the file
 *   is read.
 */
function readFileAsArrayBuffer(file: File | Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (e): void {
            resolve(e.target?.result as ArrayBuffer);
        };
        reader.onerror = function (e): void {
            reject(e);
        };
        reader.readAsArrayBuffer(file);
    });
}

/**
 * Upload the file to the content repository.
 * If the room is encrypted then encrypt the file before uploading.
 *
 * @param {MatrixClient} matrixClient The matrix client to upload the file with.
 * @param {String} roomId The ID of the room being uploaded to.
 * @param {File} file The file to upload.
 * @param {Function?} progressHandler optional callback to be called when a chunk of
 *    data is uploaded.
 * @param {AbortController?} controller optional abortController to use for this upload.
 * @param tracePart optional diagnostics trace to write the time of each step to.
 * @returns {Promise} A promise that resolves with an object.
 *  If the file is unencrypted then the object will have a "url" key.
 *  If the file is encrypted then the object will have a "file" key.
 */
export async function uploadFile(
    matrixClient: MatrixClient,
    roomId: string,
    file: File | Blob,
    progressHandler?: UploadOpts["progressHandler"],
    controller?: AbortController,
    tracePart?: UploadTracePart,
): Promise<{ url?: string; file?: EncryptedFile }> {
    const abortController = controller ?? new AbortController();
    const timed = <T>(phase: string, fn: () => Promise<T>, extra?: Record<string, number | boolean>): Promise<T> =>
        tracePart ? tracePart.trace.time(tracePart.prefix + phase, fn, extra) : fn();

    // If the room is encrypted then encrypt the file before uploading it.
    if (await matrixClient.getCrypto()?.isEncryptionEnabledInRoom(roomId)) {
        // First read the file into memory.
        const data = await timed("read", () => readFileAsArrayBuffer(file));
        if (abortController.signal.aborted) throw new UploadCanceledError();

        // Then encrypt the file.
        const encryptResult = await timed("encrypt", () => encrypt.encryptAttachment(data));
        if (abortController.signal.aborted) throw new UploadCanceledError();

        // Pass the encrypted data as a Blob to the uploader.
        const blob = new Blob([encryptResult.data]);

        let url: string;
        try {
            ({ content_uri: url } = await timed(
                "http",
                () =>
                    matrixClient.uploadContent(blob, {
                        progressHandler,
                        abortController,
                        includeFilename: false,
                        type: "application/octet-stream",
                    }),
                { sent: blob.size, encrypted: true },
            ));
        } catch (e) {
            if (abortController.signal.aborted) throw new UploadCanceledError();
            console.error("Failed to upload file", e);
            throw new UploadFailedError(e);
        }
        if (abortController.signal.aborted) throw new UploadCanceledError();

        cacheUploadedMedia(url, file);

        // If the attachment is encrypted then bundle the URL along with the information
        // needed to decrypt the attachment and add it under a file key.
        return {
            file: {
                ...encryptResult.info,
                url,
            } as EncryptedFile,
        };
    } else {
        let url: string;
        try {
            ({ content_uri: url } = await timed(
                "http",
                () => matrixClient.uploadContent(file, { progressHandler, abortController }),
                { sent: file.size, encrypted: false },
            ));
        } catch (e) {
            if (abortController.signal.aborted) throw new UploadCanceledError();
            console.error("Failed to upload file", e);
            throw new UploadFailedError(e);
        }
        if (abortController.signal.aborted) throw new UploadCanceledError();
        cacheUploadedMedia(url, file);
        // If the attachment isn't encrypted then include the URL directly.
        return { url };
    }
}

export default class ContentMessages {
    private inprogress: RoomUpload[] = [];
    private mediaConfig: IMediaConfig | null = null;

    public sendStickerContentToRoom(
        url: string,
        roomId: string,
        threadId: string | null,
        info: ImageInfo,
        text: string,
        matrixClient: MatrixClient,
    ): Promise<ISendEventResponse> {
        return doMaybeLocalRoomAction(
            roomId,
            (actualRoomId: string) => matrixClient.sendStickerMessage(actualRoomId, threadId, url, info, text),
            matrixClient,
        ).catch((e) => {
            logger.warn(`Failed to send content with URL ${url} to room ${roomId}`, e);
            throw e;
        });
    }

    public getUploadLimit(): number | null {
        return this.mediaConfig?.["m.upload.size"] ?? null;
    }

    /**
     * Sends a list of files to a room.
     * @param files - The files to send.
     * @param roomId - The ID of the room to send the files to.
     * @param relation - The relation to the event being replied to.
     * @param replyToEvent - The event being replied to, if any.
     * @param matrixClient - The Matrix client to use for sending the files.
     * @param context - The context in which the files are being sent.
     * @returns A promise that resolves when the files have been sent.
     */
    public async sendContentListToRoom(
        files: File[],
        roomId: string,
        relation: IEventRelation | undefined,
        replyToEvent: MatrixEvent | undefined,
        matrixClient: MatrixClient,
        context = TimelineRenderingType.Room,
    ): Promise<void> {
        if (matrixClient.isGuest()) {
            dis.dispatch({ action: "require_registration" });
            return;
        }

        if (!this.mediaConfig) {
            // hot-path optimization to not flash a spinner if we don't need to
            const modal = Modal.createDialog(Spinner, undefined, "mx_Dialog_spinner");
            await Promise.race([this.ensureMediaConfigFetched(matrixClient), modal.finished]);
            if (!this.mediaConfig) {
                // User cancelled by clicking away on the spinner
                return;
            } else {
                modal.close();
            }
        }

        const tooBigFiles: File[] = [];
        const okFiles: File[] = [];

        for (const file of files) {
            if (this.isFileSizeAcceptable(file)) {
                okFiles.push(file);
            } else {
                tooBigFiles.push(file);
            }
        }

        if (tooBigFiles.length > 0) {
            const { finished } = Modal.createDialog(UploadFailureDialog, {
                badFiles: tooBigFiles,
                totalFiles: files.length,
                contentMessages: this,
            });
            const [shouldContinue] = await finished;
            if (!shouldContinue) return;
        }

        let uploadAll = false;
        // Text sent with the first file, when the files were confirmed as one batch
        let caption: string | undefined;
        if (okFiles.length > 1 && okFiles.every((file) => file.type.startsWith("image/"))) {
            // Several pictures chosen together are asked for once and sent as one batch, one after
            // the other, so that they arrive as the gallery they were chosen as.
            const { finished } = Modal.createDialog(BatchUploadDialog, { files: okFiles });
            const [confirmed, text] = await finished;
            if (confirmed) {
                uploadAll = true;
                caption = text;
            } else {
                okFiles.length = 0;
            }
        }
        // Promise to complete before sending next file into room, used for synchronisation of file-sending
        // to match the order the files were specified in
        let promBefore: Promise<any> = Promise.resolve();
        const sentFileTypes: string[] = [];
        for (let i = 0; i < okFiles.length; ++i) {
            const file = okFiles[i];
            const loopPromiseBefore = promBefore;

            if (!uploadAll) {
                const { finished } = Modal.createDialog(UploadConfirmDialog, {
                    file,
                    currentIndex: i,
                    totalFiles: okFiles.length,
                });
                const [shouldContinue, shouldUploadAll] = await finished;
                if (!shouldContinue) break;
                if (shouldUploadAll) {
                    uploadAll = true;
                }
            }
            sentFileTypes.push(file.type.split("/")[0]);

            promBefore = doMaybeLocalRoomAction(
                roomId,
                (actualRoomId) =>
                    this.sendContentToRoom(
                        file,
                        actualRoomId,
                        relation,
                        matrixClient,
                        replyToEvent ?? undefined,
                        loopPromiseBefore,
                        i === 0 ? caption : undefined,
                    ),
                matrixClient,
            );
        }
        if (sentFileTypes.length) {
            // Find the most common type.
            const [type] = sentFileTypes.sort(
                (a, b) => sentFileTypes.filter((v) => v === b).length - sentFileTypes.filter((v) => v === a).length,
            );
            PosthogAnalytics.instance.trackEvent<AttachmentSend>({
                eventName: "AttachmentSend",
                isReply: !!replyToEvent,
                inThread: relation?.rel_type === "m.thread",
                count: okFiles.length,
                kind: "local",
                type,
            });
        } else {
            PosthogAnalytics.instance.trackEvent<AttachmentCancel>({
                eventName: "AttachmentCancel",
                isReply: !!replyToEvent,
                inThread: relation?.rel_type === "m.thread",
                kind: "local",
                stage: "Confirmation",
            });
        }

        if (replyToEvent) {
            // Clear event being replied to
            dis.dispatch({
                action: "reply_to_event",
                event: null,
                context,
            });
        }

        // Focus the correct composer
        dis.dispatch({
            action: Action.FocusSendMessageComposer,
            context,
        });
    }

    public getCurrentUploads(relation?: IEventRelation): RoomUpload[] {
        return this.inprogress.filter((roomUpload) => {
            const noRelation = !relation && !roomUpload.relation;
            const matchingRelation =
                relation &&
                roomUpload.relation &&
                relation.rel_type === roomUpload.relation.rel_type &&
                relation.event_id === roomUpload.relation.event_id;

            return (noRelation || matchingRelation) && !roomUpload.cancelled;
        });
    }

    public cancelUpload(upload: RoomUpload): void {
        upload.abort();
        dis.dispatch<UploadCanceledPayload>({ action: Action.UploadCanceled, upload });
    }

    public async sendContentToRoom(
        file: File,
        roomId: string,
        relation: IEventRelation | undefined,
        matrixClient: MatrixClient,
        replyToEvent: MatrixEvent | undefined,
        promBefore?: Promise<any>,
        caption?: string,
    ): Promise<void> {
        const fileName = file.name || _t("common|attachment");
        const content: Omit<MediaEventContent, "info"> & { info: Partial<MediaEventInfo> } = {
            // With a caption the body is the caption and the file name goes beside it
            ...(caption ? { body: caption, filename: fileName } : { body: fileName }),
            info: {
                size: file.size,
            },
            msgtype: MsgType.File, // set more specifically later
        };

        // Attach mentions, which really only applies if there's a replyToEvent.
        attachMentions(matrixClient.getSafeUserId(), content, null, replyToEvent);
        attachRelation(content, relation);
        if (replyToEvent) {
            addReplyToMessageContent(content, replyToEvent);
        }

        if (SettingsStore.getValue("Performance.addSendMessageTimingMetadata")) {
            decorateStartSendingTime(content);
        }

        // if we have a mime type for the file, add it to the message metadata
        if (file.type) {
            content.info.mimetype = file.type;
        }

        const upload = new RoomUpload(roomId, fileName, relation, file.size);
        this.inprogress.push(upload);
        dis.dispatch<UploadStartedPayload>({ action: Action.UploadStarted, upload });

        function onProgress(progress: UploadProgress): void {
            upload.onProgress(progress);
            dis.dispatch<UploadProgressPayload>({ action: Action.UploadProgress, upload });
        }

        const trace = new UploadTrace(file.size, file.type || "unknown");
        let outcome: "sent" | "failed" | "cancelled" = "failed";

        // The file itself goes up while its thumbnail and metadata are being made, rather than
        // after them: neither needs the other, and for a picture the two requests used to be made
        // one after the other.
        // It has an abort controller of its own, so that it can be stopped when the thumbnail fails
        // without the upload counting as cancelled by the user.
        const fileAbort = new AbortController();
        if (upload.cancelled) fileAbort.abort();
        upload.abortController.signal.addEventListener("abort", () => fileAbort.abort());
        const fileUpload = uploadFile(matrixClient, roomId, file, onProgress, fileAbort, { trace, prefix: "" });
        // Looked at below; until then a failure is not to count as unhandled
        fileUpload.catch(() => undefined);

        try {
            if (file.type.startsWith("image/")) {
                content.msgtype = MsgType.Image;
                try {
                    const imageInfo = await infoForImageFile(matrixClient, roomId, file, trace);
                    Object.assign(content.info, imageInfo);
                } catch (e) {
                    if (e instanceof UploadFailedError) {
                        // re-throw to main upload error handler
                        throw e;
                    }
                    // Otherwise we failed to thumbnail, fall back to uploading an m.file
                    logger.error(`Expected file of type "${file.type}" to be an image, but got`, e);
                    content.msgtype = MsgType.File;
                }
            } else if (file.type.startsWith("audio/")) {
                content.msgtype = MsgType.Audio;
                try {
                    const audioInfo = await trace.time("metadata", () => infoForAudioFile(file));
                    Object.assign(content.info, audioInfo);
                } catch (e) {
                    // Failed to process audio file, fall back to uploading an m.file
                    logger.error(e);
                    content.msgtype = MsgType.File;
                }
            } else if (file.type.startsWith("video/")) {
                content.msgtype = MsgType.Video;
                try {
                    const videoInfo = await infoForVideoFile(matrixClient, roomId, file, trace);
                    Object.assign(content.info, videoInfo);
                } catch (e) {
                    // Failed to thumbnail, fall back to uploading an m.file
                    logger.error(e);
                    content.msgtype = MsgType.File;
                }
            } else {
                content.msgtype = MsgType.File;
            }

            if (upload.cancelled) throw new UploadCanceledError();
            const result = await fileUpload;
            content.file = result.file;
            content.url = result.url;

            if (upload.cancelled) throw new UploadCanceledError();
            // Await previous message being sent into the room
            if (promBefore) await trace.time("wait_previous", () => promBefore);

            if (upload.cancelled) throw new UploadCanceledError();
            const threadId = relation?.rel_type === THREAD_RELATION_TYPE.name ? relation.event_id : null;

            const response = await trace.time("send_event", () =>
                matrixClient.sendMessage(roomId, threadId ?? null, content as MediaEventContent),
            );
            outcome = "sent";

            if (SettingsStore.getValue("Performance.addSendMessageTimingMetadata")) {
                sendRoundTripMetric(matrixClient, roomId, response.event_id);
            }

            dis.dispatch<UploadFinishedPayload>({ action: Action.UploadFinished, upload });
            dis.dispatch({ action: "message_sent" });
        } catch (error) {
            // Whatever of this upload is still on its way is of no use any more
            if (outcome !== "sent") fileAbort.abort();
            if (upload.cancelled) outcome = "cancelled";
            // Unwrap UploadFailedError to get the underlying error
            const unwrappedError = error instanceof UploadFailedError && error.cause ? error.cause : error;

            // 413: File was too big or upset the server in some way:
            // clear the media size limit so we fetch it again next time we try to upload
            if (unwrappedError instanceof HTTPError && unwrappedError.httpStatus === 413) {
                this.mediaConfig = null;
            }

            if (!upload.cancelled) {
                let desc = _t("upload_failed_generic", { fileName: upload.fileName });
                if (unwrappedError instanceof HTTPError && unwrappedError.httpStatus === 413) {
                    desc = _t("upload_failed_size", {
                        fileName: upload.fileName,
                    });
                }
                Modal.createDialog(ErrorDialog, {
                    title: _t("upload_failed_title"),
                    description: desc,
                });
                dis.dispatch<UploadErrorPayload>({ action: Action.UploadFailed, upload, error });
            }
        } finally {
            trace.finish(outcome, { kind: content.msgtype });
            removeElement(this.inprogress, (e) => e.promise === upload.promise);
        }
    }

    private isFileSizeAcceptable(file: File): boolean {
        if (this.mediaConfig?.["m.upload.size"] !== undefined && file.size > this.mediaConfig["m.upload.size"]) {
            return false;
        }
        return true;
    }

    private ensureMediaConfigFetched(matrixClient: MatrixClient): Promise<void> {
        if (this.mediaConfig !== null) return Promise.resolve();

        logger.log("[Media Config] Fetching");
        return matrixClient
            .getMediaConfig()
            .then((config) => {
                logger.log("[Media Config] Fetched config:", config);
                return config;
            })
            .catch(() => {
                // Media repo can't or won't report limits, so provide an empty object (no limits).
                logger.log("[Media Config] Could not fetch config, so not limiting uploads.");
                return {};
            })
            .then((config) => {
                this.mediaConfig = config;
            });
    }

    public static sharedInstance(): ContentMessages {
        if (window.mxContentMessages === undefined) {
            window.mxContentMessages = new ContentMessages();
        }
        return window.mxContentMessages;
    }
}
