/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

/**
 * Reads the notes of a release (the Markdown of its section of the changelog) into a few kinds
 * of blocks that are drawn as text: headings, paragraphs, lists and code. Nothing of the notes
 * is ever handed to the page as HTML: tags are taken out, pictures are left out (nothing is
 * loaded from elsewhere), and only links to http(s) addresses stay links.
 */

/** A run of text within a line. */
export interface NotesInline {
    text: string;
    strong?: boolean;
    emphasis?: boolean;
    code?: boolean;
    /** An http(s) address the text leads to */
    href?: string;
}

/** One item of a list. */
export interface NotesListItem {
    inline: NotesInline[];
    /** 0 for an item of the list, 1 for one under an item */
    depth: 0 | 1;
}

export type NotesBlock =
    | { type: "heading"; inline: NotesInline[] }
    | { type: "paragraph"; inline: NotesInline[] }
    | { type: "list"; ordered: boolean; items: NotesListItem[] }
    | { type: "code"; text: string };

/** The most of a release's notes that is read. */
export const NOTES_MAX_LENGTH = 20000;

const ENTITIES: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&nbsp;": " ",
};

const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
/**
 * HTML's elements, as they may stand in Markdown. Other words in angle brackets ("InterCom
 * <version>") are text, and stay: whatever is left is drawn as text anyway.
 */
const TAG =
    /<\/?(?:a|abbr|audio|b|blockquote|body|br|button|center|code|dd|del|details|div|dl|dt|em|embed|font|form|h[1-6]|head|hr|html|i|iframe|img|input|ins|kbd|li|link|mark|meta|object|ol|p|picture|pre|q|s|script|small|source|span|strike|strong|style|sub|summary|sup|svg|table|tbody|td|textarea|th|thead|title|tr|u|ul|video)(?:[\s/][^>]*)?>|<!--[\s\S]*?-->/gi;

/** Takes pictures and HTML tags out of a line; what the tags enclosed stays, as text. */
function plain(text: string): string {
    return text
        .replace(IMAGE, "")
        .replace(TAG, "")
        .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity]);
}

/** Whether an address may be a link: http and https only, so nothing is run or opened in the app. */
export function isSafeNotesLink(href: string): boolean {
    try {
        const url = new URL(href);
        return url.protocol === "https:" || url.protocol === "http:";
    } catch {
        return false;
    }
}

// In the order of the groups: `code`, [text](address), **strong**, __strong__, *emphasis*, _emphasis_, a bare address
const INLINE =
    /`([^`]+)`|\[([^\]]+)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)|\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)([^*]+?)(?<!\s)\*(?![\w*])|(?<![\w_])_(?!\s)([^_]+?)(?<!\s)_(?![\w_])|(https?:\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"])/g;

type Marks = Pick<NotesInline, "strong" | "emphasis" | "href">;

function inlineOf(text: string, marks: Marks = {}, depth = 0): NotesInline[] {
    const out: NotesInline[] = [];
    const push = (run: NotesInline): void => {
        if (run.text) out.push(run);
    };
    let last = 0;
    // Marks within marks a few levels deep; beyond that the text is taken as it is
    if (depth < 4) {
        for (const match of text.matchAll(INLINE)) {
            push({ text: text.slice(last, match.index), ...marks });
            last = match.index + match[0].length;
            const [, code, linkText, linkHref, strongA, strongB, emA, emB, bare] = match;
            if (code !== undefined) push({ text: code, code: true, ...marks });
            else if (linkText !== undefined) {
                // A link that is not one stays as its words
                const inner = isSafeNotesLink(linkHref) ? { ...marks, href: linkHref } : marks;
                out.push(...inlineOf(linkText, inner, depth + 1));
            } else if (strongA !== undefined || strongB !== undefined) {
                out.push(...inlineOf(strongA ?? strongB, { ...marks, strong: true }, depth + 1));
            } else if (emA !== undefined || emB !== undefined) {
                out.push(...inlineOf(emA ?? emB, { ...marks, emphasis: true }, depth + 1));
            } else if (bare !== undefined) {
                push({ text: bare, ...marks, href: marks.href ?? (isSafeNotesLink(bare) ? bare : undefined) });
            }
        }
    }
    push({ text: text.slice(last), ...marks });
    return out;
}

function inlineOfLines(lines: string[]): NotesInline[] {
    const text = lines
        .map((line) => plain(line).trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ");
    return inlineOf(text);
}

const LIST_ITEM = /^(\s*)(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}(```|~~~)/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const RULE = /^\s{0,3}([-*_])\s*(\1\s*){2,}$/;
/** A caption under pictures, which are not shown */
const CAPTION = /^\s*<(sub|sup|small)>.*<\/\1>\s*$/;

/**
 * Reads Markdown into blocks.
 *
 * Tables are flattened: a row is a paragraph with its cells parted by " · "; a table of
 * pictures, with its head and the caption under it, leaves nothing.
 */
export function parseReleaseNotes(markdown: string): NotesBlock[] {
    const blocks: NotesBlock[] = [];
    const lines = String(markdown ?? "")
        .slice(0, NOTES_MAX_LENGTH)
        .replace(/\r\n?/g, "\n")
        .split("\n");

    let paragraph: string[] = [];
    let list: { ordered: boolean; items: Array<{ lines: string[]; depth: 0 | 1 }> } | undefined;

    const flushParagraph = (): void => {
        if (paragraph.length) {
            const captionOnly = paragraph.every((line) => CAPTION.test(line));
            const inline = captionOnly ? [] : inlineOfLines(paragraph);
            if (inline.length) blocks.push({ type: "paragraph", inline });
        }
        paragraph = [];
    };
    const flushList = (): void => {
        if (list) {
            const items = list.items
                .map((item) => ({ inline: inlineOfLines(item.lines), depth: item.depth }))
                .filter((item) => item.inline.length);
            if (items.length) blocks.push({ type: "list", ordered: list.ordered, items });
        }
        list = undefined;
    };
    const flush = (): void => {
        flushParagraph();
        flushList();
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const fence = FENCE.exec(line);
        if (fence) {
            flush();
            const code: string[] = [];
            for (i++; i < lines.length && !lines[i].trimStart().startsWith(fence[1]); i++) code.push(lines[i]);
            if (code.length) blocks.push({ type: "code", text: code.join("\n") });
            continue;
        }
        if (!line.trim()) {
            flushParagraph();
            // A list goes on after an empty line if an item or an indented line follows
            const next = lines.slice(i + 1).find((l) => l.trim());
            if (list && !(next && (LIST_ITEM.test(next) || /^\s{2,}/.test(next)))) flushList();
            continue;
        }
        if (RULE.test(line) && !list) {
            flush();
            continue;
        }
        const heading = HEADING.exec(line);
        if (heading) {
            flush();
            const inline = inlineOfLines([heading[1]]);
            if (inline.length) blocks.push({ type: "heading", inline });
            continue;
        }
        if (TABLE_ROW.test(line) || (TABLE_RULE.test(line) && line.includes("|"))) {
            flush();
            // The whole table: its head, the rule under it, its rows
            const rows: string[][] = [];
            let ruleAt = -1;
            for (
                ;
                i < lines.length && (TABLE_ROW.test(lines[i]) || TABLE_RULE.test(lines[i])) && lines[i].trim();
                i++
            ) {
                if (TABLE_RULE.test(lines[i])) {
                    ruleAt = rows.length;
                    continue;
                }
                rows.push(
                    lines[i]
                        .trim()
                        .replace(/^\||\|$/g, "")
                        .split("|")
                        .map((cell) => plain(cell).trim())
                        .filter(Boolean),
                );
            }
            i--;
            // A table whose rows held pictures only: its head is their captions, and goes with them
            const body = ruleAt >= 0 ? rows.slice(ruleAt) : rows;
            if (ruleAt >= 0 && body.every((cells) => cells.length === 0)) continue;
            for (const cells of rows) {
                if (cells.length) blocks.push({ type: "paragraph", inline: inlineOf(cells.join(" · ")) });
            }
            continue;
        }
        const item = LIST_ITEM.exec(line);
        if (item) {
            flushParagraph();
            const ordered = item[3] !== undefined;
            const depth = list && item[1].length >= 2 ? 1 : 0;
            if (list && depth === 0 && list.ordered !== ordered) flushList();
            list ??= { ordered, items: [] };
            list.items.push({ lines: [item[4]], depth });
            continue;
        }
        if (list) {
            // A line that carries an item on
            list.items[list.items.length - 1].lines.push(line);
            continue;
        }
        paragraph.push(line);
    }
    flush();
    return blocks;
}
