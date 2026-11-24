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
    /**
     * Set when the event has a tile only because the developer option "Show hidden events in
     * timeline" is on (call memberships, reactions, edits, …). Such a tile does not part two
     * pictures: with the option off there is nothing between them.
     */
    hiddenByDefault?: boolean;
}

/** Whether an event is a picture message at all, whatever else is true of it. */
function isPicture(event: MatrixEvent): boolean {
    return event.getType() === EventType.RoomMessage && event.getContent().msgtype === MsgType.Image;
}

/** Why a picture message cannot be a cell of a gallery; undefined if it can. */
function notGalleryImageReason(event: MatrixEvent): string | undefined {
    if (event.isRedacted()) return "redacted";
    if (event.isDecryptionFailure()) return "undecryptable";
    if (event.getType() !== EventType.RoomMessage) return "type";
    const content = event.getContent();
    if (content.msgtype !== MsgType.Image) return "msgtype";
    // A reply shows what it answers; it stays a message of its own
    if (event.replyEventId) return "reply";
    if (typeof content.url !== "string" && typeof content.file?.url !== "string") return "no_url";
    return undefined;
}

/** Whether an event is a plain picture message: one that can be a cell of a gallery. */
export function isGalleryImage(event: MatrixEvent): boolean {
    return notGalleryImageReason(event) === undefined;
}

function sameDay(a: MatrixEvent, b: MatrixEvent): boolean {
    return new Date(a.getTs()).toDateString() === new Date(b.getTs()).toDateString();
}

/** Why a picture does not go on with the gallery of the picture before it; undefined if it does. */
function partedReason(previous: MatrixEvent, event: MatrixEvent): string | undefined {
    if (previous.getSender() !== event.getSender()) return "sender";
    // Pictures of one batch belong together however long each took to upload
    if (!sameBatch(previous, event)) {
        if (Math.abs(event.getTs() - previous.getTs()) > GALLERY_MAX_GAP_MS) return "gap";
        if (!sameDay(previous, event)) return "day";
    }
    if (previous.threadRootId !== event.threadRootId) return "thread";
    // A caption is text, so only the first picture of a gallery may have one
    if (MediaEventHelper.hasCaption(event)) return "caption";
    return undefined;
}

/** What is known of one picture of a run, for the diagnostics log: no text, no name, no URL, no ID. */
export interface GalleryDecisionItem {
    /** "joined" the gallery of the picture before, "first" of the run, or why it did not join */
    outcome: string;
    /** Senders are numbered within the run */
    sender: number;
    /** ms since the picture before */
    gapMs?: number;
    /** Batches are numbered within the run; undefined for a picture without the mark */
    batch?: number;
    batchIndex?: number;
    batchCount?: number;
    /** A body beside a different file name: a caption (MSC2530) */
    caption: boolean;
    hasFilename: boolean;
    mimetype?: string;
    /** `rel_type` of `m.relates_to`, "reply" for a reply without one */
    relation?: string;
    thread: boolean;
    edited: boolean;
    encrypted: boolean;
    /** The status of a local echo ("sending", "sent", …); undefined once it came back from the server */
    localEcho?: string;
    shown: boolean;
    /** The names of the fields of the content */
    keys: string[];
    /** What lay between this picture and the one before: `<type>` or `<type>/<msgtype>`, with how it counted */
    between: string[];
}

/** One run of pictures near each other, and what became of it. */
export interface GalleryDecision {
    /** How many pictures the run has */
    pictures: number;
    /** The sizes of the galleries made of it; pictures left alone are not counted */
    galleries: number[];
    items: GalleryDecisionItem[];
}

/**
 * At most this many tiles may lie between two pictures of one run in the diagnostics. Only what
 * has a tile counts: a call going on puts many events without one between two pictures.
 */
const DECISION_MAX_BETWEEN = 12;
/** At most this many entries of what lay between two pictures are written; the rest are counted. */
const DECISION_MAX_BETWEEN_LISTED = 16;

function describeBetween({ event, shouldShow, hiddenByDefault }: GalleryCandidate): string {
    const type = event.getType();
    const msgtype = type === EventType.RoomMessage ? event.getContent().msgtype : undefined;
    const how = !shouldShow ? "no_tile" : hiddenByDefault ? "hidden_by_default" : "tile";
    const state = event.isState() ? ",state" : "";
    return `${type}${typeof msgtype === "string" ? "/" + msgtype : ""}:${how}${state}`;
}

/** What lay between two pictures, the first of it by name and the rest counted. */
function listBetween(between: string[], count: number): string[] {
    if (count <= DECISION_MAX_BETWEEN_LISTED) return between;
    return [...between.slice(0, DECISION_MAX_BETWEEN_LISTED - 1), `+${count - DECISION_MAX_BETWEEN_LISTED + 1} more`];
}

/**
 * Finds the runs of pictures that are shown as one gallery (see {@link findGalleries}) and says,
 * for every run of pictures that lie near each other, what was decided about each of them.
 */
export function analyseGalleries(
    candidates: readonly GalleryCandidate[],
    exclude?: ReadonlySet<string>,
): { galleries: Map<string, MatrixEvent[]>; decisions: GalleryDecision[]; decisionKeys: string[] } {
    const galleries = new Map<string, MatrixEvent[]>();
    const decisions: GalleryDecision[] = [];
    // For each decision, something to know its run by from one render to the next; not written
    const decisionKeys: string[] = [];
    let run: MatrixEvent[] = [];

    // The diagnostics: pictures that follow each other closely, grouped or not
    let near:
        | { decision: GalleryDecision; key: string; last: MatrixEvent; senders: string[]; batches: string[] }
        | undefined;
    let between: string[] = [];
    // How many entries lay between, and how many of them have a tile of their own (with hidden
    // events not shown)
    let betweenCount = 0;
    let tilesBetween = 0;
    // Why the gallery before the next picture was ended by something that is not a picture
    let ended: string | undefined;

    const close = (): void => {
        const first = run[0]?.getId();
        if (run.length >= 2 && first) {
            galleries.set(first, run);
            near?.decision.galleries.push(run.length);
        }
        run = [];
    };
    const closeNear = (): void => {
        if (near && near.decision.pictures >= 2) {
            decisions.push(near.decision);
            decisionKeys.push(near.key);
        }
        near = undefined;
    };
    const note = (candidate: GalleryCandidate, outcome: string): void => {
        const { event } = candidate;
        const closeToLast =
            near &&
            tilesBetween <= DECISION_MAX_BETWEEN &&
            (sameBatch(near.last, event) || Math.abs(event.getTs() - near.last.getTs()) <= GALLERY_MAX_GAP_MS);
        if (!closeToLast) {
            closeNear();
            near = {
                decision: { pictures: 0, galleries: [], items: [] },
                key: event.getTxnId() ?? event.getId() ?? "",
                last: event,
                senders: [],
                batches: [],
            };
        }
        const state = near!;
        const index = <T>(list: T[], value: T): number => {
            if (!list.includes(value)) list.push(value);
            return list.indexOf(value);
        };
        const content = event.getContent();
        const wire = event.getWireContent();
        const relation = content["m.relates_to"] ?? wire["m.relates_to"];
        const batch = content[GALLERY_BATCH_FIELD];
        const batchId = galleryBatchId(event);
        state.decision.pictures++;
        state.decision.items.push({
            outcome: state.decision.items.length === 0 ? "first" : outcome,
            sender: index(state.senders, event.getSender() ?? ""),
            gapMs: state.decision.items.length === 0 ? undefined : event.getTs() - state.last.getTs(),
            batch: batchId === undefined ? undefined : index(state.batches, batchId),
            batchIndex: typeof batch?.index === "number" ? batch.index : undefined,
            batchCount: typeof batch?.count === "number" ? batch.count : undefined,
            caption: MediaEventHelper.hasCaption(event),
            hasFilename: typeof content.filename === "string",
            mimetype: typeof content.info?.mimetype === "string" ? content.info.mimetype : undefined,
            relation:
                typeof relation?.rel_type === "string" ? relation.rel_type : event.replyEventId ? "reply" : undefined,
            thread: event.threadRootId !== undefined,
            edited: Boolean(event.replacingEvent()),
            encrypted: event.isEncrypted(),
            localEcho: event.status ?? undefined,
            shown: Boolean(candidate.shouldShow),
            keys: Object.keys(content).sort(),
            between: state.decision.items.length === 0 ? [] : listBetween(between, betweenCount),
        });
        state.last = event;
        between = [];
        betweenCount = 0;
        tilesBetween = 0;
    };

    for (const candidate of candidates) {
        const { event, shouldShow, hiddenByDefault } = candidate;
        const picture = isPicture(event);
        // What lies between two pictures matters only once there is a picture before it
        if (!picture && near) {
            betweenCount++;
            if (between.length < DECISION_MAX_BETWEEN_LISTED) between.push(describeBetween(candidate));
            if (shouldShow && !hiddenByDefault) tilesBetween++;
        }

        // What has no tile does not come between two pictures, and neither does what has one only
        // because hidden events are shown
        if (!shouldShow || (hiddenByDefault && !picture)) continue;

        const id = event.getId();
        const unfit = !id ? "no_id" : exclude?.has(id) ? "excluded" : notGalleryImageReason(event);
        if (unfit) {
            close();
            if (picture) {
                note(candidate, unfit);
                ended = unfit;
            } else {
                ended = "tile_between";
            }
            continue;
        }

        const previous = run[run.length - 1];
        const parted = previous ? partedReason(previous, event) : (ended ?? "first");
        if (previous && parted) close();
        note(candidate, parted ?? "joined");
        ended = undefined;
        run.push(event);
    }
    close();
    closeNear();

    return { galleries, decisions, decisionKeys };
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
    return analyseGalleries(candidates, exclude).galleries;
}

/**
 * The galleries found anew, with each one that has not changed replaced by its array from before,
 * so that its tile is not rendered anew with every render of the timeline.
 */
export function keepUnchangedGalleries<T extends readonly MatrixEvent[]>(
    previous: ReadonlyMap<string, T>,
    found: Map<string, T>,
): Map<string, T> {
    for (const [id, gallery] of found) {
        const before = previous.get(id);
        if (before && before.length === gallery.length && before.every((ev, i) => ev === gallery[i])) {
            found.set(id, before);
        }
    }
    return found;
}

const DIAG_PREFIX = "[intercom-diag] ";
// What was written already, so that a run is written when it changes and not with every render
const written = new Map<string, string>();
const WRITTEN_MAX = 200;

/**
 * Writes one `gallery_decision` record per run of pictures to the diagnostics log, the first time
 * the run is seen and whenever what was decided about it changes. A record holds event types,
 * msgtypes, MIME types, field names, time gaps and counts: no text, file name, URL, user or ID.
 *
 * @param keys - for each decision a key that is not written, to know its run by (see `decisionKeys`)
 * @param context - what the timeline is shown as: layout, kind of timeline, hidden events shown
 */
export function logGalleryDecisions(
    decisions: readonly GalleryDecision[],
    keys: readonly string[],
    context: Record<string, string | boolean | undefined>,
): void {
    decisions.forEach((decision, i) => {
        try {
            const body = JSON.stringify({ ...context, ...decision });
            const key = keys[i] ?? String(i);
            if (written.get(key) === body) return;
            written.delete(key);
            written.set(key, body);
            if (written.size > WRITTEN_MAX) written.delete(written.keys().next().value!);
            console.log(
                DIAG_PREFIX + JSON.stringify({ type: "gallery_decision", t: Date.now(), ...context, ...decision }),
            );
        } catch {
            // Diagnostics never get in the way of the timeline
        }
    });
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
