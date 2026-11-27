/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

// oxlint-disable element-web/require-test-teardown -- the stores here are emitters made per test, with nothing to release

import { describe, expect, it, vi } from "vitest";
import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";
import { type ClientWidgetApi } from "matrix-widget-api";

import {
    attachConnectionStatsBridge,
    averageRtt,
    CONN_STATS_WIDGET_ACTION,
    ConnectionStatsStore,
    ConnectionStatsStoreEvent,
    parseConnStats,
    RttHistory,
} from "./ConnectionStats";

describe("parseConnStats", () => {
    it("reads what the call sends for the signal bars", () => {
        expect(parseConnStats({ quality: "fair", rtt_ms: 140, loss_pct: 1 })).toEqual({
            quality: "fair",
            rttMs: 140,
            lossPct: 1,
        });
        expect(parseConnStats({ quality: "good" })).toEqual({ quality: "good" });
    });

    it("reads the details", () => {
        expect(
            parseConnStats({
                quality: "good",
                rtt_ms: 31,
                loss_pct: 0.3,
                detail: {
                    loss_out_pct: 0.3,
                    loss_in_pct: 0,
                    jitter_ms: 8,
                    server: "sfu.example.org",
                    transport: "turn-tls",
                    encrypted: true,
                    audio: { codec: "opus", bitrate: 32000 },
                    share: { width: 2560, height: 1440, fps: 30, bitrate: 3200000 },
                },
            }),
        ).toEqual({
            quality: "good",
            rttMs: 31,
            lossPct: 0.3,
            detail: {
                lossOutPct: 0.3,
                lossInPct: 0,
                jitterMs: 8,
                server: "sfu.example.org",
                transport: "turn-tls",
                encrypted: true,
                audio: { codec: "opus", bitrate: 32000 },
                share: { width: 2560, height: 1440, fps: 30, bitrate: 3200000 },
            },
        });
    });

    it("shows nothing for what is no such message", () => {
        for (const garbage of [
            undefined,
            null,
            "good",
            42,
            [],
            {},
            { quality: "excellent" },
            { quality: 3 },
            { rtt_ms: 20, loss_pct: 0 },
            [{ quality: "good" }],
        ])
            expect(parseConnStats(garbage)).toBeUndefined();
    });

    it("leaves out, one by one, the figures and names that cannot be what they should", () => {
        expect(
            parseConnStats({
                quality: "poor",
                rtt_ms: "31",
                loss_pct: 140,
                detail: {
                    loss_out_pct: -1,
                    loss_in_pct: Number.NaN,
                    jitter_ms: Number.POSITIVE_INFINITY,
                    server: "wss://sfu.example.org/rtc?access_token=secret",
                    transport: "carrier-pigeon",
                    encrypted: "yes",
                    audio: { codec: "<b>opus</b>", bitrate: 32000 },
                    share: "1080p",
                    ip: "203.0.113.7",
                },
            }),
        ).toEqual({ quality: "poor", detail: { audio: { bitrate: 32000 } } });
        expect(parseConnStats({ quality: "good", detail: "none" })).toEqual({ quality: "good" });
        expect(parseConnStats({ quality: "good", detail: { server: "x".repeat(200) } })).toEqual({
            quality: "good",
            detail: {},
        });
    });
});

describe("RttHistory", () => {
    it("gives one value per second, holding each time until the next is told", () => {
        const history = new RttHistory(5);
        expect(history.series(10_000)).toEqual([null, null, null, null, null]);
        history.push(6_500, 30);
        history.push(9_000, 50);
        // Seconds 6 to 10: nothing at 6, 30 from 6.5, 50 from 9
        expect(history.series(10_000)).toEqual([null, 30, 30, 50, 50]);
        // Later, with nothing new told: the last one holds
        expect(history.series(13_000)).toEqual([50, 50, 50, 50, 50]);
    });

    it("forgets what is older than the window, but for the time that held when it began", () => {
        const history = new RttHistory(5);
        for (let second = 0; second <= 20; second++) history.push(second * 1000, second);
        // The five seconds drawn, and the one before them
        expect(history.size).toBeLessThanOrEqual(7);
        expect(history.series(20_000)).toEqual([16, 17, 18, 19, 20]);

        const sparse = new RttHistory(5);
        sparse.push(0, 40);
        sparse.push(60_000, 45);
        expect(sparse.size).toBe(2);
        expect(sparse.series(61_000)).toEqual([40, 40, 40, 45, 45]);
        sparse.push(100_000, 50);
        expect(sparse.size).toBe(2);
    });

    it("keeps a minute by default", () => {
        const history = new RttHistory();
        history.push(0, 20);
        const series = history.series(30_000);
        expect(series).toHaveLength(60);
        expect(series.filter((value) => value === null)).toHaveLength(29);
    });

    it("is not confused by a clock that went back", () => {
        const history = new RttHistory(3);
        history.push(10_000, 30);
        history.push(5_000, 40);
        expect(history.series(6_000)).toEqual([null, 40, 40]);
    });
});

describe("averageRtt", () => {
    it("is the mean of what is known, and nothing where nothing is", () => {
        expect(averageRtt([null, 30, 41, null])).toBe(36);
        expect(averageRtt([null, null])).toBeUndefined();
        expect(averageRtt([])).toBeUndefined();
    });
});

describe("ConnectionStatsStore", () => {
    it("keeps the connection by room with its history, and tells when it changes or goes", () => {
        let now = 1_000_000;
        const store = new ConnectionStatsStore(() => now);
        const onUpdate = vi.fn();
        store.on(ConnectionStatsStoreEvent.Update, onUpdate);

        expect(store.getStats("!a:x")).toBeUndefined();
        expect(store.getRttSeries("!a:x")).toEqual([]);
        store.setStats("!a:x", { quality: "good", rttMs: 30 });
        now += 2000;
        store.setStats("!a:x", { quality: "fair", rttMs: 130 });
        expect(store.getStats("!a:x")).toEqual({ quality: "fair", rttMs: 130 });
        expect(store.getRttSeries("!a:x").slice(-4)).toEqual([null, 30, 30, 130]);
        // A message without a time changes nothing in the history
        store.setStats("!a:x", { quality: "fair" });
        expect(store.getRttSeries("!a:x").slice(-2)).toEqual([30, 130]);

        store.clear("!a:x");
        expect(store.getStats("!a:x")).toBeUndefined();
        expect(onUpdate).toHaveBeenCalledTimes(4);
        store.clear("!a:x");
        expect(onUpdate).toHaveBeenCalledTimes(4);
    });

    it("keeps the details only while they are looked at", () => {
        const store = new ConnectionStatsStore();
        const onUpdate = vi.fn();
        const detail = { server: "sfu.example.org" };
        // Not asked for: not kept
        store.setStats("!a:x", { quality: "good", detail });
        expect(store.getStats("!a:x")?.detail).toBeUndefined();

        const onDetailed = vi.fn();
        const off = store.onDetailed(onDetailed);
        store.setDetailed(true);
        store.setDetailed(true);
        expect(onDetailed.mock.calls).toEqual([[true]]);
        expect(store.detailed).toBe(true);
        store.setStats("!a:x", { quality: "good", detail });
        expect(store.getStats("!a:x")?.detail).toEqual(detail);

        store.on(ConnectionStatsStoreEvent.Update, onUpdate);
        store.setDetailed(false);
        expect(onDetailed).toHaveBeenLastCalledWith(false);
        expect(store.getStats("!a:x")).toEqual({ quality: "good" });
        expect(onUpdate).toHaveBeenCalledWith("!a:x");

        off();
        store.setDetailed(true);
        expect(onDetailed).toHaveBeenCalledTimes(2);
    });
});

describe("attachConnectionStatsBridge", () => {
    class Emitter extends TypedEventEmitter<string, Record<string, (...args: unknown[]) => void>> {}
    function widgetApi(send = vi.fn().mockResolvedValue({})): ClientWidgetApi & {
        reply: ReturnType<typeof vi.fn>;
        send: ReturnType<typeof vi.fn>;
    } {
        const api = new Emitter() as unknown as ReturnType<typeof widgetApi>;
        api.reply = vi.fn();
        api.send = send;
        (api as unknown as { transport: object }).transport = { reply: api.reply, send };
        return api;
    }
    const tell = (
        api: ClientWidgetApi,
        data: unknown,
    ): { preventDefault: ReturnType<typeof vi.fn>; detail: { data: unknown } } => {
        const event = { preventDefault: vi.fn(), detail: { data } };
        (api as unknown as Emitter).emit(`action:${CONN_STATS_WIDGET_ACTION}`, event);
        return event;
    };

    it("stores what the call tells, answers it, and forgets it when detached", () => {
        const store = new ConnectionStatsStore();
        const api = widgetApi();
        const detach = attachConnectionStatsBridge(api, "!a:x", store);

        const event = tell(api, { quality: "fair", rtt_ms: 140 });
        expect(event.preventDefault).toHaveBeenCalled();
        expect(api.reply).toHaveBeenCalledWith(event.detail, {});
        expect(store.getStats("!a:x")).toEqual({ quality: "fair", rttMs: 140 });
        // Nobody looks at the details: the call is asked for nothing
        expect(api.send).not.toHaveBeenCalled();

        detach();
        expect(store.getStats("!a:x")).toBeUndefined();
        tell(api, { quality: "good" });
        expect(store.getStats("!a:x")).toBeUndefined();
    });

    it("answers garbage too, and shows nothing for it", () => {
        const store = new ConnectionStatsStore();
        const api = widgetApi();
        attachConnectionStatsBridge(api, "!a:x", store);
        const event = tell(api, { quality: "excellent", rtt_ms: -4 });
        expect(api.reply).toHaveBeenCalledWith(event.detail, {});
        expect(store.getStats("!a:x")).toBeUndefined();
    });

    it("tells the call when the details start and stop being looked at", () => {
        const store = new ConnectionStatsStore();
        const api = widgetApi();
        const detach = attachConnectionStatsBridge(api, "!a:x", store);
        store.setDetailed(true);
        expect(api.send).toHaveBeenLastCalledWith("io.intercom.call_action", { action: "connection-details-on" });
        // Asked once: what the call tells from then on does not ask again
        tell(api, { quality: "good", detail: {} });
        expect(api.send).toHaveBeenCalledTimes(1);
        store.setDetailed(false);
        expect(api.send).toHaveBeenLastCalledWith("io.intercom.call_action", { action: "connection-details-off" });

        detach();
        store.setDetailed(true);
        expect(api.send).toHaveBeenCalledTimes(2);
    });

    it("asks a call that starts while the details are open, with the first thing it tells", () => {
        const store = new ConnectionStatsStore();
        store.setDetailed(true);
        const api = widgetApi();
        attachConnectionStatsBridge(api, "!a:x", store);
        expect(api.send).not.toHaveBeenCalled();
        tell(api, { quality: "good", rtt_ms: 20 });
        expect(api.send).toHaveBeenCalledWith("io.intercom.call_action", { action: "connection-details-on" });
        tell(api, { quality: "good", rtt_ms: 21 });
        expect(api.send).toHaveBeenCalledTimes(1);
    });

    it("has no details, and no error, with a call that does not know the question", async () => {
        const store = new ConnectionStatsStore();
        const api = widgetApi(vi.fn().mockRejectedValue(new Error("Unknown or unsupported action")));
        attachConnectionStatsBridge(api, "!a:x", store);
        expect(() => store.setDetailed(true)).not.toThrow();
        await Promise.resolve();
        expect(store.getStats("!a:x")).toBeUndefined();
    });
});
