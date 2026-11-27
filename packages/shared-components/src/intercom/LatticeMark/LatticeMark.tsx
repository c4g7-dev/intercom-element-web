/*
 * Copyright 2026 InterCom contributors
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
 * Please see LICENSE files in the repository root for full details.
 */

import React, { type JSX } from "react";
import classNames from "classnames";

import styles from "./LatticeMark.module.css";

/**
 * What the mark says:
 * - `loading`: the app's tile, its three bars rising and falling and the dots of the lattice
 *   lighting up in turn, for something that takes a moment (the app starting)
 * - `connecting`: the tile with a light going round a ring of dots, for a call that is being joined
 * - `speaking`: the three bars alone, moving, in the colour of the text around them, for somebody
 *   who talks right now
 */
export type LatticeMarkVariant = "loading" | "connecting" | "speaking";

interface LatticeMarkProps {
    /** Which of the animations to show */
    variant: LatticeMarkVariant;
    /** Width and height, as a CSS length; 48px by default, 1em for `speaking` */
    size?: string;
    /** What a screen reader says for it. Without one the mark is hidden from screen readers. */
    label?: string;
    /** A class for the element, e.g. to place it */
    className?: string;
}

/** The ring of `connecting`, clockwise from the top left, each dot lighting up a little later. */
const RING: Array<[number, number]> = [
    [156, 156],
    [256, 156],
    [356, 156],
    [356, 256],
    [356, 356],
    [256, 356],
    [156, 356],
    [156, 256],
];

/** The six dots of `loading`: the top row left to right, then the bottom row right to left. */
const DOTS: Array<[number, number]> = [
    [156, 132],
    [256, 132],
    [356, 132],
    [356, 380],
    [256, 380],
    [156, 380],
];

/**
 * Lattice's mark, moving: see {@link LatticeMarkVariant} for the three animations. The drawings are
 * those of the icon set (`lattice-loading.svg`, `lattice-connecting.svg`, `lattice-speaking.svg`).
 * With reduced motion nothing moves and the mark stands as a still picture.
 */
export function LatticeMark({ variant, size, label, className }: Readonly<LatticeMarkProps>): JSX.Element {
    const dimension = size ?? (variant === "speaking" ? "1em" : "48px");
    const common = {
        "className": classNames(styles.mark, styles[variant], "mx_LatticeMark", className),
        "width": dimension,
        "height": dimension,
        "role": label ? "img" : undefined,
        "aria-label": label,
        "aria-hidden": label ? undefined : true,
        "data-variant": variant,
        "data-testid": "lattice-mark",
    };

    if (variant === "speaking") {
        return (
            <svg {...common} viewBox="0 0 64 64">
                <rect className={styles.voice} x="12" y="20" width="9" height="24" rx="4.5" />
                <rect className={styles.voice} x="27.5" y="12" width="9" height="40" rx="4.5" />
                <rect className={styles.voice} x="43" y="17" width="9" height="30" rx="4.5" />
            </svg>
        );
    }

    if (variant === "connecting") {
        return (
            <svg {...common} viewBox="0 0 512 512">
                <rect className={styles.tile} x="16" y="16" width="480" height="480" rx="112" />
                {RING.map(([cx, cy], i) => (
                    <circle
                        key={`${cx}-${cy}`}
                        className={styles.ring}
                        cx={cx}
                        cy={cy}
                        r="26"
                        style={{ animationDelay: `${(i * 0.267).toFixed(2)}s` }}
                    />
                ))}
                <circle className={styles.centre} cx="256" cy="256" r="34" />
            </svg>
        );
    }

    return (
        <svg {...common} viewBox="0 0 512 512">
            <rect className={styles.tile} x="16" y="16" width="480" height="480" rx="112" />
            {DOTS.map(([cx, cy], i) => (
                <circle
                    key={`${cx}-${cy}`}
                    className={styles.dot}
                    cx={cx}
                    cy={cy}
                    r="22"
                    style={{ animationDelay: `${(i * 0.12).toFixed(2)}s` }}
                />
            ))}
            <rect className={classNames(styles.bar, styles.accent)} x="134" y="196" width="44" height="120" rx="22" />
            <rect className={classNames(styles.bar, styles.light)} x="234" y="176" width="44" height="160" rx="22" />
            <rect className={classNames(styles.bar, styles.accent)} x="334" y="186" width="44" height="140" rx="22" />
        </svg>
    );
}
