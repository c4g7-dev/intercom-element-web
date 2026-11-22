/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { createContext } from "react";
import { type MatrixEvent } from "matrix-js-sdk/src/matrix";

/**
 * The gallery an event tile stands for: set around the tile of the first picture of a gallery,
 * whose image body then shows all of them.
 */
export const GalleryGroupContext = createContext<readonly MatrixEvent[] | null>(null);

/** Moving between the pictures of a gallery in the lightbox. */
export interface LightboxNavigation {
    /** Shows the picture before this one; absent on the first. */
    onPrevious?: () => void;
    /** Shows the picture after this one; absent on the last. */
    onNext?: () => void;
    /** Place of the picture in its gallery, from 1. */
    index: number;
    total: number;
}

/** Something that can show its picture in the lightbox: the view model of an image body. */
export interface LightboxOpener {
    /** @returns false when there is nothing to show yet */
    openLightbox(): boolean;
}

/** What a gallery gives the image body of each of its cells. */
export interface GalleryCell {
    /** @returns the function that takes the registration back */
    register(eventId: string, opener: LightboxOpener): () => void;
    navigationFor(eventId: string): LightboxNavigation | undefined;
}

export const GalleryCellContext = createContext<GalleryCell | null>(null);
