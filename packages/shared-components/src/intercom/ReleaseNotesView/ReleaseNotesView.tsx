/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX, useMemo } from "react";
import classNames from "classnames";
import { Heading } from "@vector-im/compound-web";

import styles from "./ReleaseNotesView.module.css";
import { type NotesBlock, type NotesInline, parseReleaseNotes } from "./releaseNotes";

/** The notes of one release. */
export interface ReleaseNotesEntry {
    /** e.g. `1.12.35-intercom.13` */
    version: string;
    /** The notes as Markdown */
    body: string;
}

interface ReleaseNotesViewProps {
    /** The releases to show, newest first */
    notes: ReleaseNotesEntry[];
    /** Whether each release is headed by its version; by default only where there are several */
    showVersions?: boolean;
    /** Whether whatever shows the notes is titled with the first release's version already: that release then gets no heading */
    titledByFirst?: boolean;
    /** Smaller type and tighter spacing, for the card beside the update button */
    compact?: boolean;
    className?: string;
}

function Inline({ runs }: { runs: NotesInline[] }): JSX.Element {
    return (
        <>
            {runs.map((run, i) => {
                let node: JSX.Element | string = run.text;
                if (run.code) node = <code>{node}</code>;
                if (run.emphasis) node = <em>{node}</em>;
                if (run.strong) node = <strong>{node}</strong>;
                if (run.href) {
                    node = (
                        // Opened outside the app: by the browser in a new tab, by the desktop app in the system's browser
                        <a href={run.href} target="_blank" rel="noreferrer noopener">
                            {node}
                        </a>
                    );
                }
                // oxlint-disable-next-line react/no-array-index-key -- the runs of a line never change places
                return <React.Fragment key={i}>{node}</React.Fragment>;
            })}
        </>
    );
}

function Block({ block }: { block: NotesBlock }): JSX.Element {
    switch (block.type) {
        case "heading":
            return (
                <p className={styles.heading}>
                    <Inline runs={block.inline} />
                </p>
            );
        case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
                <List className={styles.list}>
                    {block.items.map((item, i) => (
                        // oxlint-disable-next-line react/no-array-index-key -- the items of a list never change places
                        <li key={i} className={item.depth ? styles.nested : undefined}>
                            <Inline runs={item.inline} />
                        </li>
                    ))}
                </List>
            );
        }
        case "code":
            return <pre className={styles.code}>{block.text}</pre>;
        default:
            return (
                <p>
                    <Inline runs={block.inline} />
                </p>
            );
    }
}

/**
 * The notes of one or several releases, newest first, as headings, paragraphs and lists. The
 * Markdown is read by {@link parseReleaseNotes} and drawn as text: no HTML of the notes reaches
 * the page, no picture is loaded, and links open outside the app.
 */
export function ReleaseNotesView({
    notes,
    showVersions = notes.length > 1,
    titledByFirst = false,
    compact = false,
    className,
}: Readonly<ReleaseNotesViewProps>): JSX.Element {
    const parsed = useMemo(
        () => notes.map((entry) => ({ version: entry.version, blocks: parseReleaseNotes(entry.body) })),
        [notes],
    );
    return (
        <div
            className={classNames(styles.notes, { [styles.compact]: compact }, className)}
            data-testid="intercom-release-notes"
        >
            {parsed.map((entry, index) => (
                <section key={entry.version} className={styles.release} aria-label={entry.version}>
                    {showVersions && !(titledByFirst && index === 0) && (
                        <Heading as="h3" size="sm" weight="semibold" className={styles.version}>
                            {entry.version}
                        </Heading>
                    )}
                    {entry.blocks.map((block, i) => (
                        // oxlint-disable-next-line react/no-array-index-key -- the blocks of the notes never change places
                        <Block key={i} block={block} />
                    ))}
                </section>
            ))}
        </div>
    );
}
