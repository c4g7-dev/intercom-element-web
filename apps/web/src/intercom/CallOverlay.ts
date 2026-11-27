/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { type ClientWidgetApi, type IWidgetApiRequest } from "matrix-widget-api";
import { logger } from "matrix-js-sdk/src/logger";

import PersistedElement from "../components/views/elements/PersistedElement";
import { isBundledElementCall } from "./ShareAudioBridge";

/**
 * The widget action through which the bundled Element Call asks for the whole window while one of
 * its dialogs is open. The call is a frame in a part of the window (above the chat, in the corner
 * as a picture-in-picture): a dialog inside it would be as small as that part.
 *
 * From the widget: `{ op: "open" }`, answered `{ supported, rect, window }` (where the call is in
 * the window, and the window's size), and `{ op: "close" }`.
 * To the widget: `{ op: "layout", supported, rect, window }` when the window was resized or the
 * overlay was taken away, `{ op: "dismiss" }` when Escape was pressed outside the frame.
 *
 * The frame is not moved or loaded again: its box becomes the window's, and the call draws itself
 * where it was and leaves the rest see-through.
 */
export const OVERLAY_ACTION = "io.intercom.overlay";

export interface OverlayRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** What the widget is told about its place while it covers the window. */
export interface OverlayPlacement {
    supported: true;
    /** Where the call belongs; null while it has no place (its room is not shown anywhere) */
    rect: OverlayRect | null;
    window: { width: number; height: number };
}

/** What the overlay needs of the page it is on; replaced in tests. */
export interface OverlayEnvironment {
    /** Gives the frame the whole window or takes it back; false where that cannot be done */
    setOverlay(overlay: boolean): boolean;
    /** Where the frame belongs in the window */
    rect(): OverlayRect | null;
    window: Pick<Window, "innerWidth" | "innerHeight" | "addEventListener" | "removeEventListener">;
    document: Pick<Document, "addEventListener" | "removeEventListener" | "activeElement">;
    /** Puts the keyboard focus into the frame */
    focusFrame(): void;
    /** Whether an element is one the frame covers while it has the window: the app, not its dialogs */
    isCovered(element: Element): boolean;
}

/**
 * The state of one call widget's overlay: closed, or open with the frame over the window.
 * While it is open the keyboard belongs to the frame: the focus is put into it and kept there,
 * Escape pressed elsewhere is passed on as a request to close the dialog, and the widget is told
 * when the window changes its size. Closing puts the focus back where it was.
 */
export class CallOverlayController {
    private open = false;
    private focusBefore: Element | null = null;

    public constructor(
        private readonly env: OverlayEnvironment,
        private readonly tellWidget: (data: Record<string, unknown>) => void,
    ) {}

    public get isOpen(): boolean {
        return this.open;
    }

    private placement(): OverlayPlacement {
        return {
            supported: true,
            rect: this.env.rect(),
            window: { width: this.env.window.innerWidth, height: this.env.window.innerHeight },
        };
    }

    /** Carries a request of the widget out. @returns the answer to it */
    public handle(data: unknown): OverlayPlacement | { supported: false } | Record<string, never> {
        const op = (data as { op?: unknown } | null)?.op;
        if (op === "open") {
            if (!this.open) {
                if (!this.env.setOverlay(true)) return { supported: false };
                this.open = true;
                this.focusBefore = this.env.document.activeElement;
                this.env.window.addEventListener("resize", this.onResize);
                this.env.document.addEventListener("keydown", this.onKeyDown, true);
                this.env.document.addEventListener("focusin", this.onFocusIn, true);
                this.env.focusFrame();
            }
            return this.placement();
        }
        if (op === "close") {
            this.close();
            return {};
        }
        throw new Error("Unknown overlay operation");
    }

    /** Takes the window back from the frame, if it has it. */
    public close(): void {
        if (!this.open) return;
        this.open = false;
        this.env.window.removeEventListener("resize", this.onResize);
        this.env.document.removeEventListener("keydown", this.onKeyDown, true);
        this.env.document.removeEventListener("focusin", this.onFocusIn, true);
        this.env.setOverlay(false);
        const before = this.focusBefore;
        this.focusBefore = null;
        if (before instanceof HTMLElement && before.isConnected) before.focus();
    }

    /**
     * The frame lost the window without the widget having asked: it went to a window of its own.
     * The widget is told, and keeps its dialog inside its frame.
     */
    public revoke(): void {
        if (!this.open) return;
        this.close();
        this.tellWidget({ op: "layout", supported: false });
    }

    private readonly onResize = (): void => {
        this.tellWidget({ op: "layout", ...this.placement() });
    };

    private readonly onKeyDown = (ev: KeyboardEvent): void => {
        // Key presses inside the frame do not come by here: this is Escape pressed while the focus
        // was still on the app, which is under the dialog
        if (ev.key !== "Escape") return;
        if (ev.target instanceof Element && !this.env.isCovered(ev.target)) return;
        ev.preventDefault();
        ev.stopPropagation();
        this.tellWidget({ op: "dismiss" });
    };

    private readonly onFocusIn = (ev: FocusEvent): void => {
        // What the dialog covers cannot be seen or clicked: the focus has no business there
        if (ev.target instanceof Element && this.env.isCovered(ev.target)) this.env.focusFrame();
    };
}

/**
 * Lets the widget behind `widgetApi` cover the window while a dialog of its is open, if it is the
 * bundled Element Call. For any other widget the action stays unknown, which a widget takes as
 * "not available".
 * @returns what to call when the widget is stopped, which takes the window back
 */
export function attachCallOverlayBridge(
    widgetApi: ClientWidgetApi,
    widgetUrl: string,
    persistKey: string,
    iframe: HTMLIFrameElement,
): () => void {
    if (!isBundledElementCall(widgetUrl)) return () => {};

    const controller = new CallOverlayController(
        {
            setOverlay: (overlay) => PersistedElement.setOverlay(persistKey, overlay),
            rect: () => {
                const rect = PersistedElement.placeholderRect(persistKey);
                return rect && rect.width > 0 && rect.height > 0
                    ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
                    : null;
            },
            window,
            document,
            focusFrame: () => iframe.focus(),
            // The page itself counts: that is where the focus is when nothing has it
            isCovered: (element) =>
                element === document.body ||
                element === document.documentElement ||
                (document.getElementById("matrixchat")?.contains(element) ?? false),
        },
        (data) => {
            widgetApi.transport.send(OVERLAY_ACTION, data).catch((e: unknown) => {
                logger.warn("InterCom overlay message failed", e);
            });
        },
    );
    const forgetRevoked = PersistedElement.onOverlayRevoked(persistKey, () => controller.revoke());

    const onAction = (ev: CustomEvent<IWidgetApiRequest>): void => {
        ev.preventDefault(); // stop the widget API from auto-rejecting this
        try {
            const answer = controller.handle(ev.detail.data);
            logger.log(
                `[intercom-diag] ${JSON.stringify({ type: "call_overlay", op: (ev.detail.data as { op?: unknown })?.op, open: controller.isOpen })}`,
            );
            widgetApi.transport.reply(ev.detail, { ...answer });
        } catch (e) {
            widgetApi.transport.reply(ev.detail, {
                error: { message: e instanceof Error ? e.message : String(e) },
            });
        }
    };
    widgetApi.on(`action:${OVERLAY_ACTION}`, onAction);

    return () => {
        widgetApi.off(`action:${OVERLAY_ACTION}`, onAction);
        forgetRevoked();
        // A call that ends with a dialog open cannot say that it is over
        controller.close();
    };
}
