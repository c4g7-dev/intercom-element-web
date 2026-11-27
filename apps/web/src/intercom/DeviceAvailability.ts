/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";

/**
 * How a microphone or a camera stands: on, off (muted), or not there to be turned on at all, for
 * want of a device or of the permission to use one. The same four the call tells in its state.
 */
export type DeviceState = "on" | "off" | "no-device" | "no-permission";

/** Why a device cannot be turned on. */
export type DeviceUnavailability = "no-device" | "no-permission";

const DEVICE_STATES = new Set<unknown>(["on", "off", "no-device", "no-permission"]);

/**
 * How a device stands, from what the platform tells. Where the permission cannot be told
 * (`undefined`), a device counts as missing only if none is listed.
 */
export function deviceState(facts: {
    deviceCount: number;
    permission: PermissionState | undefined;
    enabled: boolean;
}): DeviceState {
    if (facts.permission === "denied") return "no-permission";
    if (facts.deviceCount === 0) return "no-device";
    return facts.enabled ? "on" : "off";
}

export function unavailability(state: DeviceState): DeviceUnavailability | undefined {
    return state === "no-device" || state === "no-permission" ? state : undefined;
}

/**
 * Reads the state of a device out of a call's message. A call that does not tell it (an older
 * one) has the device: on or off, as it says the device is enabled.
 */
export function readDeviceState(raw: unknown, enabled: boolean): DeviceState {
    return DEVICE_STATES.has(raw) ? (raw as DeviceState) : enabled ? "on" : "off";
}

export enum DeviceAvailabilityEvent {
    Update = "update",
}

type EventHandlerMap = { [DeviceAvailabilityEvent.Update]: () => void };

interface Platform {
    mediaDevices?: Pick<MediaDevices, "enumerateDevices" | "addEventListener" | "removeEventListener">;
    permissions?: Pick<Permissions, "query">;
}

function browserPlatform(): Platform {
    const nav = typeof navigator === "undefined" ? undefined : navigator;
    return { mediaDevices: nav?.mediaDevices, permissions: nav?.permissions };
}

/**
 * Whether there is a microphone to turn on, as the app can tell by itself: for the user panel
 * while there is no call. A call knows better (it opens the device) and tells in its state, which
 * is what counts while there is one.
 *
 * It looks when something starts listening, and again whenever the devices or the permission
 * change, so a microphone that is plugged in or allowed shows at once.
 */
export class MicrophoneAvailability extends TypedEventEmitter<DeviceAvailabilityEvent, EventHandlerMap> {
    private static internalInstance: MicrophoneAvailability | undefined;

    public static get instance(): MicrophoneAvailability {
        MicrophoneAvailability.internalInstance ??= new MicrophoneAvailability();
        return MicrophoneAvailability.internalInstance;
    }

    private deviceCount: number | undefined;
    private permission: PermissionStatus | undefined;
    private watching = false;
    private current: DeviceUnavailability | undefined;

    public constructor(private readonly platform: Platform = browserPlatform()) {
        super();
    }

    /** Why there is no microphone to turn on; `undefined` while there is one, or it cannot be told. */
    public get unavailable(): DeviceUnavailability | undefined {
        return this.current;
    }

    /** Starts looking, if it does not yet. */
    public watch(): void {
        if (this.watching) return;
        this.watching = true;
        this.platform.mediaDevices?.addEventListener?.("devicechange", this.countDevices);
        this.countDevices();
        this.platform.permissions
            ?.query({ name: "microphone" })
            .then((status) => {
                if (!this.watching) return;
                this.permission = status;
                status.addEventListener("change", this.update);
                this.update();
            })
            // A platform that does not know the name: it cannot be told
            .catch(() => undefined);
    }

    public stop(): void {
        this.watching = false;
        this.platform.mediaDevices?.removeEventListener?.("devicechange", this.countDevices);
        this.permission?.removeEventListener("change", this.update);
        this.permission = undefined;
    }

    private readonly countDevices = (): void => {
        const mediaDevices = this.platform.mediaDevices;
        if (typeof mediaDevices?.enumerateDevices !== "function") return;
        mediaDevices
            .enumerateDevices()
            .then((devices) => {
                if (!this.watching) return;
                this.deviceCount = devices.filter((device) => device.kind === "audioinput").length;
                this.update();
            })
            .catch(() => undefined);
    };

    private readonly update = (): void => {
        const next = unavailability(
            deviceState({
                // Not counted (yet, or ever): not known to be missing
                deviceCount: this.deviceCount ?? 1,
                permission: this.permission?.state,
                enabled: false,
            }),
        );
        if (next === this.current) return;
        this.current = next;
        this.emit(DeviceAvailabilityEvent.Update);
    };
}
