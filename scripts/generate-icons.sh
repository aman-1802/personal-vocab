#!/usr/bin/env bash
# Converts icon.svg → icon-192.png and icon-512.png
# Requires: sudo apt install -y librsvg2-bin
set -e
ICONS_DIR="$(dirname "$0")/../client/public/icons"
rsvg-convert -w 192 -h 192 "$ICONS_DIR/icon.svg" -o "$ICONS_DIR/icon-192.png"
rsvg-convert -w 512 -h 512 "$ICONS_DIR/icon.svg" -o "$ICONS_DIR/icon-512.png"
echo "Icons generated."
