/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { logger } from "matrix-js-sdk/src/logger";

import { type Call } from "../models/Call";
import { CallStore, CallStoreEvent } from "../stores/CallStore";

/** As much of a call as the rule needs. */
type SwitchableCall = Pick<Call, "roomId" | "connected" | "disconnect">;

/**
 * The calls to leave when the user joins the call of a room: every other call they are
 * connected to. The user is in one call at a time, as in one voice channel at a time.
 * @param connectedCalls - the calls the user is connected to
 * @param joiningRoomId - the room whose call is being joined
 */
export function callsToLeave<C extends Pick<Call, "roomId" | "connected">>(
    connectedCalls: Iterable<C>,
    joiningRoomId: string,
): C[] {
    return [...connectedCalls].filter((call) => call.roomId !== joiningRoomId && call.connected);
}

/**
 * Leaves every call but the one of the room given, and resolves once they are left. A call that
 * cannot be left is logged and passed over: it must not keep the user out of the next one.
 * @param joiningRoomId - the room whose call is being joined
 * @param connectedCalls - the calls the user is connected to (default: the call store's)
 * @returns the IDs of the rooms whose calls were asked to end
 */
export async function leaveOtherCalls(
    joiningRoomId: string,
    connectedCalls: Iterable<SwitchableCall> = CallStore.instance.connectedCalls,
): Promise<string[]> {
    const leaving = callsToLeave(connectedCalls, joiningRoomId);
    await Promise.all(
        leaving.map(async (call) => {
            try {
                await call.disconnect();
            } catch (e) {
                logger.warn(`InterCom: could not leave the call in ${call.roomId} for the one in ${joiningRoomId}`, e);
            }
        }),
    );
    return leaving.map((call) => call.roomId);
}

/**
 * Keeps the user in one call: when they are connected to a call, the calls they were in before
 * are left. This is what makes a click on another voice channel a switch, and it also covers a
 * call joined from its lobby.
 */
export class VoiceSwitcher {
    private callStore?: CallStore;

    public static sharedInstance(): VoiceSwitcher {
        window.mxIntercomVoiceSwitcher ??= new VoiceSwitcher();
        return window.mxIntercomVoiceSwitcher;
    }

    public start(callStore: CallStore): void {
        this.stop();
        this.callStore = callStore;
        callStore.on(CallStoreEvent.ConnectedCalls, this.onConnectedCalls);
    }

    public stop(): void {
        this.callStore?.off(CallStoreEvent.ConnectedCalls, this.onConnectedCalls);
        this.callStore = undefined;
    }

    private readonly onConnectedCalls = (now: Set<Call>, before: Set<Call>): void => {
        // The call that was joined last stays; with two at once (which no path leads to), the last of them
        const joined = [...now].reverse().find((call) => !before.has(call));
        if (joined) void leaveOtherCalls(joined.roomId, now);
    };
}
