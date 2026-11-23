/*
Copyright 2026 The InterCom contributors

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    assetNameFor,
    backupDirFor,
    canReplaceDir,
    compareIntercomVersions,
    findSha256,
    type GithubRelease,
    isReleaseUrl,
    looksLikeInstall,
    parseIntercomVersion,
    relaunchCommand,
    selectUpdate,
    sha256File,
    stagingDirFor,
    swapInstallDir,
    verifyDownload,
} from "./intercom-updater-core.js";

const BASE = "https://github.com/c4g7-dev/InterCom/releases";

function release(tag: string, files?: string[], extra: Partial<GithubRelease> = {}): GithubRelease {
    const version = tag.replace(/^v/, "");
    const names = files ?? [`InterCom-${version}-linux-x64.tar.gz`, `InterCom-Setup-${version}-x64.exe`, "SHA256SUMS"];
    return {
        tag_name: tag,
        html_url: `${BASE}/tag/${tag}`,
        assets: names.map((name) => ({ name, browser_download_url: `${BASE}/download/${tag}/${name}`, size: 1 })),
        ...extra,
    };
}

describe("parseIntercomVersion", () => {
    it("reads versions and desktop tags", () => {
        expect(parseIntercomVersion("1.12.35-intercom.5")).toEqual({ base: [1, 12, 35], revision: 5 });
        expect(parseIntercomVersion("v1.12.35-intercom.12")).toEqual({ base: [1, 12, 35], revision: 12 });
    });

    it.each(["android-v26.11.1-intercom.2", "1.12.35", "v1.12.35-intercom", "1.12.35-intercom.x", "", undefined])(
        "takes %s for nothing",
        (text) => {
            expect(parseIntercomVersion(text)).toBeUndefined();
        },
    );
});

describe("compareIntercomVersions", () => {
    const order = [
        "1.12.35-intercom.4",
        "1.12.35-intercom.5",
        "1.12.35-intercom.10",
        "1.12.36-intercom.1",
        "1.13.0-intercom.1",
        "2.0.0-intercom.1",
    ];

    it("orders by Element version first, then by revision, as numbers", () => {
        for (let i = 0; i < order.length; i++) {
            for (let j = 0; j < order.length; j++) {
                const result = compareIntercomVersions(
                    parseIntercomVersion(order[i])!,
                    parseIntercomVersion(order[j])!,
                );
                expect(Math.sign(result)).toBe(Math.sign(i - j));
            }
        }
    });
});

describe("selectUpdate", () => {
    it("picks the newest desktop release that is newer, whatever the order", () => {
        const releases = [
            release("v1.12.35-intercom.5"),
            release("android-v26.11.1-intercom.9", ["InterCom-Android-26.11.1-intercom.9-arm64-v8a.apk"]),
            release("v1.12.35-intercom.10"),
            release("v1.12.35-intercom.4"),
            release("v1.12.35-intercom.6"),
        ];
        expect(selectUpdate(releases, "1.12.35-intercom.4", "linux", "x64")).toEqual({
            version: "1.12.35-intercom.10",
            releaseUrl: `${BASE}/tag/v1.12.35-intercom.10`,
            asset: {
                name: "InterCom-1.12.35-intercom.10-linux-x64.tar.gz",
                url: `${BASE}/download/v1.12.35-intercom.10/InterCom-1.12.35-intercom.10-linux-x64.tar.gz`,
                size: 1,
            },
            sumsUrl: `${BASE}/download/v1.12.35-intercom.10/SHA256SUMS`,
        });
        expect(selectUpdate(releases, "1.12.35-intercom.4", "win32", "x64")?.asset?.name).toBe(
            "InterCom-Setup-1.12.35-intercom.10-x64.exe",
        );
    });

    it("finds nothing when the running version is the newest, or newer", () => {
        const releases = [release("v1.12.35-intercom.5"), release("android-v99.0.0-intercom.1")];
        expect(selectUpdate(releases, "1.12.35-intercom.5", "linux", "x64")).toBeUndefined();
        expect(selectUpdate(releases, "1.12.36-intercom.1", "linux", "x64")).toBeUndefined();
        expect(selectUpdate([], "1.12.35-intercom.5", "linux", "x64")).toBeUndefined();
    });

    it("passes over drafts and pre-releases", () => {
        const releases = [
            release("v1.12.35-intercom.7", undefined, { draft: true }),
            release("v1.12.35-intercom.8", undefined, { prerelease: true }),
            release("v1.12.35-intercom.6"),
        ];
        expect(selectUpdate(releases, "1.12.35-intercom.5", "linux", "x64")?.version).toBe("1.12.35-intercom.6");
    });

    it("finds nothing for a build that has no InterCom version, or for an answer that is no list", () => {
        expect(selectUpdate([release("v1.12.35-intercom.6")], "1.12.35", "linux", "x64")).toBeUndefined();
        expect(
            selectUpdate(
                { message: "rate limited" } as unknown as GithubRelease[],
                "1.12.35-intercom.5",
                "linux",
                "x64",
            ),
        ).toBeUndefined();
    });

    it("reports a release without this platform's file or without checksums as it is", () => {
        const onlyWindows = [release("v1.12.35-intercom.6", ["InterCom-Setup-1.12.35-intercom.6-x64.exe"])];
        const found = selectUpdate(onlyWindows, "1.12.35-intercom.5", "linux", "x64");
        expect(found?.version).toBe("1.12.35-intercom.6");
        expect(found?.asset).toBeUndefined();
        expect(found?.sumsUrl).toBeUndefined();
        expect(
            selectUpdate([release("v1.12.35-intercom.6")], "1.12.35-intercom.5", "linux", "arm64")?.asset,
        ).toBeUndefined();
        expect(
            selectUpdate([release("v1.12.35-intercom.6")], "1.12.35-intercom.5", "darwin", "x64")?.asset,
        ).toBeUndefined();
    });

    it("takes no file from anywhere but the repository's releases", () => {
        const elsewhere = release("v1.12.35-intercom.6");
        elsewhere.assets![0].browser_download_url = "https://example.org/InterCom-1.12.35-intercom.6-linux-x64.tar.gz";
        elsewhere.html_url = "https://example.org/";
        const found = selectUpdate([elsewhere], "1.12.35-intercom.5", "linux", "x64");
        expect(found?.asset).toBeUndefined();
        expect(found?.releaseUrl).toBe(`${BASE}/tag/v1.12.35-intercom.6`);
        expect(isReleaseUrl("https://github.com/c4g7-dev/InterCom-evil/releases/x")).toBe(false);
        expect(isReleaseUrl(undefined)).toBe(false);
    });
});

describe("assetNameFor", () => {
    it("names the file of each platform", () => {
        expect(assetNameFor("1.12.35-intercom.5", "linux", "x64")).toBe("InterCom-1.12.35-intercom.5-linux-x64.tar.gz");
        expect(assetNameFor("1.12.35-intercom.5", "win32", "x64")).toBe("InterCom-Setup-1.12.35-intercom.5-x64.exe");
        expect(assetNameFor("1.12.35-intercom.5", "darwin", "x64")).toBeUndefined();
    });
});

describe("with files", () => {
    let tmp: string;
    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "intercom-updater-"));
    });
    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    describe("checksums", () => {
        const content = "an InterCom release, pretending";
        const hash = crypto.createHash("sha256").update(content).digest("hex");

        it("finds a file's checksum in SHA256SUMS", () => {
            const sums = `${"a".repeat(64)}  other.exe\r\n${hash.toUpperCase()} *InterCom.tar.gz\n\nnot a line\n`;
            expect(findSha256(sums, "InterCom.tar.gz")).toBe(hash);
            expect(findSha256(sums, "other.exe")).toBe("a".repeat(64));
            expect(findSha256(sums, "missing")).toBeUndefined();
            // The name must match as a whole
            expect(findSha256(sums, "tar.gz")).toBeUndefined();
        });

        it("accepts a download that matches", async () => {
            const file = path.join(tmp, "InterCom.tar.gz");
            fs.writeFileSync(file, content);
            expect(await sha256File(file)).toBe(hash);
            await expect(verifyDownload(file, "InterCom.tar.gz", `${hash}  InterCom.tar.gz\n`)).resolves.toBe(hash);
        });

        it("refuses a download that differs, is not listed or is not there", async () => {
            const file = path.join(tmp, "InterCom.tar.gz");
            fs.writeFileSync(file, content + "!");
            await expect(verifyDownload(file, "InterCom.tar.gz", `${hash}  InterCom.tar.gz\n`)).rejects.toThrow(
                /Checksum mismatch/,
            );
            await expect(verifyDownload(file, "InterCom.tar.gz", `${hash}  something-else\n`)).rejects.toThrow(
                /does not list/,
            );
            await expect(verifyDownload(path.join(tmp, "absent"), "absent", `${hash}  absent\n`)).rejects.toThrow();
        });
    });

    describe("swapping the install directory", () => {
        function makeInstall(dir: string, marker: string): void {
            fs.mkdirSync(path.join(dir, "resources"), { recursive: true });
            fs.writeFileSync(path.join(dir, "intercom"), marker, { mode: 0o755 });
            fs.writeFileSync(path.join(dir, "resources", "app.asar"), marker);
        }
        const read = (dir: string): string => fs.readFileSync(path.join(dir, "intercom"), "utf8");

        it("puts the new directory in place and keeps the old one as .old", async () => {
            const install = path.join(tmp, "intercom");
            makeInstall(install, "old");
            makeInstall(stagingDirFor(install), "new");

            const { backupDir } = await swapInstallDir(install, stagingDirFor(install));

            expect(backupDir).toBe(backupDirFor(install));
            expect(read(install)).toBe("new");
            expect(read(backupDir)).toBe("old");
            expect(fs.existsSync(stagingDirFor(install))).toBe(false);
            expect(fs.readdirSync(tmp).sort()).toEqual(["intercom", "intercom.old"]);
        });

        it("replaces an older backup", async () => {
            const install = path.join(tmp, "intercom");
            makeInstall(install, "old");
            makeInstall(backupDirFor(install), "ancient");
            makeInstall(stagingDirFor(install), "new");

            await swapInstallDir(install, stagingDirFor(install));

            expect(read(install)).toBe("new");
            expect(read(backupDirFor(install))).toBe("old");
        });

        it("touches nothing when there is no new directory", async () => {
            const install = path.join(tmp, "intercom");
            makeInstall(install, "old");
            makeInstall(backupDirFor(install), "ancient");

            await expect(swapInstallDir(install, stagingDirFor(install))).rejects.toThrow();

            expect(read(install)).toBe("old");
            expect(read(backupDirFor(install))).toBe("ancient");
        });

        it("puts the old directory back when the new one cannot be moved in", async () => {
            const install = path.join(tmp, "intercom");
            makeInstall(install, "old");
            // The second rename, the one that moves the new directory in, fails
            const staged = path.join(tmp, "elsewhere", "intercom.new");
            makeInstall(staged, "new");
            const realRename = fs.promises.rename;
            let calls = 0;
            fs.promises.rename = async (from, to): Promise<void> => {
                if (++calls === 2) throw new Error("EXDEV");
                return realRename(from, to);
            };
            try {
                await expect(swapInstallDir(install, staged)).rejects.toThrow("EXDEV");
            } finally {
                fs.promises.rename = realRename;
            }
            expect(read(install)).toBe("old");
            expect(fs.existsSync(backupDirFor(install))).toBe(false);
        });

        it("tells an install from something else", async () => {
            const install = path.join(tmp, "intercom");
            makeInstall(install, "x");
            expect(await looksLikeInstall(install, "intercom")).toBe(true);
            expect(await looksLikeInstall(install, "element-desktop")).toBe(false);
            fs.rmSync(path.join(install, "resources"), { recursive: true });
            expect(await looksLikeInstall(install, "intercom")).toBe(false);
        });

        it("says whether a directory can be replaced", async () => {
            const install = path.join(tmp, "intercom");
            makeInstall(install, "x");
            expect(await canReplaceDir(install)).toBe(true);
            expect(await canReplaceDir(path.join(tmp, "absent"))).toBe(false);
            if (process.getuid?.() !== 0) {
                fs.chmodSync(tmp, 0o555);
                try {
                    expect(await canReplaceDir(install)).toBe(false);
                } finally {
                    fs.chmodSync(tmp, 0o755);
                }
            }
        });
    });

    describe("relaunchCommand", () => {
        const exec = "/opt/intercom/intercom";
        const argv = [exec, "--ozone-platform-hint=auto", "--disable-quic", "--profile", "work"];

        it("starts the executable again with the switches it had", () => {
            expect(relaunchCommand(exec, argv, {})).toEqual({ execPath: exec, args: argv.slice(1) });
        });

        it("leaves out the link the app was opened with", () => {
            const withLink = [...argv, "intercom://vector/webapp/?loginToken=secret", "com.c4g7.intercom:/callback"];
            expect(relaunchCommand(exec, withLink, {}).args).toEqual(argv.slice(1));
        });

        it("goes through the launcher that says where it is, with the arguments the launcher was given", () => {
            const launcher = path.join(tmp, "intercom-launcher");
            fs.writeFileSync(launcher, "#!/bin/sh\n", { mode: 0o755 });
            expect(relaunchCommand(exec, argv, { INTERCOM_LAUNCHER: launcher })).toEqual({
                execPath: launcher,
                args: [],
            });
            expect(
                relaunchCommand(exec, argv, {
                    INTERCOM_LAUNCHER: launcher,
                    INTERCOM_LAUNCHER_ARGS: "--profile\nwork\nintercom://x\n",
                }),
            ).toEqual({ execPath: launcher, args: ["--profile", "work"] });
        });

        it("does without a launcher that is not there, not executable or not an absolute path", () => {
            const notExecutable = path.join(tmp, "plain");
            fs.writeFileSync(notExecutable, "", { mode: 0o644 });
            for (const launcher of [path.join(tmp, "absent"), notExecutable, "intercom", tmp]) {
                expect(relaunchCommand(exec, argv, { INTERCOM_LAUNCHER: launcher }).execPath).toBe(exec);
            }
        });
    });
});
