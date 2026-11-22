#!/usr/bin/env bash
# Builds InterCom for Linux from this checkout: the web app, webapp.asar with the InterCom config,
# then the desktop app (unpacked directory + tar.gz) in apps/desktop/dist.
#
# Needs pnpm 12 (see devEngines in the root package.json). Heavy steps run one at a time.
#
#   INTERCOM_DIST_DIR=dist-next   build beside a running app instead of replacing dist/
#   INTERCOM_TARGET=win           cross-build the Windows x64 installer (needs wine), see README
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=6144}"

if [[ "${1:-}" != "--skip-web" ]]; then
    # webpack does not clean its output, stale bundles would end up in the asar
    rm -rf ../web/webapp
    (cd ../web && pnpm exec nx run-many -t build -p element-web --parallel=1)
fi

rm -rf webapp webapp.asar
cp -r ../web/webapp webapp
cp intercom/config.json webapp/config.json
pnpm run asar-webapp
rm -rf webapp

pnpm exec nx run-many -t build:ts,build:res -p element-desktop --parallel=1
if [[ "${INTERCOM_TARGET:-linux}" == "win" ]]; then
    export INTERCOM_DIST_DIR="${INTERCOM_DIST_DIR:-dist-win}"
    pnpm exec electron-builder --win nsis --x64 --publish never
else
    pnpm exec electron-builder --linux dir tar.gz --x64 --publish never
fi
