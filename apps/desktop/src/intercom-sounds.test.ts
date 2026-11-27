/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { describe, expect, it, vi } from "vitest";

import { MAX_SOUND_BYTES, pickSoundFiles, readCustomSounds, type SoundsFs } from "./intercom-sounds.js";

vi.mock("electron", () => ({
    app: { getPath: () => "/profile" },
    ipcMain: { handle: vi.fn() },
}));
vi.mock("./intercom-diagnostics.js", () => ({ logDiagnostics: vi.fn() }));

const file = (name: string, size = 1000, isFile = true): { name: string; size: number; isFile: boolean } => ({
    name,
    size,
    isFile,
});

describe("pickSoundFiles", () => {
    it("takes the files that are named after a cue", () => {
        const { picked, skipped } = pickSoundFiles([
            file("join.ogg"),
            file("leave.mp3"),
            file("mute.wav"),
            file("unmute.ogg"),
            file("deafen.ogg"),
            file("undeafen.ogg"),
            file("ringtone.mp3"),
            file("ringback.ogg"),
        ]);
        expect(picked).toEqual({
            join: "join.ogg",
            leave: "leave.mp3",
            mute: "mute.wav",
            unmute: "unmute.ogg",
            deafen: "deafen.ogg",
            undeafen: "undeafen.ogg",
            ringtone: "ringtone.mp3",
            ringback: "ringback.ogg",
        });
        expect(skipped).toEqual([]);
    });

    it("does not mind the case of a name", () => {
        expect(pickSoundFiles([file("Join.OGG")]).picked).toEqual({ join: "Join.OGG" });
    });

    it("leaves everything else alone, without a word", () => {
        const result = pickSoundFiles([
            file("ring.ogg"),
            file("join.flac"),
            file("join.ogg.bak"),
            file("join"),
            file("notes.txt"),
            file("../join.ogg"),
            file("joinx.ogg"),
        ]);
        expect(result).toEqual({ picked: {}, skipped: [] });
    });

    it("prefers ogg to mp3 to wav", () => {
        const { picked, skipped } = pickSoundFiles([file("join.wav"), file("join.mp3"), file("join.ogg")]);
        expect(picked).toEqual({ join: "join.ogg" });
        expect(skipped).toEqual([
            { name: "join.mp3", reason: "other_format_used" },
            { name: "join.wav", reason: "other_format_used" },
        ]);
    });

    it("falls back to the next format when the preferred file is no good", () => {
        const { picked, skipped } = pickSoundFiles([file("join.ogg", MAX_SOUND_BYTES + 1), file("join.mp3")]);
        expect(picked).toEqual({ join: "join.mp3" });
        expect(skipped).toEqual([{ name: "join.ogg", reason: "too_large" }]);
    });

    it("skips directories, empty files and files over the limit", () => {
        const { picked, skipped } = pickSoundFiles([
            file("join.ogg", 1000, false),
            file("leave.ogg", 0),
            file("mute.ogg", MAX_SOUND_BYTES + 1),
            file("unmute.ogg", MAX_SOUND_BYTES),
        ]);
        expect(picked).toEqual({ unmute: "unmute.ogg" });
        expect(skipped).toEqual([
            { name: "join.ogg", reason: "not_a_file" },
            { name: "leave.ogg", reason: "empty" },
            { name: "mute.ogg", reason: "too_large" },
        ]);
    });
});

describe("readCustomSounds", () => {
    function fakeFs(files: Record<string, Buffer | "dir">): SoundsFs & { read: string[]; stated: string[] } {
        const read: string[] = [];
        const stated: string[] = [];
        return {
            read,
            stated,
            readdir: async () => Object.keys(files),
            stat: async (path) => {
                stated.push(path);
                const content = files[path.replace("/sounds/", "")];
                return { size: content === "dir" ? 4096 : content.length, isFile: () => content !== "dir" };
            },
            readFile: async (path) => {
                read.push(path);
                const content = files[path.replace("/sounds/", "")];
                if (content === "dir") throw new Error("EISDIR");
                return content;
            },
        };
    }

    it("has no sounds without the directory", async () => {
        const io: SoundsFs = {
            readdir: async () => {
                throw new Error("ENOENT");
            },
            stat: async () => {
                throw new Error("not reached");
            },
            readFile: async () => {
                throw new Error("not reached");
            },
        };
        await expect(readCustomSounds("/sounds", io)).resolves.toEqual({});
    });

    it("hands over the files named after cues, and touches no other file", async () => {
        const io = fakeFs({
            "join.ogg": Buffer.from("OggS-join"),
            "leave.wav": Buffer.from("RIFF-leave"),
            "ringtone.ogg": Buffer.from("OggS-ringtone"),
            "secret.txt": Buffer.from("not a sound"),
            "mute.ogg": "dir",
        });
        const log = vi.fn();
        const sounds = await readCustomSounds("/sounds", io, log);
        expect(sounds).toEqual({
            join: { name: "join.ogg", type: "audio/ogg", data: Buffer.from("OggS-join").toString("base64") },
            leave: { name: "leave.wav", type: "audio/wav", data: Buffer.from("RIFF-leave").toString("base64") },
            ringtone: {
                name: "ringtone.ogg",
                type: "audio/ogg",
                data: Buffer.from("OggS-ringtone").toString("base64"),
            },
        });
        expect(io.read).toEqual(["/sounds/join.ogg", "/sounds/leave.wav", "/sounds/ringtone.ogg"]);
        expect(io.stated).not.toContain("/sounds/secret.txt");
        // The log has names, never what is in a file
        expect(log).toHaveBeenCalledWith("sound_pack", {
            files: ["join.ogg", "leave.wav", "ringtone.ogg"],
            skipped: ["mute.ogg: not_a_file"],
        });
        expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    });

    it("leaves out a file that grew past the limit before it was read", async () => {
        const io = fakeFs({ "join.ogg": Buffer.alloc(10) });
        io.readFile = async () => Buffer.alloc(MAX_SOUND_BYTES + 1);
        await expect(readCustomSounds("/sounds", io)).resolves.toEqual({});
    });

    it("says nothing when there is nothing named like a sound", async () => {
        const log = vi.fn();
        await readCustomSounds("/sounds", fakeFs({ "readme.txt": Buffer.from("x") }), log);
        expect(log).not.toHaveBeenCalled();
    });
});
