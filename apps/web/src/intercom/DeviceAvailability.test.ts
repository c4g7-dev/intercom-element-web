/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";

import {
    DeviceAvailabilityEvent,
    type DeviceState,
    deviceState,
    MicrophoneAvailability,
    readDeviceState,
    unavailability,
} from "./DeviceAvailability";

describe("deviceState", () => {
    it.each<[number, PermissionState | undefined, boolean, DeviceState]>([
        [1, "granted", true, "on"],
        [1, "granted", false, "off"],
        [2, "prompt", false, "off"],
        [1, undefined, true, "on"],
        [0, "granted", false, "no-device"],
        [0, "prompt", false, "no-device"],
        [0, undefined, false, "no-device"],
        [1, "denied", false, "no-permission"],
        [0, "denied", true, "no-permission"],
    ])("%i device(s), permission %s, enabled %s: %s", (deviceCount, permission, enabled, expected) => {
        expect(deviceState({ deviceCount, permission, enabled })).toBe(expected);
    });

    it("names why a device cannot be turned on", () => {
        expect(unavailability("on")).toBeUndefined();
        expect(unavailability("off")).toBeUndefined();
        expect(unavailability("no-device")).toBe("no-device");
        expect(unavailability("no-permission")).toBe("no-permission");
    });
});

describe("readDeviceState", () => {
    it("reads the four states", () => {
        for (const state of ["on", "off", "no-device", "no-permission"]) {
            expect(readDeviceState(state, false)).toBe(state);
        }
    });

    it.each([undefined, null, "broken", 1, {}])("has the device there where %j is told", (raw) => {
        expect(readDeviceState(raw, true)).toBe("on");
        expect(readDeviceState(raw, false)).toBe("off");
    });
});

/** Lets the promises of the fake platform settle */
const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
};

class FakePermissionStatus extends EventTarget {
    public constructor(public state: PermissionState) {
        super();
    }
    public change(state: PermissionState): void {
        this.state = state;
        this.dispatchEvent(new Event("change"));
    }
}

class FakeMediaDevices extends EventTarget {
    public devices: Pick<MediaDeviceInfo, "kind">[] = [];
    public enumerateDevices = vi.fn(async () => this.devices as MediaDeviceInfo[]);
    public plug(...kinds: MediaDeviceKind[]): void {
        this.devices = kinds.map((kind) => ({ kind }));
        this.dispatchEvent(new Event("devicechange"));
    }
}

describe("MicrophoneAvailability", () => {
    function setUp(
        kinds: MediaDeviceKind[],
        permission: PermissionState = "granted",
    ): {
        mediaDevices: FakeMediaDevices;
        status: FakePermissionStatus;
        query: ReturnType<typeof vi.fn>;
        microphone: MicrophoneAvailability;
        onUpdate: ReturnType<typeof vi.fn>;
    } {
        const mediaDevices = new FakeMediaDevices();
        mediaDevices.devices = kinds.map((kind) => ({ kind }));
        const status = new FakePermissionStatus(permission);
        const query = vi.fn().mockResolvedValue(status);
        const microphone = new MicrophoneAvailability({
            mediaDevices: mediaDevices as unknown as MediaDevices,
            permissions: { query },
        });
        const onUpdate = vi.fn();
        microphone.on(DeviceAvailabilityEvent.Update, onUpdate);
        return { mediaDevices, status, query, microphone, onUpdate };
    }

    it("says nothing before it has looked, and does not look before it is asked to", async () => {
        const { mediaDevices, microphone } = setUp([]);
        await settle();
        expect(microphone.unavailable).toBeUndefined();
        expect(mediaDevices.enumerateDevices).not.toHaveBeenCalled();
    });

    it("finds a microphone among the devices, and only a microphone", async () => {
        const { microphone, mediaDevices, query, onUpdate } = setUp(["audiooutput", "videoinput"]);
        microphone.watch();
        microphone.watch();
        await settle();
        expect(query).toHaveBeenCalledTimes(1);
        expect(query).toHaveBeenCalledWith({ name: "microphone" });
        expect(microphone.unavailable).toBe("no-device");
        expect(onUpdate).toHaveBeenCalledTimes(1);

        // One is plugged in, and pulled out again
        mediaDevices.plug("audiooutput", "audioinput");
        await settle();
        expect(microphone.unavailable).toBeUndefined();
        mediaDevices.plug("audiooutput");
        await settle();
        expect(microphone.unavailable).toBe("no-device");
        expect(onUpdate).toHaveBeenCalledTimes(3);
        microphone.stop();
    });

    it("says when the microphone is blocked, and when it no longer is", async () => {
        const { microphone, status, onUpdate } = setUp(["audioinput"], "denied");
        microphone.watch();
        await settle();
        expect(microphone.unavailable).toBe("no-permission");
        status.change("granted");
        expect(microphone.unavailable).toBeUndefined();
        // Nothing to tell where nothing changed
        status.change("prompt");
        expect(onUpdate).toHaveBeenCalledTimes(2);
        microphone.stop();
    });

    it("stops looking when stopped", async () => {
        const { microphone, mediaDevices, status, onUpdate } = setUp(["audioinput"]);
        microphone.watch();
        await settle();
        microphone.stop();
        mediaDevices.plug();
        status.change("denied");
        await settle();
        expect(microphone.unavailable).toBeUndefined();
        expect(onUpdate).not.toHaveBeenCalled();
    });

    it.each([
        ["no way to list devices or ask for the permission", {}],
        [
            "a platform that refuses both",
            {
                mediaDevices: {
                    enumerateDevices: vi.fn().mockRejectedValue(new Error("no")),
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                },
                permissions: { query: vi.fn().mockRejectedValue(new TypeError("no such name")) },
            },
        ],
    ])("has the microphone there with %s: it cannot be told", async (_, platform) => {
        const microphone = new MicrophoneAvailability(
            platform as ConstructorParameters<typeof MicrophoneAvailability>[0],
        );
        microphone.watch();
        await settle();
        expect(microphone.unavailable).toBeUndefined();
        microphone.stop();
    });
});
