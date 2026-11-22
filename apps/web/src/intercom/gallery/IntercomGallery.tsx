/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type ComponentType, type JSX, useEffect, useMemo, useRef } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

import { _t } from "../../languageHandler";
import { MediaEventHelper } from "../../utils/MediaEventHelper";
import { type RoomPermalinkCreator } from "../../utils/permalinks/Permalinks";
import { GalleryCellContext, GalleryGroupContext, type GalleryCell, type LightboxOpener } from "./GalleryContext";
import { galleryLayout } from "./grouping";

/** What the image body of one cell is given. */
export interface GalleryCellBodyProps {
    mxEvent: MatrixEvent;
    mediaEventHelper?: MediaEventHelper;
    permalinkCreator?: RoomPermalinkCreator;
    maxImageHeight?: number;
}

interface Props {
    /** The pictures, first to last. */
    events: readonly MatrixEvent[];
    /** The media helper the tile made for the first of them. */
    firstMediaEventHelper?: MediaEventHelper;
    permalinkCreator?: RoomPermalinkCreator;
    /** The body that shows one picture. */
    CellBody: ComponentType<GalleryCellBodyProps>;
}

// The height a cell asks its image body for; the cell crops it to its own shape
const CELL_IMAGE_HEIGHT = 360;

/**
 * Media helpers for the pictures after the first, which have no tile of their own to make one.
 * A helper is kept for as long as its event is in the gallery and released with it.
 */
function useMediaEventHelpers(
    events: readonly MatrixEvent[],
    first?: MediaEventHelper,
): (MediaEventHelper | undefined)[] {
    const helpers = useRef(new Map<MatrixEvent, MediaEventHelper>());

    const current = useMemo(() => {
        const wanted = new Set(events.slice(1));
        for (const [event, helper] of helpers.current) {
            if (!wanted.has(event)) {
                helper.destroy();
                helpers.current.delete(event);
            }
        }
        return events.map((event, i) => {
            if (i === 0) return first;
            let helper = helpers.current.get(event);
            if (!helper && MediaEventHelper.isEligible(event)) {
                helper = new MediaEventHelper(event);
                helpers.current.set(event, helper);
            }
            return helper;
        });
    }, [events, first]);

    useEffect(() => {
        const all = helpers.current;
        return (): void => {
            for (const helper of all.values()) helper.destroy();
            all.clear();
        };
    }, []);

    return current;
}

/**
 * Several pictures sent together, as one grid: cropped previews, three to a row, with what does
 * not fill a row shown larger at the top and "+N" on the last cell when there are more than fit.
 * A click opens the lightbox, which then steps through all of them.
 */
export function IntercomGallery({ events, firstMediaEventHelper, permalinkCreator, CellBody }: Props): JSX.Element {
    const helpers = useMediaEventHelpers(events, firstMediaEventHelper);
    const openers = useRef(new Map<string, LightboxOpener>());
    const eventsRef = useRef(events);
    eventsRef.current = events;

    const cell = useMemo<GalleryCell>(() => {
        // Opens the picture at `index`, or the nearest one in `step`'s direction that can be shown
        const open = (index: number, step: number): void => {
            const all = eventsRef.current;
            for (let i = index; i >= 0 && i < all.length; i += step) {
                const id = all[i].getId();
                if (id && openers.current.get(id)?.openLightbox()) return;
            }
        };
        return {
            register: (eventId, opener) => {
                openers.current.set(eventId, opener);
                return () => {
                    if (openers.current.get(eventId) === opener) openers.current.delete(eventId);
                };
            },
            navigationFor: (eventId) => {
                const all = eventsRef.current;
                const index = all.findIndex((event) => event.getId() === eventId);
                if (index < 0) return undefined;
                return {
                    index: index + 1,
                    total: all.length,
                    onPrevious: index > 0 ? (): void => open(index - 1, -1) : undefined,
                    onNext: index < all.length - 1 ? (): void => open(index + 1, 1) : undefined,
                };
            },
        };
    }, []);

    const { visible, spans } = galleryLayout(events.length);
    const hidden = events.length - visible;

    return (
        // Inside the gallery every picture is a body of its own again
        <GalleryGroupContext.Provider value={null}>
            <GalleryCellContext.Provider value={cell}>
                <div
                    className="mx_IntercomGallery"
                    role="group"
                    aria-label={_t("timeline|m.image|gallery_label", { count: events.length })}
                    data-count={visible}
                >
                    {events.map((event, i) => {
                        const shown = i < visible;
                        const more = shown && i === visible - 1 && hidden > 0;
                        return (
                            <div
                                key={event.getTxnId() || event.getId()}
                                className="mx_IntercomGallery_cell"
                                data-span={shown ? spans[i] : undefined}
                                hidden={!shown}
                                data-event-id={event.getId()}
                            >
                                <CellBody
                                    mxEvent={event}
                                    mediaEventHelper={helpers[i]}
                                    permalinkCreator={permalinkCreator}
                                    maxImageHeight={CELL_IMAGE_HEIGHT}
                                />
                                {more && (
                                    <div className="mx_IntercomGallery_more" aria-hidden="true">
                                        +{hidden}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </GalleryCellContext.Provider>
        </GalleryGroupContext.Provider>
    );
}
