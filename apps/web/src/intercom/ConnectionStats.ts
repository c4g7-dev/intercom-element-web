/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { TypedEventEmitter } from "matrix-js-sdk/src/matrix";
import { type ClientWidgetApi, type IWidgetApiRequest } from "matrix-widget-api";

/** The widget action Element Call (InterCom build) tells how its connection is on. */
export const CONN_STATS_WIDGET_ACTION = "io.intercom.conn_stats";
/** The widget action of the call actions, which also carries whether the details are wanted. */
const CALL_ACTION_WIDGET_ACTION = "io.intercom.call_action";

/** How good the connection is, as the call judges it from round-trip time and packet loss. */
export type ConnQuality = "good" | "fair" | "poor";
/** How the media gets to the server: straight, or by way of a TURN relay. */
export type ConnTransport = "udp" | "tcp" | "turn-udp" | "turn-tcp" | "turn-tls";

/** The details of a call's connection, which the call tells while they are asked for. */
export interface ConnDetail {
    lossOutPct?: number;
    lossInPct?: number;
    jitterMs?: number;
    /** The media server's host name */
    server?: string;
    transport?: ConnTransport;
    encrypted?: boolean;
    audio?: { codec?: string; bitrate?: number };
    share?: { width?: number; height?: number; fps?: number; bitrate?: number };
}

/** How a call's connection is, as its widget tells it. */
export interface ConnStats {
    quality: ConnQuality;
    rttMs?: number;
    lossPct?: number;
    detail?: ConnDetail;
}

const QUALITIES = new Set<string>(["good", "fair", "poor"]);
const TRANSPORTS = new Set<string>(["udp", "tcp", "turn-udp", "turn-tcp", "turn-tls"]);

/** A figure that can be shown: finite, not negative, and not beyond what such a figure can be. */
function figure(value: unknown, max: number): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? value : undefined;
}

/** A name that can be shown: short, and of the characters such names are made of. */
function name(value: unknown, pattern: RegExp): string | undefined {
    return typeof value === "string" && value.length <= 80 && pattern.test(value) ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function compact<T extends object>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

const HOST_NAME = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$|^\[[0-9a-f:]+\]$/i;
const CODEC_NAME = /^[\w.+-]+$/;
const MAX_MS = 60_000;
const MAX_BITRATE = 1_000_000_000;

/**
 * Reads what the widget sent. Without a quality it knows there is nothing to show; whatever else
 * is missing or not what it should be is left out, one figure at a time: the widget is the
 * bundled one, but its messages are still only data.
 */
export function parseConnStats(data: unknown): ConnStats | undefined {
    const raw = record(data);
    if (!raw || typeof raw.quality !== "string" || !QUALITIES.has(raw.quality)) return undefined;
    const detail = record(raw.detail);
    const audio = record(detail?.audio);
    const share = record(detail?.share);
    return compact({
        quality: raw.quality as ConnQuality,
        rttMs: figure(raw.rtt_ms, MAX_MS),
        lossPct: figure(raw.loss_pct, 100),
        detail:
            detail &&
            compact({
                lossOutPct: figure(detail.loss_out_pct, 100),
                lossInPct: figure(detail.loss_in_pct, 100),
                jitterMs: figure(detail.jitter_ms, MAX_MS),
                server: name(detail.server, HOST_NAME),
                transport:
                    typeof detail.transport === "string" && TRANSPORTS.has(detail.transport)
                        ? (detail.transport as ConnTransport)
                        : undefined,
                encrypted: typeof detail.encrypted === "boolean" ? detail.encrypted : undefined,
                audio:
                    audio &&
                    compact({ codec: name(audio.codec, CODEC_NAME), bitrate: figure(audio.bitrate, MAX_BITRATE) }),
                share:
                    share &&
                    compact({
                        width: figure(share.width, 100_000),
                        height: figure(share.height, 100_000),
                        fps: figure(share.fps, 1000),
                        bitrate: figure(share.bitrate, MAX_BITRATE),
                    }),
            }),
    });
}

/** How far back the round-trip times are kept, and drawn. */
export const RTT_HISTORY_SECONDS = 60;

/**
 * The round-trip times of the last minute. The call tells a time when it changed, or every second
 * while it is asked to, so a time holds until the next one comes.
 */
export class RttHistory {
    private samples: { t: number; rttMs: number }[] = [];

    public constructor(private readonly seconds = RTT_HISTORY_SECONDS) {}

    public push(t: number, rttMs: number): void {
        // A clock that went back: what came after the new sample's time is not history
        while (this.samples.length > 0 && this.samples[this.samples.length - 1].t > t) this.samples.pop();
        this.samples.push({ t, rttMs });
        // Kept: the window, and the one sample before it, which says what held when it began
        const start = t - this.seconds * 1000;
        let firstInside = this.samples.findIndex((sample) => sample.t > start);
        if (firstInside < 0) firstInside = this.samples.length - 1;
        this.samples.splice(0, Math.max(0, firstInside - 1));
    }

    /**
     * One value per second, oldest first, the last of them now: the time that held then, or null
     * from before the first one was told.
     */
    public series(now: number): (number | null)[] {
        const out: (number | null)[] = [];
        let next = 0;
        let held: number | null = null;
        for (let second = this.seconds - 1; second >= 0; second--) {
            const at = now - second * 1000;
            while (next < this.samples.length && this.samples[next].t <= at) held = this.samples[next++].rttMs;
            out.push(held);
        }
        return out;
    }

    public get size(): number {
        return this.samples.length;
    }
}

/** The mean of the times of a series, to the millisecond; undefined where it has none. */
export function averageRtt(series: (number | null)[]): number | undefined {
    const known = series.filter((value): value is number => value !== null);
    return known.length === 0 ? undefined : Math.round(known.reduce((a, b) => a + b, 0) / known.length);
}

export enum ConnectionStatsStoreEvent {
    /** The connection of the call of a room was told anew, or went away. Parameter: the room's ID */
    Update = "update",
}

type EventHandlerMap = { [ConnectionStatsStoreEvent.Update]: (roomId: string) => void };

interface Connection {
    stats: ConnStats;
    history: RttHistory;
}

/**
 * How the connections of the calls the user is in are, by room, with the round-trip times of the
 * last minute. It also says whether somebody looks at the details: only then the calls tell them.
 */
export class ConnectionStatsStore extends TypedEventEmitter<ConnectionStatsStoreEvent, EventHandlerMap> {
    private static internalInstance: ConnectionStatsStore | undefined;

    public static get instance(): ConnectionStatsStore {
        ConnectionStatsStore.internalInstance ??= new ConnectionStatsStore();
        return ConnectionStatsStore.internalInstance;
    }

    private readonly connections = new Map<string, Connection>();
    private readonly detailListeners = new Set<(detailed: boolean) => void>();
    private wanted = false;

    public constructor(private readonly now: () => number = Date.now) {
        super();
    }

    /** Whether the details are being looked at. */
    public get detailed(): boolean {
        return this.wanted;
    }

    /** Says that the details are looked at from now on, or no longer: the calls are told. */
    public setDetailed(detailed: boolean): void {
        if (this.wanted === detailed) return;
        this.wanted = detailed;
        for (const listener of this.detailListeners) listener(detailed);
        if (detailed) return;
        // What is not looked at is not kept: it would be old by the next look
        for (const [roomId, connection] of this.connections) {
            if (!connection.stats.detail) continue;
            connection.stats = { ...connection.stats, detail: undefined };
            this.emit(ConnectionStatsStoreEvent.Update, roomId);
        }
    }

    /** Calls back when the details start or stop being looked at. @returns what ends that */
    public onDetailed(listener: (detailed: boolean) => void): () => void {
        this.detailListeners.add(listener);
        return () => this.detailListeners.delete(listener);
    }

    /** How the connection of a room's call is, if the call tells. */
    public getStats(roomId: string): ConnStats | undefined {
        return this.connections.get(roomId)?.stats;
    }

    /** The round-trip times of the last minute of a room's call, one per second, oldest first. */
    public getRttSeries(roomId: string): (number | null)[] {
        return this.connections.get(roomId)?.history.series(this.now()) ?? [];
    }

    public setStats(roomId: string, stats: ConnStats): void {
        let connection = this.connections.get(roomId);
        if (!connection) {
            connection = { stats, history: new RttHistory() };
            this.connections.set(roomId, connection);
        }
        // Details that nobody asked for (the call had not heard yet) are not kept either
        connection.stats = this.wanted ? stats : { ...stats, detail: undefined };
        if (stats.rttMs !== undefined) connection.history.push(this.now(), stats.rttMs);
        this.emit(ConnectionStatsStoreEvent.Update, roomId);
    }

    /** Forgets the connection of a room's call: the user left it, or its widget went away. */
    public clear(roomId: string): void {
        if (this.connections.delete(roomId)) this.emit(ConnectionStatsStoreEvent.Update, roomId);
    }
}

/**
 * Takes how the connection is from a call's widget into the {@link ConnectionStatsStore}, and
 * tells the widget when the details start and stop being looked at.
 * @returns what stops it again and forgets the connection
 */
export function attachConnectionStatsBridge(
    widgetApi: ClientWidgetApi,
    roomId: string,
    store: ConnectionStatsStore = ConnectionStatsStore.instance,
): () => void {
    const ask = (detailed: boolean): void => {
        widgetApi.transport
            .send(CALL_ACTION_WIDGET_ACTION, { action: detailed ? "connection-details-on" : "connection-details-off" })
            .catch(() => {
                // A call that is not the InterCom build, or one that is gone: there are no details then
            });
    };
    // Whether this call has been asked: one that starts while the details are open is asked
    // with the first thing it tells, which is when it can be
    let asked = false;
    const onDetailed = (detailed: boolean): void => {
        asked = detailed;
        ask(detailed);
    };
    const offDetailed = store.onDetailed(onDetailed);
    const onAction = (ev: CustomEvent<IWidgetApiRequest>): void => {
        ev.preventDefault(); // stop the widget API from auto-rejecting this
        const stats = parseConnStats(ev.detail.data);
        if (stats) store.setStats(roomId, stats);
        widgetApi.transport.reply(ev.detail, {});
        if (store.detailed && !asked) onDetailed(true);
    };
    widgetApi.on(`action:${CONN_STATS_WIDGET_ACTION}`, onAction);
    return () => {
        widgetApi.off(`action:${CONN_STATS_WIDGET_ACTION}`, onAction);
        offDetailed();
        store.clear(roomId);
    };
}
