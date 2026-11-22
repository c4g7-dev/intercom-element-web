/*
Copyright 2024 New Vector Ltd.
Copyright 2022 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type ImageInfo } from "matrix-js-sdk/src/types";

import { BlurhashEncoder } from "../BlurhashEncoder";

import { type UploadTracePart } from "../intercom/UploadDiagnostics";

type ThumbnailableElement = HTMLImageElement | HTMLVideoElement | ImageBitmap;

export const BLURHASH_FIELD = "xyz.amorgan.blurhash"; // MSC2448

interface IThumbnail {
    info: ImageInfo;
    thumbnail: Blob;
}

const MAX_WIDTH = 800;
const MAX_HEIGHT = 600;
// A blurhash holds a handful of colour components, and encoding one costs time in proportion to
// the pixels it is made from: 800x600 takes about half a second, 64x48 a few milliseconds, for
// a hash that looks the same.
const BLURHASH_MAX_SIDE = 64;

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function createCanvas(width: number, height: number): [Canvas, Context2D] {
    try {
        const canvas = new window.OffscreenCanvas(width, height);
        return [canvas, canvas.getContext("2d")!];
    } catch {
        // Fallback support for other browsers (Safari and Firefox for now)
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return [canvas, canvas.getContext("2d")!];
    }
}

/**
 * The pixels a blurhash is made from: the thumbnail, scaled down to at most BLURHASH_MAX_SIDE.
 */
function blurhashImageData(canvas: Canvas, context: Context2D, width: number, height: number): ImageData {
    const scale = Math.min(1, BLURHASH_MAX_SIDE / Math.max(width, height));
    if (scale >= 1) return context.getImageData(0, 0, width, height);
    const smallWidth = Math.max(1, Math.round(width * scale));
    const smallHeight = Math.max(1, Math.round(height * scale));
    const [, smallContext] = createCanvas(smallWidth, smallHeight);
    smallContext.drawImage(canvas, 0, 0, smallWidth, smallHeight);
    return smallContext.getImageData(0, 0, smallWidth, smallHeight);
}

/**
 * Create a thumbnail for a image DOM element or a decoded bitmap.
 * The image will be smaller than MAX_WIDTH and MAX_HEIGHT.
 * The thumbnail will have the same aspect ratio as the original.
 * Draws the element into a canvas using CanvasRenderingContext2D.drawImage
 * Then calls Canvas.toBlob to get a blob object for the image data.
 *
 * Since it needs to calculate the dimensions of the source image and the
 * thumbnailed image it returns an info object filled out with information
 * about the original image and the thumbnail.
 *
 * @param {HTMLElement} element The element to thumbnail.
 * @param {number} inputWidth The width of the image in the input element.
 * @param {number} inputHeight the width of the image in the input element.
 * @param {string} mimeType The mimeType to save the blob as.
 * @param {boolean} calculateBlurhash Whether to calculate a blurhash of the given image too.
 * @param tracePart Where to write how long each step took.
 * @returns {Promise} A promise that resolves with an object with an info key
 *  and a thumbnail key.
 */
export async function createThumbnail(
    element: ThumbnailableElement,
    inputWidth: number,
    inputHeight: number,
    mimeType: string,
    calculateBlurhash = true,
    tracePart?: UploadTracePart,
): Promise<IThumbnail> {
    let targetWidth = inputWidth;
    let targetHeight = inputHeight;
    if (targetHeight > MAX_HEIGHT) {
        targetWidth = Math.floor(targetWidth * (MAX_HEIGHT / targetHeight));
        targetHeight = MAX_HEIGHT;
    }
    if (targetWidth > MAX_WIDTH) {
        targetHeight = Math.floor(targetHeight * (MAX_WIDTH / targetWidth));
        targetWidth = MAX_WIDTH;
    }

    const now = (): number => performance.now();
    const mark = (phase: string, since: number): void => tracePart?.trace.mark(tracePart.prefix + phase, now() - since);

    const drawStart = now();
    const [canvas, context] = createCanvas(targetWidth, targetHeight);
    // For an <img> this is also where the picture is decoded
    context.drawImage(element, 0, 0, targetWidth, targetHeight);
    mark("draw", drawStart);

    const encodeStart = now();
    let thumbnailPromise: Promise<Blob>;

    if (window.OffscreenCanvas && canvas instanceof OffscreenCanvas) {
        thumbnailPromise = canvas.convertToBlob({ type: mimeType });
    } else {
        thumbnailPromise = new Promise<Blob>((resolve) =>
            (canvas as HTMLCanvasElement).toBlob(resolve as BlobCallback, mimeType),
        );
    }
    void thumbnailPromise.then(
        () => mark("encode", encodeStart),
        () => undefined,
    );

    // thumbnailPromise and blurhash promise are being awaited concurrently
    let blurhash: string | undefined;
    if (calculateBlurhash) {
        const blurhashStart = now();
        const imageData = blurhashImageData(canvas, context, targetWidth, targetHeight);
        blurhash = await BlurhashEncoder.instance.getBlurhash(imageData);
        mark("blurhash", blurhashStart);
    }
    const thumbnail = await thumbnailPromise;

    return {
        info: {
            thumbnail_info: {
                w: targetWidth,
                h: targetHeight,
                mimetype: thumbnail.type,
                size: thumbnail.size,
            },
            w: inputWidth,
            h: inputHeight,
            [BLURHASH_FIELD]: blurhash,
        },
        thumbnail,
    };
}
