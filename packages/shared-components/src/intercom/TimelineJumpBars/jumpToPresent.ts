/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

/**
 * How many viewport heights above the newest message the reader has to be before the timeline
 * says they are viewing older messages. Less than that is "a little", and gets the small arrow.
 */
export const FAR_FROM_PRESENT_SCREENS = 1.5;

/**
 * What the timeline offers to get back to the newest messages:
 * - `hidden`: nothing, the newest message is in view
 * - `near`: a small arrow, the reader has scrolled up a little
 * - `far`: the bar "You're viewing older messages" with "Jump to present", the reader is far back
 *   or the newest messages are not loaded at all
 */
export type JumpToPresentMode = "hidden" | "near" | "far";

/**
 * Whether the reader is far from the newest message: more than {@link FAR_FROM_PRESENT_SCREENS}
 * viewport heights above the end of the list.
 *
 * @param distanceFromBottom - how far the bottom of the viewport is above the end of the list, in pixels
 * @param viewportHeight - the height of the viewport, in pixels
 */
export function isFarFromPresent(distanceFromBottom: number, viewportHeight: number): boolean {
    return viewportHeight > 0 && distanceFromBottom > FAR_FROM_PRESENT_SCREENS * viewportHeight;
}

/**
 * What to offer to get back to the newest messages (see {@link JumpToPresentMode}).
 *
 * @param liveEndLoaded - whether the newest messages of the room are loaded: the list cannot be
 *   paginated forwards. When they are not, the reader is far back however the list is scrolled.
 * @param atBottom - whether the list is scrolled to its end
 * @param far - whether the reader is far from the end of the list, see {@link isFarFromPresent}
 */
export function jumpToPresentMode(liveEndLoaded: boolean, atBottom: boolean, far: boolean): JumpToPresentMode {
    if (!liveEndLoaded) return "far";
    if (atBottom) return "hidden";
    return far ? "far" : "near";
}
