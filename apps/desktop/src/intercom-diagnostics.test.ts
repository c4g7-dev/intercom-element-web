/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { type DownloadItem } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    consoleMessageToRecord,
    DiagnosticsLog,
    handleSnapshotDownload,
    logFileStamp,
    pruneLogs,
    redactSecrets,
    snapshotSavePath,
    summariseGpuInfo,
} from "./intercom-diagnostics.js";

let userData: string;

vi.mock("electron", () => ({
    app: {
        getPath: vi.fn((): string => userData),
    },
    shell: { openPath: vi.fn() },
}));

let dir: string;
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "intercom-diag-test-"));
    userData = dir;
});
afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date(2026, 10, 22, 9, 5, 7);

function lines(file: string): unknown[] {
    return fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

describe("logFileStamp", () => {
    it("should be the local date and time, zero padded", () => {
        expect(logFileStamp(NOW)).toBe("20261122-090507");
    });
});

describe("redactSecrets", () => {
    it.each([
        [
            "GET https://hs.example/_matrix/x?access_token=syt_abc123456789_def",
            "GET https://hs.example/_matrix/x?<query>",
        ],
        ["Authorization: Bearer abcDEF123456.xyz", "Authorization: Bearer <token>"],
        ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sflKxwRJSMeKKF2QT4 ok", "jwt <jwt> ok"],
        ['{"token":"abcd1234efgh","user":"@a:b"}', '{"token":"<redacted>","user":"@a:b"}'],
        ["password=hunter22 next", "password=<redacted> next"],
        ["using syt_dXNlcg_abcdefghijkl_1a2b3c here", "using <token> here"],
        ["nothing secret here: 1920x1080 at 30 fps", "nothing secret here: 1920x1080 at 30 fps"],
    ])("should redact %s", (input, expected) => {
        expect(redactSecrets(input)).toBe(expected);
    });

    it("should cut very long lines", () => {
        expect(redactSecrets("x ".repeat(5000))).toHaveLength(2000);
    });
});

describe("consoleMessageToRecord", () => {
    it("should unwrap a diagnostics line and add the wall clock and the window", () => {
        const record = consoleMessageToRecord(
            {
                message: '[intercom-diag] {"v":1,"t":5,"seq":2,"type":"mute","source":"microphone","enabled":false}',
                level: "info",
            },
            "main",
            NOW,
        );
        expect(record).toEqual({
            wall: NOW.toISOString(),
            window: "main",
            v: 1,
            t: 5,
            seq: 2,
            type: "mute",
            source: "microphone",
            enabled: false,
        });
    });

    it("should keep a diagnostics line it cannot parse as text", () => {
        expect(consoleMessageToRecord({ message: "[intercom-diag] {oops", level: "info" }, "main", NOW)).toEqual({
            wall: NOW.toISOString(),
            window: "main",
            type: "diag_unparsed",
            text: "{oops",
        });
    });

    it("should record warnings and errors of any frame, redacted, with where they came from", () => {
        expect(
            consoleMessageToRecord(
                {
                    message: "Failed with token=abcdef123456",
                    level: "error",
                    lineNumber: 12,
                    sourceId: "vector://vector/webapp/bundle.js?v=1",
                    frame: { url: "vector://vector/webapp/widgets/element-call/index.html?parentUrl=x#/?password=y" },
                },
                "intercom-popout-x",
                NOW,
            ),
        ).toEqual({
            wall: NOW.toISOString(),
            window: "intercom-popout-x",
            type: "console",
            level: "error",
            text: "Failed with token=<redacted>",
            source: "vector://vector/webapp/bundle.js:12",
            frame: "vector://vector/webapp/widgets/element-call/index.html",
        });
    });

    it("should ignore ordinary log output", () => {
        expect(consoleMessageToRecord({ message: "hello", level: "info" }, "main")).toBeUndefined();
        expect(consoleMessageToRecord({ message: "hello", level: "debug" }, "main")).toBeUndefined();
    });
});

describe("DiagnosticsLog", () => {
    it("should write one JSON line per record into a file named after the start time", () => {
        const log = new DiagnosticsLog(path.join(dir, "logs"), NOW);
        log.append({ type: "a", n: 1 });
        log.append({ type: "b", text: "line\nbreak" });
        log.close();
        expect(log.path).toBe(path.join(dir, "logs", "diag-20261122-090507.jsonl"));
        expect(lines(log.path)).toEqual([
            { type: "a", n: 1 },
            { type: "b", text: "line\nbreak" },
        ]);
    });

    it("should begin a new file at the size limit and delete the oldest beyond the total", () => {
        const log = new DiagnosticsLog(dir, NOW, 400, 150);
        const record = { type: "x", pad: "p".repeat(80) };
        for (let i = 0; i < 12; i++) log.append({ ...record, i });
        log.close();
        const files = fs.readdirSync(dir);
        // One record fits a file here, so twelve were begun and only the newest are left
        expect(files).toContain("diag-20261122-090507-11.jsonl");
        expect(files).not.toContain("diag-20261122-090507.jsonl");
        expect(files.length).toBeLessThan(5);
        const total = files.reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0);
        expect(total).toBeLessThanOrEqual(400);
        expect(lines(log.path)).toEqual([{ ...record, i: 11 }]);
    });

    it("should not throw once closed", () => {
        const log = new DiagnosticsLog(dir, NOW);
        log.close();
        expect(() => log.append({ type: "late" })).not.toThrow();
    });
});

describe("pruneLogs", () => {
    it("should delete the oldest diagnostics logs first and nothing else", () => {
        const make = (name: string, size: number, age: number): string => {
            const file = path.join(dir, name);
            fs.writeFileSync(file, "x".repeat(size));
            const time = new Date(Date.now() - age * 1000);
            fs.utimesSync(file, time, time);
            return file;
        };
        const oldest = make("diag-1.jsonl", 100, 300);
        const middle = make("diag-2.jsonl", 100, 200);
        const newest = make("diag-3.jsonl", 100, 100);
        const other = make("notes.txt", 1000, 400);

        expect(pruneLogs(dir, 250)).toEqual([oldest]);
        expect(fs.existsSync(middle)).toBe(true);
        expect(fs.existsSync(other)).toBe(true);
        // The file being written is never the one to go
        expect(pruneLogs(dir, 50, middle)).toEqual([newest]);
        expect(fs.existsSync(middle)).toBe(true);
    });

    it("should cope with a folder that is not there", () => {
        expect(pruneLogs(path.join(dir, "missing"), 1)).toEqual([]);
    });
});

describe("snapshots", () => {
    it("should file a snapshot under the time and the participant", () => {
        expect(
            snapshotSavePath("intercom-snapshot-_alice_example.org_DEV.png", "blob:vector://vector/1-2", dir, NOW),
        ).toBe(path.join(dir, "snapshots", "20261122-090507-_alice_example.org_DEV.png"));
    });

    it.each([
        ["report.png", "blob:vector://vector/1"],
        ["intercom-snapshot-a.png", "https://evil.example/intercom-snapshot-a.png"],
        ["intercom-snapshot-a.exe", "blob:vector://vector/1"],
        ["intercom-snapshot-..png", "blob:vector://vector/1"],
        ["intercom-snapshot-a/b.png", "blob:vector://vector/1"],
        ["intercom-snapshot-.png", "blob:vector://vector/1"],
    ])("should leave %s from %s to the ordinary download path", (filename, url) => {
        expect(snapshotSavePath(filename, url, dir, NOW)).toBeUndefined();
    });

    it("should save a snapshot download without a dialog, and only that", () => {
        const item = {
            getFilename: vi.fn().mockReturnValue("intercom-snapshot-bob.png"),
            getURL: vi.fn().mockReturnValue("blob:vector://vector/abc"),
            setSavePath: vi.fn(),
            once: vi.fn(),
        };
        expect(handleSnapshotDownload(item as unknown as DownloadItem)).toBe(true);
        const savePath = item.setSavePath.mock.calls[0][0] as string;
        expect(path.dirname(savePath)).toBe(path.join(dir, "logs", "snapshots"));
        expect(path.basename(savePath)).toMatch(/^\d{8}-\d{6}-bob\.png$/);
        expect(fs.existsSync(path.dirname(savePath))).toBe(true);

        item.getFilename.mockReturnValue("holiday.png");
        item.setSavePath.mockClear();
        expect(handleSnapshotDownload(item as unknown as DownloadItem)).toBe(false);
        expect(item.setSavePath).not.toHaveBeenCalled();
    });
});

describe("summariseGpuInfo", () => {
    it("should keep the devices and the renderer", () => {
        expect(
            summariseGpuInfo({
                gpuDevice: [
                    {
                        active: true,
                        vendorId: 4318,
                        deviceId: 9479,
                        driverVendor: "Nvidia",
                        driverVersion: "580",
                        extra: "x",
                    },
                ],
                auxAttributes: { glRenderer: "ANGLE (NVIDIA)", somethingLong: "y" },
            }),
        ).toMatchObject({
            devices: [{ active: true, vendorId: 4318, deviceId: 9479, driverVendor: "Nvidia", driverVersion: "580" }],
            glRenderer: "ANGLE (NVIDIA)",
        });
        expect(summariseGpuInfo(null)).toEqual({});
    });
});
