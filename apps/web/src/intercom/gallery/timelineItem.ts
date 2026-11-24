/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import type { TimelineItem } from "@element-hq/web-shared-components";
import type { MatrixEvent } from "matrix-js-sdk/src/matrix";

/**
 * An event row of the new room timeline (labs "feature_new_timeline"). The row of the first
 * picture of a gallery carries all of the gallery's pictures; the others have no row of their own.
 */
export type GalleryEventTimelineItem = Extract<TimelineItem, { kind: "event" }> & {
    gallery?: readonly MatrixEvent[];
};

/** The gallery a row stands for, if it is the row of the first picture of one. */
export function galleryOfItem(item: TimelineItem): readonly MatrixEvent[] | undefined {
    return item.kind === "event" ? (item as GalleryEventTimelineItem).gallery : undefined;
}
