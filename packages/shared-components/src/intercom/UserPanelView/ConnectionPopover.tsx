/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, type PointerEvent, type ReactNode, type Ref, useState } from "react";
import classNames from "classnames";

import styles from "./ConnectionPopover.module.css";
import { useI18n } from "../../core/i18n/i18nContext";
import { SignalBars, type SignalLevel } from "./SignalBars";

/** How the media gets to the server: straight, or by way of a TURN relay. */
export type UserPanelConnectionTransport = "udp" | "tcp" | "turn-udp" | "turn-tcp" | "turn-tls";

/** The details of the call's connection, as the call tells them about every second. */
export interface UserPanelConnection {
    /** The round-trip time to the media server now, in milliseconds */
    pingMs?: number;
    /** Its mean over the last minute */
    averagePingMs?: number;
    /** The round-trip times of the last minute, one per second, oldest first; null where none is known */
    pingHistory: (number | null)[];
    /** Packets lost of what is sent and of what is received, in percent */
    lossOutPct?: number;
    lossInPct?: number;
    jitterMs?: number;
    /** The media server's host name */
    server?: string;
    transport?: UserPanelConnectionTransport;
    /** Whether the call is end-to-end encrypted */
    encrypted?: boolean;
    /** The microphone as it is sent; bits per second */
    audio?: { codec?: string; bitrate?: number };
    /** The screen share as it is sent, while there is one */
    share?: { width?: number; height?: number; fps?: number; bitrate?: number };
}

const GRAPH_WIDTH = 240;
const GRAPH_HEIGHT = 40;
/** The least the graph's scale goes up to, so that a steady 20 ms is a low line and not a full one */
const GRAPH_MIN_SCALE_MS = 80;

/** The points of the line and of the area under it, run by run: a gap in the times is a gap in the line. */
export function pingGraphPaths(history: (number | null)[]): { line: string; area: string; scaleMs: number } {
    const values = history.filter((value): value is number => value !== null);
    const scaleMs = Math.max(GRAPH_MIN_SCALE_MS, ...values.map((value) => value * 1.2));
    const step = history.length > 1 ? GRAPH_WIDTH / (history.length - 1) : 0;
    const x = (index: number): string => (index * step).toFixed(1);
    // A line of 1.5 px drawn at the very top or bottom would be cut in half
    const y = (value: number): string => (1 + (1 - value / scaleMs) * (GRAPH_HEIGHT - 2)).toFixed(1);
    let line = "";
    let area = "";
    let runStart = -1;
    history.forEach((value, index) => {
        if (value !== null) {
            line += `${runStart < 0 ? "M" : "L"}${x(index)} ${y(value)}`;
            area += runStart < 0 ? `M${x(index)} ${GRAPH_HEIGHT}L${x(index)} ${y(value)}` : `L${x(index)} ${y(value)}`;
            if (runStart < 0) runStart = index;
        }
        if (runStart >= 0 && (value === null || index === history.length - 1)) {
            area += `L${x(value === null ? index - 1 : index)} ${GRAPH_HEIGHT}Z`;
            runStart = -1;
        }
    });
    return { line, area, scaleMs };
}

/** The round-trip times of the last minute as a line over a faint area; pointing at it reads a second off. */
function PingGraph({ history, label }: { history: (number | null)[]; label: string }): JSX.Element {
    const { translate: _t } = useI18n();
    const [pointed, setPointed] = useState<number | null>(null);
    const { line, area } = pingGraphPaths(history);
    const last = history.length - 1;
    const onPointerMove = (ev: PointerEvent<HTMLDivElement>): void => {
        const rect = ev.currentTarget.getBoundingClientRect();
        if (rect.width <= 0 || last < 1) return;
        const index = Math.round(((ev.clientX - rect.left) / rect.width) * last);
        setPointed(Math.min(last, Math.max(0, index)));
    };
    const pointedValue = pointed === null ? null : (history[pointed] ?? null);
    return (
        <div className={styles.graph}>
            <div className={styles.plot} onPointerMove={onPointerMove} onPointerLeave={() => setPointed(null)}>
                <svg
                    viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={label}
                    data-testid="intercom-connection-graph"
                >
                    <path className={styles.area} d={area} />
                    <path className={styles.line} d={line} />
                </svg>
                {pointed !== null && last > 0 && (
                    <span className={styles.crosshair} style={{ insetInlineStart: `${(pointed / last) * 100}%` }} />
                )}
            </div>
            <div className={styles.axis} aria-hidden="true">
                {pointed === null || pointedValue === null ? (
                    <>
                        <span>{_t("intercom|user_panel|connection|seconds_ago", { value: last })}</span>
                        <span>{_t("intercom|user_panel|connection|now")}</span>
                    </>
                ) : (
                    <>
                        <span>{_t("intercom|user_panel|connection|seconds_ago", { value: last - pointed })}</span>
                        <span>{_t("intercom|user_panel|connection|ms", { value: Math.round(pointedValue) })}</span>
                    </>
                )}
            </div>
        </div>
    );
}

interface ConnectionPopoverProps {
    id: string;
    ref?: Ref<HTMLDivElement>;
    /** Where it is put: over the panel, as wide as it or a little wider */
    place: { left: number; bottom: number; width: number };
    level: SignalLevel;
    /** Whether the call told how good the connection is; otherwise all that is known is that there is one */
    judged: boolean;
    /** The details, or undefined for a call that tells none */
    connection?: UserPanelConnection;
    onOpenDiagnostics: () => void;
}

/** The details of the call's connection, in a card over the user panel. */
export function ConnectionPopover({
    id,
    ref,
    place,
    level,
    judged,
    connection,
    onOpenDiagnostics,
}: Readonly<ConnectionPopoverProps>): JSX.Element {
    const { translate: _t } = useI18n();
    const ms = (value: number): string => _t("intercom|user_panel|connection|ms", { value: Math.round(value) });
    const percent = (value: number): string =>
        _t("intercom|user_panel|connection|percent", { value: value.toFixed(1) });
    const bitrate = (value: number): string =>
        value >= 1_000_000
            ? _t("intercom|user_panel|connection|mbps", { value: (value / 1_000_000).toFixed(1) })
            : _t("intercom|user_panel|connection|kbps", { value: Math.round(value / 1000) });
    const levels: Record<SignalLevel, string> = {
        good: judged ? _t("intercom|user_panel|connection|good") : _t("intercom|voice|connected"),
        fair: _t("intercom|user_panel|connection|fair"),
        poor: _t("intercom|user_panel|connection|poor"),
        reconnecting: _t("intercom|user_panel|reconnecting"),
    };
    const transports: Record<UserPanelConnectionTransport, string> = {
        "udp": _t("intercom|user_panel|connection|transport_udp"),
        "tcp": _t("intercom|user_panel|connection|transport_tcp"),
        "turn-udp": _t("intercom|user_panel|connection|transport_turn", { protocol: "UDP" }),
        "turn-tcp": _t("intercom|user_panel|connection|transport_turn", { protocol: "TCP" }),
        "turn-tls": _t("intercom|user_panel|connection|transport_turn", { protocol: "TLS" }),
    };

    const rows: { key: string; label: string; value: ReactNode }[] = [];
    if (connection) {
        const { lossOutPct, lossInPct, jitterMs, server, transport, encrypted, audio, share } = connection;
        if (lossOutPct !== undefined || lossInPct !== undefined)
            rows.push({
                key: "loss",
                label: _t("intercom|user_panel|connection|packet_loss"),
                value: (
                    <>
                        {lossOutPct !== undefined && (
                            <span title={_t("intercom|user_panel|connection|sent")}>
                                <span aria-hidden="true">↑ </span>
                                <span className={styles.srOnly}>{_t("intercom|user_panel|connection|sent")} </span>
                                {percent(lossOutPct)}
                            </span>
                        )}
                        {lossInPct !== undefined && (
                            <span title={_t("intercom|user_panel|connection|received")}>
                                <span aria-hidden="true">↓ </span>
                                <span className={styles.srOnly}>{_t("intercom|user_panel|connection|received")} </span>
                                {percent(lossInPct)}
                            </span>
                        )}
                    </>
                ),
            });
        if (jitterMs !== undefined)
            rows.push({ key: "jitter", label: _t("intercom|user_panel|connection|jitter"), value: ms(jitterMs) });
        if (server) rows.push({ key: "server", label: _t("intercom|user_panel|connection|server"), value: server });
        if (transport)
            rows.push({
                key: "transport",
                label: _t("intercom|user_panel|connection|transport"),
                value: transports[transport],
            });
        if (encrypted !== undefined)
            rows.push({
                key: "encryption",
                label: _t("intercom|user_panel|connection|encryption"),
                value: encrypted
                    ? _t("intercom|user_panel|connection|encryption_on")
                    : _t("intercom|user_panel|connection|encryption_off"),
            });
        const audioParts = [audio?.codec, audio?.bitrate !== undefined ? bitrate(audio.bitrate) : undefined];
        if (audioParts.some(Boolean))
            rows.push({
                key: "audio",
                label: _t("intercom|user_panel|microphone"),
                value: audioParts.filter(Boolean).join(" · "),
            });
        const shareParts = [
            share?.width !== undefined && share.height !== undefined ? `${share.width}×${share.height}` : undefined,
            share?.fps !== undefined
                ? _t("intercom|user_panel|connection|fps", { value: Math.round(share.fps) })
                : undefined,
            share?.bitrate !== undefined ? bitrate(share.bitrate) : undefined,
        ];
        if (shareParts.some(Boolean))
            rows.push({
                key: "share",
                label: _t("intercom|user_panel|connection|screen_share"),
                value: shareParts.filter(Boolean).join(" · "),
            });
    }
    const hasGraph = connection?.pingHistory.some((value) => value !== null) === true;

    return (
        <div
            ref={ref}
            id={id}
            className={classNames(styles.popover, "mx_IntercomConnectionPopover")}
            style={{ left: place.left, bottom: place.bottom, width: place.width }}
            role="dialog"
            aria-label={_t("intercom|user_panel|connection|title")}
            tabIndex={-1}
            data-testid="intercom-connection-popover"
        >
            <div className={styles.head}>
                <span className={styles.title}>{_t("intercom|user_panel|connection|title")}</span>
                <span className={styles.level} data-level={level} data-testid="intercom-connection-level">
                    <SignalBars level={level} />
                    {levels[level]}
                </span>
            </div>
            {connection ? (
                <>
                    <div className={styles.ping}>
                        <span className={styles.pingLabel}>{_t("intercom|user_panel|connection|ping")}</span>
                        <span className={styles.pingValue} data-testid="intercom-connection-ping">
                            {connection.pingMs === undefined ? "–" : ms(connection.pingMs)}
                        </span>
                        {connection.averagePingMs !== undefined && (
                            <span className={styles.pingAverage}>
                                {_t("intercom|user_panel|connection|average", { value: ms(connection.averagePingMs) })}
                            </span>
                        )}
                    </div>
                    {hasGraph && (
                        <PingGraph
                            history={connection.pingHistory}
                            label={_t("intercom|user_panel|connection|graph_label")}
                        />
                    )}
                    {rows.length > 0 && (
                        <dl className={styles.rows}>
                            {rows.map(({ key, label, value }) => (
                                <div key={key} className={styles.row} data-row={key}>
                                    <dt>{label}</dt>
                                    <dd>{value}</dd>
                                </div>
                            ))}
                        </dl>
                    )}
                </>
            ) : (
                <p className={styles.none}>{_t("intercom|user_panel|connection|no_details")}</p>
            )}
            <div className={styles.foot}>
                <button type="button" className={styles.diagnostics} onClick={onOpenDiagnostics}>
                    {_t("intercom|user_panel|connection|open_diagnostics")}
                </button>
            </div>
        </div>
    );
}
