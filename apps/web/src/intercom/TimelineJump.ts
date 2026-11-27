/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type ActionPayload } from "../dispatcher/payloads";

/**
 * Asks the labs "New timeline" of a room to jump, from the room's keyboard shortcuts: RoomView
 * handles the keys, but the new timeline keeps its scrolling to itself (there is no TimelinePanel
 * for RoomView to call), so it listens for this instead.
 */
export const INTERCOM_TIMELINE_JUMP = "intercom_timeline_jump";

/** Payload of {@link INTERCOM_TIMELINE_JUMP}. */
export interface TimelineJumpPayload extends ActionPayload {
    action: typeof INTERCOM_TIMELINE_JUMP;
    /** The room whose timeline should jump */
    roomId: string;
    /**
     * - `present`: Escape, "Dismiss read marker and jump to bottom": marks everything read and
     *   jumps to the newest messages
     * - `read_marker`: Shift+Page Up, "Jump to oldest unread message"
     */
    to: "present" | "read_marker";
}
