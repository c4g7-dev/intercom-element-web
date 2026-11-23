/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import { createContext, type ReactNode } from "react";

/**
 * What the application shows under a room in the room list, if anything: InterCom lists the
 * people in a voice room's call there. The room is the application's own room object.
 */
export type RoomListItemExtrasRenderer = (room: unknown) => ReactNode;

/** Provided by the application around the room list; without it nothing is shown under a room. */
export const RoomListItemExtrasContext = createContext<RoomListItemExtrasRenderer | undefined>(undefined);
