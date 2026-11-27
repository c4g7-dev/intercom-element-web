/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * Screen share audio from a PipeWire/PulseAudio sink (Linux).
 *
 * Chromium lists sources as microphones but never the monitor of a sink, so what plays into a sink
 * cannot be picked as a screen share's audio. A `module-remap-source` on the monitor is a source
 * like any other, which is what this makes on request: `pactl load-module module-remap-source
 * master=<sink>.monitor source_name=intercom-share-<sink>`.
 *
 * Everything goes through `pactl` with execFile (no shell) and arguments built from names that were
 * validated and found in pactl's own list. Only modules made here are ever unloaded; a remap of the
 * same monitor that somebody else made is used as it is and left alone.
 */

import { execFile, spawnSync } from "node:child_process";
import { app, ipcMain, type IpcMainInvokeEvent } from "electron";

import { getBrand } from "./build-config.js";
import { logDiagnostics } from "./intercom-diagnostics.js";

/** The prefix of every source InterCom makes, which is also how one left by a crash is recognised. */
export const SHARE_SOURCE_PREFIX = "intercom-share-";
/** What the source is called in a device list, before the sink's own description. */
export const SHARE_DESCRIPTION_PREFIX = "InterCom share: ";

const REMAP_MODULE = "module-remap-source";

/** A sink that could be shared, as the share dialog shows it. */
export interface ShareSink {
    name: string;
    description: string;
    /** The applications playing into it right now. */
    apps: string[];
    /** Whether InterCom itself plays into it: sharing it sends the call back into the call. */
    ownPlayback: boolean;
    /**
     * What the source that already carries this sink's sound is called in a device list, where a
     * remap of its monitor is loaded (the user's own, or one of InterCom's).
     */
    source?: string;
}

export interface ShareSinkList {
    /** False where there is no pactl to ask (not Linux, not installed, no server). */
    supported: boolean;
    sinks: ShareSink[];
}

export interface PreparedShareSource {
    /** The name of the source, as PulseAudio knows it. */
    sourceName: string;
    /** What the source is called in a device list, which is how the web app finds it. */
    description: string;
    /** Whether a source that was already there is used rather than a new one. */
    reused: boolean;
}

/** Runs pactl with the given arguments and resolves with what it printed. */
export type PactlRunner = (args: string[]) => Promise<string>;

interface Sink {
    index: number;
    name: string;
    description: string;
}

interface SinkInput {
    sink: number;
    app: string;
    corked: boolean;
    properties: Record<string, string>;
}

interface Source {
    name: string;
    description: string;
}

interface Module {
    index: number;
    name: string;
    argument: string;
}

/**
 * Whether a string can be a sink name we are willing to put on a command line. PulseAudio and
 * PipeWire node names are made of these characters; anything else (spaces, quotes, `=`) could
 * change the meaning of the module's arguments and is refused.
 */
export function isValidSinkName(name: unknown): name is string {
    return typeof name === "string" && /^[A-Za-z0-9_][A-Za-z0-9_.:@+-]{0,199}$/.test(name);
}

/** The name of the source InterCom makes for a sink. */
export function shareSourceName(sinkName: string): string {
    if (!isValidSinkName(sinkName)) throw new Error("Invalid sink name");
    const sanitized = sinkName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);
    return SHARE_SOURCE_PREFIX + (sanitized || "sink");
}

/**
 * The description of the source InterCom makes for a sink: the sink's own, without anything that
 * means something to the module argument parser (quotes, backslashes, `=`, control characters).
 */
export function shareSourceDescription(sinkDescription: string): string {
    const cleaned = String(sinkDescription)
        // oxlint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001f\u007f"'\\=]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100);
    return SHARE_DESCRIPTION_PREFIX + (cleaned || "sink");
}

/**
 * The arguments of the `pactl load-module` call for a sink. The description is quoted twice: once
 * for the module's arguments and once for the property list inside, which is the one form that
 * PulseAudio and pipewire-pulse both read as a value with spaces in it.
 */
export function loadModuleArgs(sinkName: string, sinkDescription: string): string[] {
    if (!isValidSinkName(sinkName)) throw new Error("Invalid sink name");
    return [
        "load-module",
        REMAP_MODULE,
        `master=${sinkName}.monitor`,
        `source_name=${shareSourceName(sinkName)}`,
        `source_properties="device.description='${shareSourceDescription(sinkDescription)}'"`,
    ];
}

/** The arguments of the `pactl unload-module` call for a module index. */
export function unloadModuleArgs(index: number): string[] {
    if (!Number.isSafeInteger(index) || index < 0) throw new Error("Invalid module index");
    return ["unload-module", String(index)];
}

function parseJsonArray(json: string): Record<string, unknown>[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        throw new Error("pactl did not answer in JSON");
    }
    if (!Array.isArray(parsed)) throw new Error("pactl did not answer with a list");
    return parsed.filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null);
}

function stringProperties(value: unknown): Record<string, string> {
    const properties: Record<string, string> = {};
    if (typeof value !== "object" || value === null) return properties;
    for (const [key, item] of Object.entries(value)) {
        if (typeof item === "string") properties[key] = item;
    }
    return properties;
}

/** `pactl -f json list sinks`: the sinks with a name we can use, each name once. */
export function parseSinks(json: string): Sink[] {
    const sinks = new Map<string, Sink>();
    for (const entry of parseJsonArray(json)) {
        const { index, name, description } = entry;
        if (typeof index !== "number" || !isValidSinkName(name) || sinks.has(name)) continue;
        sinks.set(name, {
            index,
            name,
            description: typeof description === "string" && description.trim() ? description.trim() : name,
        });
    }
    return [...sinks.values()];
}

/** `pactl -f json list sink-inputs`: what plays into which sink. */
export function parseSinkInputs(json: string): SinkInput[] {
    const inputs: SinkInput[] = [];
    for (const entry of parseJsonArray(json)) {
        if (typeof entry.sink !== "number") continue;
        const properties = stringProperties(entry.properties);
        const app =
            properties["application.name"] ||
            properties["application.process.binary"] ||
            properties["node.name"] ||
            properties["media.name"] ||
            "";
        inputs.push({ sink: entry.sink, app: app.slice(0, 80), corked: entry.corked === true, properties });
    }
    return inputs;
}

/** `pactl -f json list sources`. */
export function parseSources(json: string): Source[] {
    const sources: Source[] = [];
    for (const entry of parseJsonArray(json)) {
        if (typeof entry.name !== "string") continue;
        sources.push({
            name: entry.name,
            description: typeof entry.description === "string" && entry.description ? entry.description : entry.name,
        });
    }
    return sources;
}

/**
 * `pactl list short modules`: index, name and argument separated by tabs. (The JSON form of the
 * module list leaves the index out, and the index is what a module is unloaded by.)
 */
export function parseShortModules(text: string): Module[] {
    const modules: Module[] = [];
    for (const line of text.split("\n")) {
        const [index, name, argument = ""] = line.split("\t");
        if (!/^\d+$/.test(index ?? "") || !name) continue;
        modules.push({ index: Number(index), name, argument });
    }
    return modules;
}

/** The `key=value` pairs of a module's argument, with or without quotes around a value. */
export function parseModuleArgument(argument: string): Record<string, string> {
    const args: Record<string, string> = {};
    const pair = /([A-Za-z0-9_.]+)=(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S*))/g;
    for (const match of argument.matchAll(pair)) {
        args[match[1]] = match[2] ?? match[3] ?? match[4] ?? "";
    }
    return args;
}

/** Whether a sink input is InterCom's own playback. */
export function isOwnPlayback(properties: Record<string, string>, appNames: string[]): boolean {
    const own = appNames.map((name) => name.toLowerCase());
    return [properties["application.name"], properties["application.process.binary"]].some(
        (value) => value !== undefined && own.includes(value.toLowerCase()),
    );
}

/**
 * The sinks as the share dialog shows them: with what is playing into each and, given the loaded
 * modules and the sources, the source that already carries each one's sound.
 */
export function describeSinks(
    sinks: Sink[],
    inputs: SinkInput[],
    appNames: string[],
    modules: Module[] = [],
    sources: Source[] = [],
): ShareSink[] {
    return sinks.map((sink) => {
        const remap = findRemapOf(modules, sink.name);
        const source = remap && sources.find((s) => s.name === remap.sourceName)?.description;
        const into = inputs.filter((input) => input.sink === sink.index);
        const apps = new Set<string>();
        for (const input of into) {
            // A paused stream is not something that would be heard
            if (!input.corked && input.app) apps.add(input.app);
        }
        return {
            name: sink.name,
            description: sink.description,
            apps: [...apps].slice(0, 16),
            ownPlayback: into.some((input) => isOwnPlayback(input.properties, appNames)),
            ...(source !== undefined && { source }),
        };
    });
}

/** The remap of a sink's monitor among the loaded modules, if there is one. */
export function findRemapOf(modules: Module[], sinkName: string): { index: number; sourceName: string } | undefined {
    for (const module of modules) {
        if (module.name !== REMAP_MODULE) continue;
        const args = parseModuleArgument(module.argument);
        if (args.master === `${sinkName}.monitor` && args.source_name) {
            return { index: module.index, sourceName: args.source_name };
        }
    }
    return undefined;
}

/** Whether a loaded module is one InterCom made, by what it is and what its source is called. */
export function isOwnModule(module: Module | undefined): boolean {
    if (module?.name !== REMAP_MODULE) return false;
    return (parseModuleArgument(module.argument).source_name ?? "").startsWith(SHARE_SOURCE_PREFIX);
}

function isMissingPactl(e: unknown): boolean {
    return typeof e === "object" && e !== null && (e as NodeJS.ErrnoException).code === "ENOENT";
}

const sleep = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Options {
    /** The names InterCom's own playback goes by (application name, binary). */
    appNames: string[];
    platform?: NodeJS.Platform;
    log?: (type: string, fields: Record<string, string | number | boolean | string[]>) => void;
    /** How long to wait for a new source to show up, in steps of 100 ms. */
    waitSteps?: number;
}

/**
 * The sinks that can be shared and the sources made for the share that is on: one per sink that
 * had none, as a share can mix several.
 */
export class ShareAudio {
    /** The modules to unload when the share is over, by the sink each is for. Only ever our own. */
    private readonly owned = new Map<string, number>();
    private queue: Promise<unknown> = Promise.resolve();
    private readonly platform: NodeJS.Platform;

    public constructor(
        private readonly pactl: PactlRunner,
        private readonly options: Options,
    ) {
        this.platform = options.platform ?? process.platform;
    }

    /** The module indexes that a release would unload. */
    public get ownedModules(): number[] {
        return [...this.owned.values()];
    }

    private log(type: string, fields: Record<string, string | number | boolean | string[]> = {}): void {
        this.options.log?.(type, fields);
    }

    /** One operation at a time: two prepares at once would both load a module. */
    private async serial<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.queue.then(operation, operation);
        this.queue = result.catch(() => undefined);
        return result;
    }

    public async listSinks(): Promise<ShareSinkList> {
        if (this.platform !== "linux") return { supported: false, sinks: [] };
        try {
            const [sinks, inputs, modules, sources] = await Promise.all([
                this.pactl(["-f", "json", "list", "sinks"]),
                this.pactl(["-f", "json", "list", "sink-inputs"]),
                this.pactl(["list", "short", "modules"]),
                this.pactl(["-f", "json", "list", "sources"]),
            ]);
            return {
                supported: true,
                sinks: describeSinks(
                    parseSinks(sinks),
                    parseSinkInputs(inputs),
                    this.options.appNames,
                    parseShortModules(modules),
                    parseSources(sources),
                ),
            };
        } catch (e) {
            this.log("share_audio_unavailable", {
                reason: isMissingPactl(e) ? "no pactl" : String((e as Error)?.message ?? e).slice(0, 200),
            });
            return { supported: false, sinks: [] };
        }
    }

    /**
     * Makes sure there is a source for what plays into a sink and says what it is called.
     * @throws if the sink is not one pactl lists, or the module could not be loaded
     */
    public async prepare(sinkName: unknown): Promise<PreparedShareSource> {
        return this.serial(async () => {
            try {
                const prepared = await this.prepareNow(sinkName);
                this.log("share_audio_prepared", {
                    source: prepared.sourceName,
                    reused: prepared.reused,
                });
                return prepared;
            } catch (e) {
                this.log("share_audio_prepare_failed", { error: String((e as Error)?.message ?? e).slice(0, 200) });
                throw e;
            }
        });
    }

    private async prepareNow(sinkName: unknown): Promise<PreparedShareSource> {
        if (this.platform !== "linux") throw new Error("Sharing a sink is only possible on Linux");
        if (!isValidSinkName(sinkName)) throw new Error("Invalid sink name");
        const sink = parseSinks(await this.pactl(["-f", "json", "list", "sinks"])).find((s) => s.name === sinkName);
        if (!sink) throw new Error("No such sink");

        const modules = parseShortModules(await this.pactl(["list", "short", "modules"]));
        const existing = findRemapOf(modules, sink.name);
        if (existing) {
            const sources = parseSources(await this.pactl(["-f", "json", "list", "sources"]));
            const source = sources.find((s) => s.name === existing.sourceName);
            if (source) {
                // One of ours, left by a run that did not get to clean up, is ours to unload again.
                // Anybody else's is only borrowed.
                if (existing.sourceName.startsWith(SHARE_SOURCE_PREFIX)) this.owned.set(sink.name, existing.index);
                return { sourceName: source.name, description: source.description, reused: true };
            }
        }

        const printed = await this.pactl(loadModuleArgs(sink.name, sink.description));
        const index = Number(printed.trim());
        if (!/^\d+$/.test(printed.trim()) || !Number.isSafeInteger(index)) {
            throw new Error("pactl did not say which module it loaded");
        }
        this.owned.set(sink.name, index);

        const sourceName = shareSourceName(sink.name);
        for (let step = 0; step < (this.options.waitSteps ?? 30); step++) {
            const sources = parseSources(await this.pactl(["-f", "json", "list", "sources"]));
            const source = sources.find((s) => s.name === sourceName);
            if (source) return { sourceName, description: source.description, reused: false };
            await sleep(100);
        }
        await this.releaseNow(sink.name);
        throw new Error("The source for the sink did not appear");
    }

    /**
     * Unloads what was made for the share: for one sink, or for all of them. Never throws.
     * @param sinkName - the sink whose source is no longer listened to; all of them without one
     */
    public async release(sinkName?: unknown): Promise<void> {
        return this.serial(async () => this.releaseNow(typeof sinkName === "string" ? sinkName : undefined));
    }

    private async releaseNow(sinkName?: string): Promise<void> {
        const entries = [...this.owned].filter(([sink]) => sinkName === undefined || sink === sinkName);
        if (entries.length === 0) return;
        let modules: Module[] | undefined;
        try {
            modules = parseShortModules(await this.pactl(["list", "short", "modules"]));
        } catch {
            // Without the list there is no telling whether an index is still ours: leave it be
        }
        for (const [sink, index] of entries) {
            this.owned.delete(sink);
            // The server may have restarted and given the index to something else since
            if (!isOwnModule(modules?.find((module) => module.index === index))) continue;
            try {
                await this.pactl(unloadModuleArgs(index));
                this.log("share_audio_released", { module: index });
            } catch (e) {
                this.log("share_audio_release_failed", {
                    module: index,
                    error: String((e as Error)?.message ?? e).slice(0, 200),
                });
            }
        }
    }

    /**
     * Unloads what was made for the share without waiting for anything, for when the app quits.
     * @param run - runs pactl synchronously
     */
    public releaseSync(run: (args: string[]) => void = runPactlSync): void {
        for (const index of this.owned.values()) {
            try {
                run(unloadModuleArgs(index));
            } catch {
                // Quitting anyway
            }
        }
        this.owned.clear();
    }
}

const PACTL_ENV = { ...process.env, LC_ALL: "C" };

/** Runs the system's pactl: no shell, a timeout, and an output large enough for a long sink list. */
export const runPactl: PactlRunner = async (args) =>
    new Promise((resolve, reject) => {
        execFile(
            "pactl",
            args,
            { timeout: 5000, maxBuffer: 16 * 1024 * 1024, env: PACTL_ENV, windowsHide: true },
            (error, stdout) => {
                if (error) reject(error);
                else resolve(stdout);
            },
        );
    });

function runPactlSync(args: string[]): void {
    spawnSync("pactl", args, { timeout: 1500, env: PACTL_ENV, stdio: "ignore", windowsHide: true });
}

/** The IPC channel of the preload's `intercomShareAudio` calls. */
export const SHARE_AUDIO_CHANNEL = "intercomShareAudio";

export type ShareAudioCommand = "listSinks" | "prepareShareSource" | "releaseShareSource";

/**
 * Answers the web app's share audio calls and lets go of the share's source when the app quits or
 * the page that asked for it goes away. Only the main frame of the main window is answered: the
 * call widget reaches this through the web app, which decides whether it may.
 */
export function initShareAudio(shareAudio?: ShareAudio): ShareAudio {
    const audio =
        shareAudio ??
        new ShareAudio(runPactl, {
            appNames: [...new Set([app.getName(), getBrand(), "InterCom", "intercom"])],
            log: logDiagnostics,
        });

    ipcMain.handle(SHARE_AUDIO_CHANNEL, async (ev: IpcMainInvokeEvent, command: unknown, arg?: unknown) => {
        const mainFrame = global.mainWindow?.webContents.mainFrame;
        if (!mainFrame || ev.senderFrame !== mainFrame) throw new Error("Not allowed");
        switch (command) {
            case "listSinks":
                return audio.listSinks();
            case "prepareShareSource":
                return audio.prepare(arg);
            case "releaseShareSource":
                return audio.release(arg);
            default:
                throw new Error("Unknown share audio command");
        }
    });

    app.on("will-quit", () => audio.releaseSync());
    app.on("web-contents-created", (_ev, webContents) => {
        // A page that reloads or crashes cannot say that its share is over
        const release = (): void => {
            if (webContents === global.mainWindow?.webContents) void audio.release();
        };
        webContents.on("render-process-gone", release);
        webContents.on("did-navigate", release);
    });
    return audio;
}
