#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/docs/website-docs.json"
DST_DIR="$ROOT/frontend/public/docs"
DST="$DST_DIR/website-docs.json"

mkdir -p "$DST_DIR"
cp "$SRC" "$DST"
echo "Synced $SRC -> $DST"
