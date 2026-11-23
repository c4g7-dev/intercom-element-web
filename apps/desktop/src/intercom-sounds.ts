/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * The user's own sound cues.
 *
 * A file named after a cue in `<profile>/sounds/` (on Linux `~/.config/InterCom/sounds/`, on
 * Windows `%APPDATA%\InterCom\sounds\`) is played instead of the built-in sound: `join`, `leave`,
 * `mute`, `unmute`, `deafen` and `undeafen`, as `.ogg`, `.mp3` or `.wav`, 2 MB at most. The files
 * are read when the web app asks for them, which it does when it starts, and handed to it as
 * they are. Nothing else is done with them: they are not copied, not uploaded and not logged; the
 * diagnostics log gets the names of the files that were taken and of those that were not.
 */

import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

import { logDiagnostics } from "./intercom-diagnostics.js";

export const SOUNDS_CHANNEL = "intercomSounds";

/** The cues a file can be given for. */
export const SOUND_CUES = ["join", "leave", "mute", "unmute", "deafen", "undeafen"] as const;
export type SoundCue = (typeof SOUND_CUES)[number];

/** The kinds of file that are taken, the preferred one first, with what the web app is told they are. */
export const SOUND_TYPES: Record<string, string> = {
    ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
};

/** The largest file that is taken. A cue is a second of sound; this is room to spare. */
export const MAX_SOUND_BYTES = 2 * 1024 * 1024;

/** What is known of an entry of the sounds directory before it is read. */
export interface SoundDirEntry {
    name: string;
    size: number;
    isFile: boolean;
}

/** One of the user's sounds, as the web app gets it. */
export interface CustomSound {
    /** The file's name, without its directory */
    name: string;
    /** Its MIME type, from the extension */
    type: string;
    /** The file, in base64 */
    data: string;
}

export type CustomSounds = Partial<Record<SoundCue, CustomSound>>;

/** A file that is named like a cue's and is not played, and why. */
export interface SkippedSound {
    name: string;
    reason: "not_a_file" | "empty" | "too_large" | "other_format_used";
}

function cueOf(fileName: string): { cue: SoundCue; extension: string } | undefined {
    const extension = path.extname(fileName).toLowerCase();
    const base = fileName.slice(0, fileName.length - extension.length).toLowerCase();
    if (!(extension in SOUND_TYPES)) return undefined;
    if (!(SOUND_CUES as readonly string[]).includes(base)) return undefined;
    return { cue: base as SoundCue, extension };
}

/**
 * Chooses the files of a sounds directory that are played: for every cue the one file that is
 * named after it, a regular file of a known kind and not too large. Of several for one cue the
 * `.ogg` wins, then the `.mp3`, then the `.wav`. Files that are named like a cue's and are not
 * taken come back with the reason; everything else in the directory is nobody's business.
 */
export function pickSoundFiles(entries: SoundDirEntry[]): {
    picked: Partial<Record<SoundCue, string>>;
    skipped: SkippedSound[];
} {
    const picked: Partial<Record<SoundCue, string>> = {};
    const skipped: SkippedSound[] = [];
    const order = Object.keys(SOUND_TYPES);
    const candidates = entries
        .map((entry) => ({ entry, match: cueOf(entry.name) }))
        .filter((candidate): candidate is { entry: SoundDirEntry; match: NonNullable<ReturnType<typeof cueOf>> } =>
            Boolean(candidate.match),
        )
        .sort(
            (a, b) =>
                order.indexOf(a.match.extension) - order.indexOf(b.match.extension) ||
                a.entry.name.localeCompare(b.entry.name),
        );
    for (const { entry, match } of candidates) {
        if (!entry.isFile) skipped.push({ name: entry.name, reason: "not_a_file" });
        else if (entry.size <= 0) skipped.push({ name: entry.name, reason: "empty" });
        else if (entry.size > MAX_SOUND_BYTES) skipped.push({ name: entry.name, reason: "too_large" });
        else if (picked[match.cue] !== undefined) skipped.push({ name: entry.name, reason: "other_format_used" });
        else picked[match.cue] = entry.name;
    }
    return { picked, skipped };
}

/** The part of the file system that reading a sounds directory needs. */
export interface SoundsFs {
    readdir(dir: string): Promise<string[]>;
    stat(file: string): Promise<{ size: number; isFile(): boolean }>;
    readFile(file: string): Promise<Buffer>;
}

/**
 * Reads the user's sounds from a directory. A directory that is not there is no sounds, and a
 * file that cannot be read is left out.
 */
export async function readCustomSounds(
    dir: string,
    io: SoundsFs = fs,
    log: (type: string, fields: Record<string, unknown>) => void = () => {},
): Promise<CustomSounds> {
    let names: string[];
    try {
        names = await io.readdir(dir);
    } catch {
        return {};
    }
    const entries: SoundDirEntry[] = [];
    for (const name of names) {
        // Only what is named like a cue's file is looked at at all
        if (!cueOf(name)) continue;
        try {
            const stat = await io.stat(path.join(dir, name));
            entries.push({ name, size: stat.size, isFile: stat.isFile() });
        } catch {
            entries.push({ name, size: 0, isFile: false });
        }
    }
    const { picked, skipped } = pickSoundFiles(entries);
    const sounds: CustomSounds = {};
    for (const cue of SOUND_CUES) {
        const name = picked[cue];
        if (name === undefined) continue;
        try {
            const data = await io.readFile(path.join(dir, name));
            // It may have grown since it was looked at
            if (data.length === 0 || data.length > MAX_SOUND_BYTES) {
                skipped.push({ name, reason: data.length === 0 ? "empty" : "too_large" });
                continue;
            }
            sounds[cue] = {
                name,
                type: SOUND_TYPES[path.extname(name).toLowerCase()],
                data: data.toString("base64"),
            };
        } catch {
            skipped.push({ name, reason: "not_a_file" });
        }
    }
    if (entries.length > 0) {
        log("sound_pack", {
            files: SOUND_CUES.flatMap((cue) => (sounds[cue] ? [sounds[cue].name] : [])),
            skipped: skipped.map(({ name, reason }) => `${name}: ${reason}`),
        });
    }
    return sounds;
}

/** Where the user's sounds are looked for. */
export function getSoundsDir(): string {
    return path.join(app.getPath("userData"), "sounds");
}

/** Lets the web app ask for the user's sounds. */
export function initSounds(): void {
    ipcMain.handle(SOUNDS_CHANNEL, async (ev: IpcMainInvokeEvent, command: unknown) => {
        const mainFrame = global.mainWindow?.webContents.mainFrame;
        if (!mainFrame || ev.senderFrame !== mainFrame) throw new Error("Not allowed");
        if (command !== "list") throw new Error("Unknown sounds command");
        return readCustomSounds(getSoundsDir(), fs, logDiagnostics);
    });
}
