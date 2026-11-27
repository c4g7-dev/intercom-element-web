/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

/**
 * The parts of InterCom's self-updater that need no Electron: comparing versions, choosing a
 * release, checking a download against SHA256SUMS, and swapping the install directory on Linux.
 * The glue to the app is in intercom-updater.ts.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * The file system without Electron's asar support. Electron's own `fs` treats every `.asar` file
 * as a directory, so removing an install tree (which holds `resources/app.asar`) fails with
 * ENOTEMPTY: the recursive removal tries to empty the archive like a folder. `original-fs` is
 * Electron's unpatched module; outside Electron (tests) it does not exist and `node:fs` is the same.
 */
const realFs: typeof fs = (() => {
    try {
        return createRequire(import.meta.url)("original-fs") as typeof fs;
    } catch {
        return fs;
    }
})();

/** Removes a directory tree that may contain `.asar` files, ignoring a missing one. */
export async function removeTree(dir: string): Promise<void> {
    await realFs.promises.rm(dir, { recursive: true, force: true });
}

/** An InterCom desktop version: the Element Web release it is based on, then the InterCom revision. */
export interface IntercomVersion {
    /** major, minor and patch of the Element Web release */
    base: [number, number, number];
    /** the InterCom revision, the `n` of `-intercom.n` */
    revision: number;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)-intercom\.(\d+)$/;

/**
 * Reads `1.12.35-intercom.5` or the tag `v1.12.35-intercom.5`.
 * @returns undefined for anything else, e.g. the Android tags (`android-v26.11.1-intercom.2`)
 */
export function parseIntercomVersion(text: string | undefined | null): IntercomVersion | undefined {
    const match = VERSION_RE.exec(text?.trim() ?? "");
    if (!match) return undefined;
    return { base: [Number(match[1]), Number(match[2]), Number(match[3])], revision: Number(match[4]) };
}

/** @returns below 0 if `a` is older than `b`, 0 if they are the same, above 0 if `a` is newer */
export function compareIntercomVersions(a: IntercomVersion, b: IntercomVersion): number {
    for (let i = 0; i < 3; i++) {
        if (a.base[i] !== b.base[i]) return a.base[i] - b.base[i];
    }
    return a.revision - b.revision;
}

/** The fields of a release of the GitHub API that the updater reads. */
export interface GithubRelease {
    tag_name: string;
    html_url: string;
    draft?: boolean;
    prerelease?: boolean;
    /** The release's notes, as Markdown: the section of CHANGELOG.md */
    body?: string;
    assets?: Array<{ name: string; browser_download_url: string; size?: number }>;
}

/** A release that is newer than the running app. */
export interface UpdateCandidate {
    /** e.g. `1.12.35-intercom.6` */
    version: string;
    /** The release's page, which holds its notes */
    releaseUrl: string;
    /** The file to install on this platform; undefined if the release does not have one (yet) */
    asset?: { name: string; url: string; size?: number };
    /** Where the release's SHA256SUMS is; undefined if it has none */
    sumsUrl?: string;
}

/** The repository whose releases are InterCom's. */
export const UPDATE_REPO = "c4g7-dev/InterCom";

/** Whether a URL is a page or a file of a release of {@link UPDATE_REPO}; nothing else is opened or downloaded. */
export function isReleaseUrl(url: string | undefined, repo = UPDATE_REPO): boolean {
    return typeof url === "string" && url.startsWith(`https://github.com/${repo}/releases/`);
}

/** The name of the file of a release that is installed on a platform. */
export function assetNameFor(version: string, platform: NodeJS.Platform, arch: string): string | undefined {
    if (arch !== "x64") return undefined;
    if (platform === "linux") return `InterCom-${version}-linux-x64.tar.gz`;
    if (platform === "win32") return `InterCom-Setup-${version}-x64.exe`;
    return undefined;
}

/**
 * Picks the newest desktop release that is newer than `current`.
 * Drafts, pre-releases and releases of anything else (Android) are passed over.
 */
export function selectUpdate(
    releases: GithubRelease[],
    current: string,
    platform: NodeJS.Platform,
    arch: string,
): UpdateCandidate | undefined {
    const running = parseIntercomVersion(current);
    if (!running || !Array.isArray(releases)) return undefined;

    let best: { release: GithubRelease; version: IntercomVersion } | undefined;
    for (const release of releases) {
        if (!release || release.draft || release.prerelease) continue;
        if (typeof release.tag_name !== "string" || !release.tag_name.startsWith("v")) continue;
        const version = parseIntercomVersion(release.tag_name);
        if (!version || compareIntercomVersions(version, running) <= 0) continue;
        if (!best || compareIntercomVersions(version, best.version) > 0) best = { release, version };
    }
    if (!best) return undefined;

    const version = best.release.tag_name.slice(1);
    const assets = (best.release.assets ?? []).filter((a) => isReleaseUrl(a?.browser_download_url));
    const wanted = assetNameFor(version, platform, arch);
    const asset = assets.find((a) => a.name === wanted);
    return {
        version,
        releaseUrl: isReleaseUrl(best.release.html_url)
            ? best.release.html_url
            : `https://github.com/${UPDATE_REPO}/releases/tag/${best.release.tag_name}`,
        asset: asset && { name: asset.name, url: asset.browser_download_url, size: asset.size },
        sumsUrl: assets.find((a) => a.name === "SHA256SUMS")?.browser_download_url,
    };
}

/**
 * Finds a file's checksum in the text of a SHA256SUMS file (`<hex>  <name>` per line, as
 * sha256sum writes it; a `*` before the name marks binary mode).
 */
export function findSha256(sums: string, fileName: string): string | undefined {
    for (const line of sums.split(/\r?\n/)) {
        const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
        if (match && match[2] === fileName) return match[1].toLowerCase();
    }
    return undefined;
}

/** The SHA-256 of a file, in lower case hex. */
export async function sha256File(file: string): Promise<string> {
    const hash = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
    return hash.digest("hex");
}

/**
 * Checks a downloaded file against SHA256SUMS.
 * @throws if the file is not listed or its checksum differs
 */
export async function verifyDownload(file: string, fileName: string, sums: string): Promise<string> {
    const expected = findSha256(sums, fileName);
    if (!expected) throw new Error(`SHA256SUMS does not list ${fileName}`);
    const actual = await sha256File(file);
    if (actual !== expected) throw new Error(`Checksum mismatch for ${fileName}: expected ${expected}, got ${actual}`);
    return actual;
}

/** Whether a directory can be replaced by a sibling: both it and its parent must be writable. */
export async function canReplaceDir(dir: string): Promise<boolean> {
    try {
        await fs.promises.access(dir, fs.constants.W_OK);
        await fs.promises.access(path.dirname(dir), fs.constants.W_OK);
        return true;
    } catch {
        return false;
    }
}

/** Where a downloaded release is unpacked before the swap: beside the install directory. */
export function stagingDirFor(installDir: string): string {
    return `${installDir}.new`;
}

/** Where the replaced install directory is kept. */
export function backupDirFor(installDir: string): string {
    return `${installDir}.old`;
}

/**
 * Whether a directory holds an unpacked InterCom: the executable and the app's archive.
 * @param executableName - the name of the executable in it, e.g. `intercom`
 */
export async function looksLikeInstall(dir: string, executableName: string): Promise<boolean> {
    try {
        // Through original-fs: Electron's fs sees app.asar as a directory and reports ENOENT for
        // a readable-file check on it, which made every Linux update of 1.12.35-intercom.5 to .9
        // stop with "The archive does not hold an InterCom install"
        await realFs.promises.access(path.join(dir, executableName), realFs.constants.X_OK);
        await realFs.promises.access(path.join(dir, "resources", "app.asar"), realFs.constants.R_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * Puts the staged directory in the place of the install directory. Both renames are within one
 * directory, so each is atomic; the install that is replaced is kept as `<dir>.old` (an older
 * backup is deleted first). If the staged directory cannot be moved in, the old one is put back.
 *
 * Works while the app runs from `installDir` on Linux: the running process keeps its open files.
 */
export async function swapInstallDir(installDir: string, stagedDir: string): Promise<{ backupDir: string }> {
    const backupDir = backupDirFor(installDir);
    await fs.promises.access(stagedDir);
    await removeTree(backupDir);
    await realFs.promises.rename(installDir, backupDir);
    try {
        await realFs.promises.rename(stagedDir, installDir);
    } catch (e) {
        await realFs.promises.rename(backupDir, installDir);
        throw e;
    }
    return { backupDir };
}

/** URL schemes the app is opened with for a single action (sign-in callbacks, links). */
const ONE_SHOT_ARG = /^(intercom|com\.c4g7\.intercom|element|io\.element\.desktop|vector):/i;

/**
 * How to start the app again after an update, with the switches it was started with.
 *
 * A launcher script that exports `INTERCOM_LAUNCHER=<its own path>` is started again itself, with
 * the arguments it was given if it also exports them one per line in `INTERCOM_LAUNCHER_ARGS`, so
 * that whatever the launcher sets up (environment, switches) is set up again. Without a launcher
 * the executable is started with the same arguments. Links the app was opened with are left out.
 */
export function relaunchCommand(
    execPath: string,
    argv: string[],
    env: NodeJS.ProcessEnv,
): { execPath: string; args: string[] } {
    const launcher = env.INTERCOM_LAUNCHER;
    if (launcher && path.isAbsolute(launcher) && isExecutableFile(launcher)) {
        const given = env.INTERCOM_LAUNCHER_ARGS;
        const args = given === undefined ? [] : given.split("\n").filter(Boolean);
        return { execPath: launcher, args: args.filter((a) => !ONE_SHOT_ARG.test(a)) };
    }
    return { execPath, args: argv.slice(1).filter((a) => !ONE_SHOT_ARG.test(a)) };
}

function isExecutableFile(file: string): boolean {
    try {
        fs.accessSync(file, fs.constants.X_OK);
        return fs.statSync(file).isFile();
    } catch {
        return false;
    }
}

/** Arguments that make the NSIS installer of electron-builder install silently and start the app again. */
export const WINDOWS_INSTALLER_ARGS = ["--updated", "/S", "--force-run"];
