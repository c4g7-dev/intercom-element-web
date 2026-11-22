/*
Copyright 2026 InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { type JSX, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Room } from "matrix-js-sdk/src/matrix";
import { IconButton, Tooltip } from "@vector-im/compound-web";
import { ChevronDownIcon, ChevronUpIcon, ExpandIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import { _t } from "../languageHandler";
import { CallView } from "../components/views/voip/CallView";
import { SDKContext } from "../contexts/SDKContext";
import { useTypedEventEmitterState } from "../hooks/useEventEmitter";
import {
    CALL_SPLIT_DEFAULT_SHARE,
    CALL_SPLIT_MIN_CHAT_HEIGHT,
    CALL_SPLIT_MIN_HEIGHT,
    CallSplitStore,
    CallSplitStoreEvent,
    clampCallHeight,
} from "./CallSplitStore";

interface Props {
    room: Room;
    /**
     * Whether the call has the room to itself: no bar, no chat under it. The same panel shows
     * both, so that changing between them does not take the call's frame out of the page.
     */
    full?: boolean;
    /** Whether something else is being resized, which the call's frame must not swallow. */
    resizing: boolean;
    /** The user closed the call. */
    onClose: () => void;
}

const KEY_STEP = 16;
const KEY_STEP_LARGE = 80;

/**
 * The call of a room over its timeline: the call on top, then a bar that is dragged (or moved
 * with the arrow keys) to give the call more or less of the room, with a button that folds the
 * call away and one that gives it the whole room. The call goes on playing whatever its size.
 */
export function CallSplitPanel({ room, full = false, resizing, onClose }: Props): JSX.Element {
    const store = CallSplitStore.instance;
    const { resizeNotifier } = useContext(SDKContext);
    const root = useRef<HTMLDivElement>(null);
    const collapsed = useTypedEventEmitterState(store, CallSplitStoreEvent.Layout, () => store.collapsed);
    const storedHeight = useTypedEventEmitterState(store, CallSplitStoreEvent.Layout, () => store.height);
    // The height of the room, which the call and the chat share
    const [available, setAvailable] = useState(0);
    // While dragging: the height under the pointer, kept only when the drag ends
    const [dragHeight, setDragHeight] = useState<number | null>(null);
    const drag = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);

    useLayoutEffect(() => {
        const parent = root.current?.parentElement;
        if (!parent) return;
        const measure = (): void => setAvailable(parent.clientHeight);
        measure();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(measure);
        observer.observe(parent);
        return (): void => observer.disconnect();
    }, []);

    const height = clampCallHeight(dragHeight ?? storedHeight ?? available * CALL_SPLIT_DEFAULT_SHARE, available);
    const maxHeight = Math.max(CALL_SPLIT_MIN_HEIGHT, available - CALL_SPLIT_MIN_CHAT_HEIGHT);
    const shownHeight = collapsed ? 0 : height;
    // The call alone is as high as the room, whatever the divider was left at
    const callStyle = full ? undefined : { height: shownHeight };

    // The timeline under the call keeps its place while the call changes size
    useEffect(() => {
        resizeNotifier.notifyTimelineHeightChanged();
    }, [resizeNotifier, shownHeight]);

    const setHeight = useCallback(
        (next: number): void => {
            store.setCollapsed(false);
            store.setHeight(clampCallHeight(next, available));
        },
        [available, store],
    );

    const onPointerDown = useCallback(
        (ev: React.PointerEvent<HTMLDivElement>): void => {
            if (ev.button !== 0) return;
            ev.preventDefault();
            ev.currentTarget.setPointerCapture?.(ev.pointerId);
            drag.current = { pointerId: ev.pointerId, startY: ev.clientY, startHeight: collapsed ? 0 : height };
            setDragHeight(collapsed ? CALL_SPLIT_MIN_HEIGHT : height);
            resizeNotifier.startResizing();
        },
        [collapsed, height, resizeNotifier],
    );

    const onPointerMove = useCallback(
        (ev: React.PointerEvent<HTMLDivElement>): void => {
            const current = drag.current;
            if (!current || current.pointerId !== ev.pointerId) return;
            const wanted = current.startHeight + (ev.clientY - current.startY);
            // Pulling a folded call down opens it
            if (collapsed && wanted > CALL_SPLIT_MIN_HEIGHT / 2) store.setCollapsed(false);
            setDragHeight(clampCallHeight(wanted, available));
        },
        [available, collapsed, store],
    );

    const endDrag = useCallback(
        (ev: React.PointerEvent<HTMLDivElement>): void => {
            const current = drag.current;
            if (!current || current.pointerId !== ev.pointerId) return;
            drag.current = null;
            ev.currentTarget.releasePointerCapture?.(ev.pointerId);
            resizeNotifier.stopResizing();
            const moved = Math.abs(ev.clientY - current.startY) > 2;
            if (moved && !store.collapsed && dragHeight !== null) store.setHeight(dragHeight);
            setDragHeight(null);
        },
        [dragHeight, resizeNotifier, store],
    );

    const toggleCollapsed = useCallback((): void => {
        store.setCollapsed(!store.collapsed);
    }, [store]);

    const onKeyDown = useCallback(
        (ev: React.KeyboardEvent<HTMLDivElement>): void => {
            const step = ev.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
            switch (ev.key) {
                case "ArrowUp":
                    setHeight(height - step);
                    break;
                case "ArrowDown":
                    setHeight(collapsed ? CALL_SPLIT_MIN_HEIGHT : height + step);
                    break;
                case "Home":
                    setHeight(CALL_SPLIT_MIN_HEIGHT);
                    break;
                case "End":
                    setHeight(maxHeight);
                    break;
                case "Enter":
                case " ":
                    toggleCollapsed();
                    break;
                default:
                    return;
            }
            ev.preventDefault();
            ev.stopPropagation();
        },
        [collapsed, height, maxHeight, setHeight, toggleCollapsed],
    );

    const showFull = useCallback((): void => {
        store.setMode("full");
    }, [store]);

    const dragging = dragHeight !== null;
    const collapseLabel = collapsed ? _t("voip|intercom_split_expand") : _t("voip|intercom_split_collapse");

    return (
        <div
            className="mx_IntercomCallSplit"
            ref={root}
            data-collapsed={!full && collapsed}
            data-dragging={dragging}
            data-full={full}
            data-testid="intercom-call-split"
        >
            <div className="mx_IntercomCallSplit_call" style={callStyle} aria-hidden={!full && collapsed}>
                <CallView room={room} resizing={resizing || dragging} role="region" onClose={onClose} />
            </div>
            <div className="mx_IntercomCallSplit_bar" hidden={full}>
                <div
                    className="mx_IntercomCallSplit_handle"
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label={_t("voip|intercom_split_resize")}
                    aria-valuemin={CALL_SPLIT_MIN_HEIGHT}
                    aria-valuemax={maxHeight}
                    aria-valuenow={shownHeight}
                    tabIndex={0}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={onKeyDown}
                    onDoubleClick={toggleCollapsed}
                >
                    <span className="mx_IntercomCallSplit_grip" aria-hidden="true" />
                </div>
                <div className="mx_IntercomCallSplit_buttons">
                    <Tooltip label={collapseLabel}>
                        <IconButton size="24px" onClick={toggleCollapsed} aria-expanded={!collapsed}>
                            {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
                        </IconButton>
                    </Tooltip>
                    <Tooltip label={_t("voip|intercom_split_full")}>
                        <IconButton size="24px" onClick={showFull}>
                            <ExpandIcon />
                        </IconButton>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}
