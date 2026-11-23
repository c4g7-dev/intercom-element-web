/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { EventType, MsgType, type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { MediaEventHelper } from "../../utils/MediaEventHelper";

/** Images sent further apart than this are not one gallery. */
export const GALLERY_MAX_GAP_MS = 2 * 60 * 1000;

/**
 * The content field that marks the pictures confirmed together in the batch dialog:
 * `{ id, index, count }`. Pictures with the same `id` are one gallery however long their uploads
 * took; other clients ignore the field.
 */
export const GALLERY_BATCH_FIELD = "io.intercom.gallery";

/** The batch a picture was sent in, if it says so. */
export function galleryBatchId(event: MatrixEvent): string | undefined {
    const id = event.getContent()[GALLERY_BATCH_FIELD]?.id;
    return typeof id === "string" && id ? id : undefined;
}

function sameBatch(a: MatrixEvent, b: MatrixEvent): boolean {
    const batch = galleryBatchId(a);
    return batch !== undefined && batch === galleryBatchId(b);
}

/** One entry of a timeline: an event and whether it gets a tile. */
export interface GalleryCandidate {
    event: MatrixEvent;
    shouldShow?: boolean;
}

/** Whether an event is a plain picture message: one that can be a cell of a gallery. */
export function isGalleryImage(event: MatrixEvent): boolean {
    if (event.getType() !== EventType.RoomMessage) return false;
    if (event.isRedacted() || event.isDecryptionFailure()) return false;
    const content = event.getContent();
    if (content.msgtype !== MsgType.Image) return false;
    // A reply shows what it answers; it stays a message of its own
    if (event.replyEventId) return false;
    return typeof content.url === "string" || typeof content.file?.url === "string";
}

function sameDay(a: MatrixEvent, b: MatrixEvent): boolean {
    return new Date(a.getTs()).toDateString() === new Date(b.getTs()).toDateString();
}

/**
 * Finds the runs of pictures that are shown as one gallery: at least two picture messages in a
 * row from one sender, each within two minutes of the one before (or marked as one batch), with
 * nothing shown between them. A caption is text, so only the first picture of a gallery may have one.
 *
 * The events stay what they are, one m.image each; this is only how they are laid out.
 *
 * @param candidates - the timeline in order
 * @param exclude - event IDs that are not to be part of a gallery (the one being edited, …)
 * @returns each gallery under the ID of its first event
 */
export function findGalleries(
    candidates: readonly GalleryCandidate[],
    exclude?: ReadonlySet<string>,
): Map<string, MatrixEvent[]> {
    const galleries = new Map<string, MatrixEvent[]>();
    let run: MatrixEvent[] = [];

    const close = (): void => {
        const first = run[0]?.getId();
        if (run.length >= 2 && first) galleries.set(first, run);
        run = [];
    };

    for (const { event, shouldShow } of candidates) {
        // What has no tile does not come between two pictures
        if (!shouldShow) continue;

        const id = event.getId();
        if (!id || exclude?.has(id) || !isGalleryImage(event)) {
            close();
            continue;
        }

        const previous = run[run.length - 1];
        if (
            previous &&
            (previous.getSender() !== event.getSender() ||
                // Pictures of one batch belong together however long each took to upload
                (!sameBatch(previous, event) &&
                    (Math.abs(event.getTs() - previous.getTs()) > GALLERY_MAX_GAP_MS || !sameDay(previous, event))) ||
                previous.threadRootId !== event.threadRootId ||
                MediaEventHelper.hasCaption(event))
        ) {
            close();
        }
        run.push(event);
    }
    close();

    return galleries;
}

/**
 * How a gallery of `count` pictures is laid out: how many are shown, and how many of the six
 * columns of the grid each of them takes. Rows are three pictures wide; what does not fill a row
 * comes first, larger.
 */
export function galleryLayout(count: number, maxVisible = 9): { visible: number; spans: number[] } {
    const visible = Math.max(0, Math.min(count, maxVisible));
    if (visible === 0) return { visible, spans: [] };
    if (visible === 1) return { visible, spans: [6] };
    if (visible === 4) return { visible, spans: [3, 3, 3, 3] };
    const remainder = visible % 3;
    const spans: number[] = [];
    if (remainder === 1) spans.push(6);
    if (remainder === 2) spans.push(3, 3);
    while (spans.length < visible) spans.push(2);
    return { visible, spans };
}
