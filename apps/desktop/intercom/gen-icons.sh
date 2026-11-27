#!/usr/bin/env bash
# Regenerates every icon of the app from the Lattice set in intercom/brand/ (the masters are
# lattice.svg, and lattice-small.svg for 32 px and below). Needs rsvg-convert and ImageMagick.
set -euo pipefail
cd "$(dirname "$0")"
DESKTOP=..
WEB=../../web
BRAND=brand

# The small drawing (bars only) where the dots of the lattice would be mud
render() {
    local src="$BRAND/lattice.svg"
    if (($1 <= 32)); then src="$BRAND/lattice-small.svg"; fi
    rsvg-convert -w "$1" -h "$1" "$src" -o "$2"
}

# Desktop: window icon, Linux package icon, Windows icon, macOS Icon Composer source
render 512 "$DESKTOP/build/icon.png"
tmp=$(mktemp -d)
for s in 16 24 32 48 64 128 256; do render "$s" "$tmp/$s.png"; done
magick "$tmp/16.png" "$tmp/24.png" "$tmp/32.png" "$tmp/48.png" "$tmp/64.png" "$tmp/128.png" "$tmp/256.png" "$DESKTOP/build/icon.ico"
rm -rf "$tmp"
mkdir -p "$DESKTOP/build/icon.icon/Assets"
render 1024 "$DESKTOP/build/icon.icon/Assets/intercom.png"

# The tray on Linux: the mark alone, white (src/icon.ts)
rsvg-convert -w 24 -h 24 "$BRAND/lattice-tray-mono.svg" -o "$DESKTOP/build/tray-mono.png"
rsvg-convert -w 48 -h 48 "$BRAND/lattice-tray-mono.svg" -o "$DESKTOP/build/tray-mono@2x.png"

# Web: favicons, PWA icons, and the logo shown on the auth, home and error pages. The file keeps
# its name (themes/intercom/…), which the configuration of installs may point to.
for s in 24 120 144 152 180 512 1024; do render "$s" "$WEB/res/vector-icons/$s.png"; done
mkdir -p "$WEB/res/themes/intercom/img/logos"
cp logo.svg "$WEB/res/themes/intercom/img/logos/intercom-logo.svg"
