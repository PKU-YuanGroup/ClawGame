#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/docs/website-docs.json"
DST_DIR="$ROOT/frontend/public/docs"
DST="$DST_DIR/website-docs.json"
DOCS_ROOT="$ROOT/docs"
SKILLS_SRC_DIR="$ROOT/docs/skills"
PUBLIC_ROOT="$ROOT/frontend/public"

mkdir -p "$DST_DIR"
cp "$SRC" "$DST"
echo "Synced $SRC -> $DST"

# Sync all markdown docs under docs/ to frontend/public/docs/, preserving structure.
while IFS= read -r -d '' md_file; do
  rel_path="${md_file#$DOCS_ROOT/}"
  dst_file="$DST_DIR/$rel_path"
  mkdir -p "$(dirname "$dst_file")"
  cp "$md_file" "$dst_file"
  echo "Synced $md_file -> $dst_file"
done < <(find "$DOCS_ROOT" -type f -name "*.md" -print0)

if [ -d "$SKILLS_SRC_DIR" ]; then
  find "$SKILLS_SRC_DIR" -maxdepth 1 -type f -name "*.md" | while read -r skill_file; do
    base_name="$(basename "$skill_file")"
    cp "$skill_file" "$PUBLIC_ROOT/$base_name"
    echo "Synced $skill_file -> $PUBLIC_ROOT/$base_name"
  done
fi
