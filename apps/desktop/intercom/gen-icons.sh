#!/usr/bin/env bash
# Regenerates every InterCom icon from intercom/icon.svg. Needs rsvg-convert and ImageMagick.
set -euo pipefail
cd "$(dirname "$0")"
DESKTOP=..
WEB=../../web

render() { rsvg-convert -w "$1" -h "$1" icon.svg -o "$2"; }

# Desktop: window/tray icon, Linux package icon, Windows icon, macOS Icon Composer source
render 512 "$DESKTOP/build/icon.png"
tmp=$(mktemp -d)
for s in 16 24 32 48 64 128 256; do render "$s" "$tmp/$s.png"; done
magick "$tmp/16.png" "$tmp/24.png" "$tmp/32.png" "$tmp/48.png" "$tmp/64.png" "$tmp/128.png" "$tmp/256.png" "$DESKTOP/build/icon.ico"
rm -rf "$tmp"
mkdir -p "$DESKTOP/build/icon.icon/Assets"
render 1024 "$DESKTOP/build/icon.icon/Assets/intercom.png"

# Web: favicons, PWA icons, and the logo shown on the auth, home and error pages
for s in 24 120 144 152 180 512 1024; do render "$s" "$WEB/res/vector-icons/$s.png"; done
mkdir -p "$WEB/res/themes/intercom/img/logos"
cp logo.svg "$WEB/res/themes/intercom/img/logos/intercom-logo.svg"
