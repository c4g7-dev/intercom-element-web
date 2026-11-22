/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { beforeEach, describe, expect, it, vi } from "vitest";
import { app, ipcMain } from "electron";

import {
    describeSinks,
    findRemapOf,
    initShareAudio,
    isOwnModule,
    isValidSinkName,
    loadModuleArgs,
    parseModuleArgument,
    parseShortModules,
    parseSinkInputs,
    parseSinks,
    parseSources,
    ShareAudio,
    shareSourceDescription,
    shareSourceName,
    unloadModuleArgs,
} from "./intercom-share-audio.js";

vi.mock("electron", () => ({
    app: { getName: vi.fn().mockReturnValue("InterCom"), on: vi.fn() },
    ipcMain: { handle: vi.fn() },
}));
vi.mock("./intercom-diagnostics.js", () => ({ logDiagnostics: vi.fn() }));

// What pactl 17 on PipeWire 1.6 prints, cut down to a few entries
const SINKS = JSON.stringify([
    { index: 32, name: "virtual-discord", description: "Virtual Discord", monitor_source: "virtual-discord.monitor" },
    { index: 34, name: "virtual-music", description: "Virtual Music", monitor_source: "virtual-music.monitor" },
    { index: 56, name: "virtual-discord-screen", description: "Virtual Discord Screen" },
    { index: 109, name: "alsa_output.usb-Yamaha_UR22C-00.pro-output-0", description: "Steinberg UR22C Pro" },
    { index: 75810, name: "netaudio-live", description: "NetAudio Live" },
    { index: 112716, name: "netaudio-live", description: "NetAudio Live" },
    { index: 7, name: 'evil" master=other', description: "Evil" },
    { index: 8, name: "no-description" },
    "nonsense",
]);
const SINK_INPUTS = JSON.stringify([
    { index: 388, sink: 34, corked: true, properties: { "media.name": "quickshell", "node.name": "quickshell" } },
    {
        index: 34684,
        sink: 34,
        corked: false,
        properties: { "application.name": "Spotify", "application.process.binary": "spotify" },
    },
    { index: 142079, sink: 34, corked: false, properties: { "application.name": "mpv", "media.name": "a.mp4" } },
    { index: 142080, sink: 34, corked: false, properties: { "application.name": "mpv", "media.name": "b.mp4" } },
    {
        index: 146119,
        sink: 32,
        corked: false,
        properties: { "application.name": "InterCom", "application.process.binary": "intercom" },
    },
    { index: 5, corked: false, properties: {} },
]);
const USER_MODULE =
    "536870916\tmodule-remap-source\tmaster=virtual-discord-screen.monitor source_name=intercom-screen source_properties=device.description=InterCom-Screen-Audio\t";
const source = (name: string, description: string): object => ({ index: 1, name, description });

describe("isValidSinkName", () => {
    it.each(["virtual-music", "alsa_output.usb-Yamaha_UR22C-00.pro-output-0", "bluez_output.5C_D3_3D_C0_E0_93.1"])(
        "accepts %s",
        (name) => expect(isValidSinkName(name)).toBe(true),
    );
    it.each([
        "",
        "a b",
        "a=b",
        'a"b',
        "a'b",
        "a;b",
        "a\nb",
        "a\\b",
        "$(reboot)",
        "-f",
        "--help",
        ".monitor",
        "a".repeat(201),
        7,
        null,
        undefined,
        {},
    ])("refuses %j", (name) => expect(isValidSinkName(name)).toBe(false));
});

describe("load-module arguments", () => {
    it("names the source after the sink", () => {
        expect(shareSourceName("virtual-music")).toBe("intercom-share-virtual-music");
        expect(shareSourceName("alsa_output.usb-Yamaha_UR22C-00.pro-output-0")).toBe(
            "intercom-share-alsa-output-usb-yamaha-ur22c-00-pro-output-0",
        );
        expect(shareSourceName("___")).toBe("intercom-share-sink");
        expect(() => shareSourceName("a b")).toThrow();
    });

    it("takes everything the argument parser reads out of a description", () => {
        expect(shareSourceDescription("Virtual Music")).toBe("InterCom share: Virtual Music");
        expect(shareSourceDescription(`A "quoted" 'name' with \\ and = and\nnewline`)).toBe(
            "InterCom share: A quoted name with and and newline",
        );
        expect(shareSourceDescription("")).toBe("InterCom share: sink");
        expect(shareSourceDescription("x".repeat(500)).length).toBeLessThanOrEqual(116);
    });

    it("builds one argument per module argument, no shell syntax", () => {
        expect(loadModuleArgs("virtual-music", "Virtual Music")).toEqual([
            "load-module",
            "module-remap-source",
            "master=virtual-music.monitor",
            "source_name=intercom-share-virtual-music",
            `source_properties="device.description='InterCom share: Virtual Music'"`,
        ]);
    });

    it("cannot be made to add a module argument", () => {
        expect(() => loadModuleArgs("x master=y", "d")).toThrow("Invalid sink name");
        const args = loadModuleArgs("virtual-music", `x'" master=evil source_name=evil`);
        expect(args).toHaveLength(5);
        expect(args[4]).toBe(`source_properties="device.description='InterCom share: x master evil source_name evil'"`);
    });

    it("unloads by a whole, positive number only", () => {
        expect(unloadModuleArgs(536870917)).toEqual(["unload-module", "536870917"]);
        for (const index of [-1, 1.5, NaN, Infinity]) expect(() => unloadModuleArgs(index)).toThrow();
    });
});

describe("parsing pactl", () => {
    it("reads the sinks, each name once, without names it would not use", () => {
        expect(parseSinks(SINKS).map((s) => [s.index, s.name, s.description])).toEqual([
            [32, "virtual-discord", "Virtual Discord"],
            [34, "virtual-music", "Virtual Music"],
            [56, "virtual-discord-screen", "Virtual Discord Screen"],
            [109, "alsa_output.usb-Yamaha_UR22C-00.pro-output-0", "Steinberg UR22C Pro"],
            [75810, "netaudio-live", "NetAudio Live"],
            [8, "no-description", "no-description"],
        ]);
    });

    it("refuses what is not a JSON list", () => {
        expect(() => parseSinks("Connection failure: Connection refused")).toThrow();
        expect(() => parseSinks("{}")).toThrow();
        expect(parseSinks("[]")).toEqual([]);
    });

    it("reads what plays into which sink", () => {
        const inputs = parseSinkInputs(SINK_INPUTS);
        expect(inputs.map((i) => [i.sink, i.app, i.corked])).toEqual([
            [34, "quickshell", true],
            [34, "Spotify", false],
            [34, "mpv", false],
            [34, "mpv", false],
            [32, "InterCom", false],
        ]);
    });

    it("describes the sinks: playing apps once each, paused ones left out, own playback flagged", () => {
        const sinks = describeSinks(parseSinks(SINKS), parseSinkInputs(SINK_INPUTS), ["InterCom"]);
        expect(sinks[0]).toEqual({
            name: "virtual-discord",
            description: "Virtual Discord",
            apps: ["InterCom"],
            ownPlayback: true,
        });
        expect(sinks[1]).toEqual({
            name: "virtual-music",
            description: "Virtual Music",
            apps: ["Spotify", "mpv"],
            ownPlayback: false,
        });
        expect(sinks[2].apps).toEqual([]);
    });

    it("knows its own playback by the binary too, whatever the case", () => {
        const inputs = parseSinkInputs(
            JSON.stringify([{ sink: 32, properties: { "application.process.binary": "intercom" } }]),
        );
        expect(describeSinks(parseSinks(SINKS), inputs, ["InterCom"])[0].ownPlayback).toBe(true);
    });

    it("reads sources and the short module list", () => {
        expect(
            parseSources(JSON.stringify([source("intercom-screen", "InterCom-Screen-Audio"), { index: 2 }])),
        ).toEqual([{ name: "intercom-screen", description: "InterCom-Screen-Audio" }]);
        expect(parseShortModules(`1\tlibpipewire-module-rt\t{\n  nice.level = -11\n}\t\n${USER_MODULE}\n`)).toEqual([
            { index: 1, name: "libpipewire-module-rt", argument: "{" },
            {
                index: 536870916,
                name: "module-remap-source",
                argument:
                    "master=virtual-discord-screen.monitor source_name=intercom-screen source_properties=device.description=InterCom-Screen-Audio",
            },
        ]);
    });

    it("reads a module's arguments, quoted or not", () => {
        expect(
            parseModuleArgument(
                `master=virtual-music.monitor source_name=intercom-share-virtual-music source_properties="device.description='InterCom share: Virtual Music'"`,
            ),
        ).toEqual({
            master: "virtual-music.monitor",
            source_name: "intercom-share-virtual-music",
            source_properties: "device.description='InterCom share: Virtual Music'",
        });
    });

    it("finds the remap of a sink's monitor and knows whose it is", () => {
        const modules = parseShortModules(
            `${USER_MODULE}\n9\tmodule-remap-source\tmaster=virtual-music.monitor source_name=intercom-share-virtual-music\t\n10\tmodule-null-sink\tsink_name=intercom-share-x\t`,
        );
        expect(findRemapOf(modules, "virtual-discord-screen")).toEqual({
            index: 536870916,
            sourceName: "intercom-screen",
        });
        expect(findRemapOf(modules, "virtual-discord")).toBeUndefined();
        expect(isOwnModule(modules[0])).toBe(false);
        expect(isOwnModule(modules[1])).toBe(true);
        expect(isOwnModule(modules[2])).toBe(false);
        expect(isOwnModule(undefined)).toBe(false);
    });
});

/** A pactl that keeps modules and sources the way the server does. */
function fakePactl(initialModules = USER_MODULE): {
    run: ReturnType<typeof vi.fn<(args: string[]) => Promise<string>>>;
    modules: Map<number, string>;
    calls: () => string[];
} {
    const modules = new Map<number, string>();
    for (const line of initialModules.split("\n").filter(Boolean)) {
        const [index, , argument] = line.split("\t");
        modules.set(Number(index), argument);
    }
    let next = 536870917;
    const run = vi.fn(async (args: string[]): Promise<string> => {
        const command = args.join(" ");
        if (command === "-f json list sinks") return SINKS;
        if (command === "-f json list sink-inputs") return SINK_INPUTS;
        if (command === "list short modules") {
            return [...modules].map(([index, argument]) => `${index}\tmodule-remap-source\t${argument}\t`).join("\n");
        }
        if (command === "-f json list sources") {
            return JSON.stringify(
                [...modules.values()].map((argument) => {
                    const name = /source_name=(\S+)/.exec(argument)![1];
                    const description = /device\.description='?([^'"]+)/.exec(argument)?.[1] ?? name;
                    return source(name, description);
                }),
            );
        }
        if (args[0] === "load-module") {
            modules.set(next, args.slice(2).join(" "));
            return `${next++}\n`;
        }
        if (args[0] === "unload-module") {
            if (!modules.delete(Number(args[1]))) throw new Error("No such module");
            return "";
        }
        throw new Error(`unexpected pactl ${command}`);
    });
    return { run, modules, calls: () => run.mock.calls.map(([args]) => args.join(" ")) };
}

describe("ShareAudio", () => {
    const options = { appNames: ["InterCom"], platform: "linux" as const, waitSteps: 2 };

    it("lists the sinks", async () => {
        const { run } = fakePactl();
        const list = await new ShareAudio(run, options).listSinks();
        expect(list.supported).toBe(true);
        expect(list.sinks.map((s) => s.name)).toContain("virtual-music");
    });

    it("is unsupported off Linux, without ever running pactl", async () => {
        const { run } = fakePactl();
        const audio = new ShareAudio(run, { ...options, platform: "win32" });
        expect(await audio.listSinks()).toEqual({ supported: false, sinks: [] });
        await expect(audio.prepare("virtual-music")).rejects.toThrow();
        expect(run).not.toHaveBeenCalled();
    });

    it("is unsupported where pactl is missing or has no server, and says so in the log", async () => {
        const log = vi.fn();
        const missing = Object.assign(new Error("spawn pactl ENOENT"), { code: "ENOENT" });
        const audio = new ShareAudio(vi.fn().mockRejectedValue(missing), { ...options, log });
        expect(await audio.listSinks()).toEqual({ supported: false, sinks: [] });
        expect(log).toHaveBeenCalledWith("share_audio_unavailable", { reason: "no pactl" });
    });

    it("loads a remap of the sink's monitor and reports the source's description", async () => {
        const { run, modules } = fakePactl();
        const log = vi.fn();
        const audio = new ShareAudio(run, { ...options, log });
        expect(await audio.prepare("virtual-music")).toEqual({
            sourceName: "intercom-share-virtual-music",
            description: "InterCom share: Virtual Music",
            reused: false,
        });
        expect(run).toHaveBeenCalledWith(loadModuleArgs("virtual-music", "Virtual Music"));
        expect(audio.ownedModules).toEqual([536870917]);
        expect(modules.size).toBe(2);
        expect(log).toHaveBeenCalledWith("share_audio_prepared", {
            source: "intercom-share-virtual-music",
            reused: false,
        });
    });

    it("uses the user's own remap of the same monitor and never unloads it", async () => {
        const { run, modules, calls } = fakePactl();
        const audio = new ShareAudio(run, options);
        expect(await audio.prepare("virtual-discord-screen")).toEqual({
            sourceName: "intercom-screen",
            description: "InterCom-Screen-Audio",
            reused: true,
        });
        expect(audio.ownedModules).toEqual([]);
        await audio.release();
        audio.releaseSync(run as unknown as (args: string[]) => void);
        expect(modules.has(536870916)).toBe(true);
        expect(calls().some((c) => c.startsWith("load-module") || c.startsWith("unload-module"))).toBe(false);
    });

    it("takes over a source of its own that an earlier run left behind", async () => {
        const { run, modules } = fakePactl(
            `${USER_MODULE}\n77\tmodule-remap-source\tmaster=virtual-music.monitor source_name=intercom-share-virtual-music\t`,
        );
        const audio = new ShareAudio(run, options);
        expect((await audio.prepare("virtual-music")).reused).toBe(true);
        expect(audio.ownedModules).toEqual([77]);
        await audio.release();
        expect([...modules.keys()]).toEqual([536870916]);
    });

    it("unloads only what it loaded, on release", async () => {
        const { run, modules, calls } = fakePactl();
        const audio = new ShareAudio(run, options);
        await audio.prepare("virtual-music");
        await audio.release();
        expect([...modules.keys()]).toEqual([536870916]);
        expect(calls().filter((c) => c.startsWith("unload-module"))).toEqual(["unload-module 536870917"]);
        expect(audio.ownedModules).toEqual([]);
        // Nothing left to do the second time
        await audio.release();
        expect(calls().filter((c) => c.startsWith("unload-module"))).toHaveLength(1);
    });

    it("keeps a source per sink for a mix, loads none twice and releases one or all", async () => {
        const { run, modules } = fakePactl();
        const audio = new ShareAudio(run, options);
        await audio.prepare("virtual-music");
        expect((await audio.prepare("virtual-music")).reused).toBe(true);
        expect(audio.ownedModules).toEqual([536870917]);
        await audio.prepare("virtual-discord");
        await audio.prepare("virtual-discord-screen");
        expect(audio.ownedModules).toEqual([536870917, 536870918]);
        expect([...modules.keys()]).toEqual([536870916, 536870917, 536870918]);

        // Taken out of the mix: only that sink's source goes
        await audio.release("virtual-music");
        expect([...modules.keys()]).toEqual([536870916, 536870918]);
        // A sink that only borrowed the user's remap has nothing to unload
        await audio.release("virtual-discord-screen");
        expect([...modules.keys()]).toEqual([536870916, 536870918]);
        await audio.release();
        expect([...modules.keys()]).toEqual([536870916]);
        expect(audio.ownedModules).toEqual([]);
    });

    it("says which source already carries a sink's sound", async () => {
        const { run } = fakePactl();
        const audio = new ShareAudio(run, options);
        const byName = async (): Promise<Record<string, string | undefined>> =>
            Object.fromEntries((await audio.listSinks()).sinks.map((s) => [s.name, s.source]));
        expect(await byName()).toMatchObject({
            "virtual-discord-screen": "InterCom-Screen-Audio",
            "virtual-music": undefined,
        });
        await audio.prepare("virtual-music");
        expect((await byName())["virtual-music"]).toBe("InterCom share: Virtual Music");
    });

    it("loads one module for two requests made at once", async () => {
        const { run, calls } = fakePactl();
        const audio = new ShareAudio(run, options);
        await Promise.all([audio.prepare("virtual-music"), audio.prepare("virtual-music")]);
        expect(calls().filter((c) => c.startsWith("load-module"))).toHaveLength(1);
    });

    it("does not unload an index that is no longer its module", async () => {
        const { run, modules, calls } = fakePactl();
        const audio = new ShareAudio(run, options);
        await audio.prepare("virtual-music");
        // The server restarted: the index now belongs to something of the user's
        modules.set(536870917, "master=virtual-music.monitor source_name=mine");
        await audio.release();
        expect(calls().some((c) => c.startsWith("unload-module"))).toBe(false);
        expect(modules.has(536870917)).toBe(true);
    });

    it.each(["nope", "virtual-music.monitor", "a b", 'x" master=y', "", 5, null])(
        "refuses the sink %j without loading anything",
        async (name) => {
            const { run, calls } = fakePactl();
            const log = vi.fn();
            await expect(new ShareAudio(run, { ...options, log }).prepare(name)).rejects.toThrow();
            expect(calls().some((c) => c.startsWith("load-module"))).toBe(false);
            expect(log).toHaveBeenCalledWith("share_audio_prepare_failed", expect.anything());
        },
    );

    it("unloads again when the source never appears", async () => {
        const { run, modules } = fakePactl();
        const real = run.getMockImplementation()!;
        run.mockImplementation(async (args) => (args.join(" ") === "-f json list sources" ? "[]" : real(args)));
        await expect(new ShareAudio(run, options).prepare("virtual-music")).rejects.toThrow("did not appear");
        expect([...modules.keys()]).toEqual([536870916]);
    });

    it("unloads synchronously when the app quits", async () => {
        const { run } = fakePactl();
        const audio = new ShareAudio(run, options);
        await audio.prepare("virtual-music");
        const sync = vi.fn();
        audio.releaseSync(sync);
        expect(sync.mock.calls).toEqual([[["unload-module", "536870917"]]]);
        expect(audio.ownedModules).toEqual([]);
    });
});

describe("initShareAudio", () => {
    beforeEach(() => vi.clearAllMocks());

    it("answers the main frame of the main window only", async () => {
        const { run } = fakePactl();
        const audio = initShareAudio(new ShareAudio(run, { appNames: ["InterCom"], platform: "linux", waitSteps: 2 }));
        const handler = vi.mocked(ipcMain.handle).mock.calls[0][1] as (...args: unknown[]) => Promise<unknown>;
        const mainFrame = {};
        global.mainWindow = { webContents: { mainFrame } } as unknown as typeof global.mainWindow;

        await expect(handler({ senderFrame: {} }, "listSinks")).rejects.toThrow("Not allowed");
        await expect(handler({ senderFrame: mainFrame }, "rm -rf")).rejects.toThrow("Unknown");
        expect(await handler({ senderFrame: mainFrame }, "listSinks")).toMatchObject({ supported: true });
        expect(await handler({ senderFrame: mainFrame }, "prepareShareSource", "virtual-music")).toMatchObject({
            description: "InterCom share: Virtual Music",
        });
        await handler({ senderFrame: mainFrame }, "releaseShareSource", "virtual-discord");
        expect(audio.ownedModules).toHaveLength(1);
        await handler({ senderFrame: mainFrame }, "releaseShareSource");
        expect(audio.ownedModules).toEqual([]);
        expect(vi.mocked(app.on).mock.calls.map(([event]) => event)).toEqual(["will-quit", "web-contents-created"]);
    });
});
