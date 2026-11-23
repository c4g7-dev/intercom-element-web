/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it } from "vitest";

import {
    formatBytes,
    initialUpdaterMachine,
    isWorking,
    SpeedMeter,
    UPDATER_LOG_LINES,
    type UpdaterEvent,
    type UpdaterMachine,
    updaterTransition,
} from "./intercom-updater-state.js";

const VERSION = "1.12.35-intercom.7";
const URL = "https://github.com/c4g7-dev/InterCom/releases/tag/v1.12.35-intercom.7";
const found = { version: VERSION, releaseUrl: URL };

/** Sends the events one after the other, a second apart from 1000. */
function run(events: UpdaterEvent[], from: UpdaterMachine = initialUpdaterMachine()): UpdaterMachine {
    return events.reduce((state, event, i) => updaterTransition(state, event, 1000 * (i + 1)), from);
}

describe("the updater's state machine", () => {
    it("goes from idle through the check, the download, the checksum and the unpacking to ready and installing", () => {
        const phases: string[] = [];
        let state = initialUpdaterMachine();
        const events: UpdaterEvent[] = [
            { type: "check" },
            { type: "download", ...found, total: 186_000_000 },
            { type: "progress", done: 78_000_000, total: 186_000_000, bytesPerSecond: 12_000_000 },
            { type: "verify" },
            { type: "unpack" },
            { type: "ready" },
            { type: "install" },
        ];
        events.forEach((event, i) => {
            state = updaterTransition(state, event, 1000 * (i + 1));
            phases.push(state.phase);
        });
        expect(phases).toEqual([
            "checking",
            "downloading",
            "downloading",
            "verifying",
            "unpacking",
            "ready",
            "installing",
        ]);
        expect(state).toMatchObject({ latestVersion: VERSION, releaseUrl: URL, lastChecked: 2000 });
        expect(state.progress).toBeUndefined();
        expect(state.log.map((line) => line.text)).toEqual([
            "Checking for updates…",
            `Found ${VERSION}`,
            `Downloading ${VERSION} · 41 % · 78 MB / 186 MB · 12 MB/s`,
            "Verifying checksum…",
            "Unpacking…",
            `${VERSION} is ready: restart to update`,
            "Installing and restarting…",
        ]);
        expect(state.log.map((line) => line.t)).toEqual([1000, 2000, 3000, 4000, 5000, 6000, 7000]);
    });

    it("is ready without unpacking where the download is the installer (Windows)", () => {
        const state = run([{ type: "check" }, { type: "download", ...found }, { type: "verify" }, { type: "ready" }]);
        expect(state.phase).toBe("ready");
    });

    it("tells how far the download is", () => {
        const state = run([
            { type: "check" },
            { type: "download", ...found, total: 200 },
            { type: "progress", done: 50, total: 200, bytesPerSecond: 25.4 },
        ]);
        expect(state.progress).toBe(0.25);
        expect(state.download).toEqual({ done: 50, total: 200, bytesPerSecond: 25 });
        // A server that does not say how much there is: the bytes are told, a share is not
        const unknown = run([{ type: "progress", done: 80, total: 0, bytesPerSecond: 0 }], state);
        expect(unknown.download).toEqual({ done: 80, total: 0, bytesPerSecond: 0 });
        expect(unknown.log.at(-1)!.text).toBe(`Downloading ${VERSION} · 80 B`);
    });

    it("keeps one line for a download, and the last ten lines in all", () => {
        let state = run([{ type: "check" }, { type: "download", ...found, total: 1000 }]);
        for (let done = 100; done <= 1000; done += 100) {
            state = updaterTransition(state, { type: "progress", done, total: 1000, bytesPerSecond: 100 }, 5000 + done);
        }
        expect(state.log).toHaveLength(3);
        expect(state.log.at(-1)).toEqual({ t: 6000, text: `Downloading ${VERSION} · 100 % · 1 kB / 1 kB · 100 B/s` });

        for (let i = 0; i < 8; i++) {
            state = run([{ type: "error", message: `failure ${i}` }, { type: "check" }], state);
        }
        expect(state.log).toHaveLength(UPDATER_LOG_LINES);
        expect(state.log.at(-2)!.text).toBe("Error: failure 7");
    });

    it("goes back to idle when there is nothing newer, and forgets the release it knew", () => {
        const manual = run([{ type: "check" }, { type: "manual", ...found }]);
        expect(manual).toMatchObject({ phase: "manual", latestVersion: VERSION, lastChecked: 2000 });
        const state = run([{ type: "check" }, { type: "up_to_date" }], manual);
        expect(state).toMatchObject({ phase: "idle", lastChecked: 2000 });
        expect(state.latestVersion).toBeUndefined();
        expect(state.releaseUrl).toBeUndefined();
    });

    it.each<[string, UpdaterEvent[]]>([
        ["the check", [{ type: "check" }]],
        ["the download", [{ type: "check" }, { type: "download", ...found }]],
        ["the checksum", [{ type: "check" }, { type: "download", ...found }, { type: "verify" }]],
        ["the unpacking", [{ type: "check" }, { type: "download", ...found }, { type: "verify" }, { type: "unpack" }]],
        [
            "the install",
            [
                { type: "check" },
                { type: "download", ...found },
                { type: "verify" },
                { type: "ready" },
                { type: "install" },
            ],
        ],
    ])("shows an error from %s, which a new check clears", (_name, events) => {
        const failed = run([...events, { type: "error", message: "it broke" }]);
        expect(failed).toMatchObject({ phase: "error", error: "it broke" });
        expect(failed.progress).toBeUndefined();
        expect(failed.download).toBeUndefined();
        expect(failed.log.at(-1)!.text).toBe("Error: it broke");

        const again = run([{ type: "check" }], failed);
        expect(again.phase).toBe("checking");
        expect(again.error).toBeUndefined();
    });

    it("only logs a check that nobody asked for and that failed", () => {
        const state = run([{ type: "check" }, { type: "error", message: "offline", quiet: true }]);
        expect(state).toMatchObject({ phase: "idle", lastChecked: 2000 });
        expect(state.error).toBeUndefined();
        expect(state.log.at(-1)!.text).toBe("Check failed: offline");
        // Once there is something to fetch, a failure is shown whoever asked
        const later = run([
            { type: "check" },
            { type: "download", ...found },
            { type: "error", message: "broke", quiet: true },
        ]);
        expect(later.phase).toBe("error");
    });

    it("fetches again a file that was there and is not whole", () => {
        const state = run([
            { type: "check" },
            { type: "download", ...found, total: 10 },
            { type: "verify" },
            { type: "download", ...found, total: 10 },
        ]);
        expect(state.phase).toBe("downloading");
        // The time of the check stays the check's
        expect(state.lastChecked).toBe(2000);
        expect(state.log.filter((line) => line.text.startsWith("Found"))).toHaveLength(1);
    });

    it("leaves out what does not follow", () => {
        const idle = initialUpdaterMachine();
        for (const type of ["up_to_date", "verify", "unpack", "ready", "install"] as const) {
            expect(updaterTransition(idle, { type }, 1)).toBe(idle);
        }
        expect(updaterTransition(idle, { type: "error", message: "x" }, 1)).toBe(idle);
        expect(updaterTransition(idle, { type: "progress", done: 1, total: 2, bytesPerSecond: 1 }, 1)).toBe(idle);

        // A second check while one runs, or while an update waits for the restart, is not started
        const checking = run([{ type: "check" }]);
        expect(updaterTransition(checking, { type: "check" }, 9)).toBe(checking);
        const ready = run([{ type: "download", ...found }, { type: "verify" }, { type: "ready" }], checking);
        expect(updaterTransition(ready, { type: "check" }, 9)).toBe(ready);
        expect(updaterTransition(ready, { type: "up_to_date" }, 9)).toBe(ready);
        const installing = run([{ type: "install" }], ready);
        expect(updaterTransition(installing, { type: "install" }, 9)).toBe(installing);
    });

    it("knows when it is at work", () => {
        expect(
            ["checking", "downloading", "verifying", "unpacking", "installing"].every((p) => isWorking(p as never)),
        ).toBe(true);
        expect(["idle", "ready", "manual", "error"].some((p) => isWorking(p as never))).toBe(false);
    });
});

describe("formatBytes", () => {
    it.each([
        [0, "0 B"],
        [999, "999 B"],
        [1500, "1.5 kB"],
        [78_000_000, "78 MB"],
        [186_400_000, "186 MB"],
        [2_150_000_000, "2.2 GB"],
        [-5, "0 B"],
        [NaN, "0 B"],
    ])("%d is %s", (bytes, text) => {
        expect(formatBytes(bytes)).toBe(text);
    });
});

describe("SpeedMeter", () => {
    it("gives the speed of the last few seconds", () => {
        const meter = new SpeedMeter(3000);
        expect(meter.note(0, 0)).toBe(0);
        expect(meter.note(1000, 1000)).toBe(1000);
        expect(meter.note(2000, 2000)).toBe(1000);
        // Faster now: the slow start falls out of the window
        expect(meter.note(12_000, 3000)).toBe(4000);
        expect(meter.note(22_000, 4000)).toBe(7000);
        expect(meter.note(32_000, 5000)).toBe(10_000);
        // Two notes at the same moment do not divide by zero
        expect(new SpeedMeter().note(5, 7)).toBe(0);
    });
});
