#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/docs/website-docs.json"
DST_DIR="$ROOT/frontend/public/docs"
DST="$DST_DIR/website-docs.json"
DOCS_ROOT="$ROOT/docs"
SKILL_REPO_DIR="$ROOT/clawgame-skill"
SKILL_DST_DIR="$ROOT/frontend/public"
SKILL_DOCS_DST_DIR="$ROOT/frontend/public/docs/skills"

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

if [ -f "$SKILL_REPO_DIR/SKILL.md" ] && [ -f "$SKILL_REPO_DIR/HOW_TO_PLAY.md" ]; then
  mkdir -p "$SKILL_DST_DIR" "$SKILL_DOCS_DST_DIR"
  cp "$SKILL_REPO_DIR/SKILL.md" "$SKILL_DST_DIR/SKILL.md"
  cp "$SKILL_REPO_DIR/HOW_TO_PLAY.md" "$SKILL_DST_DIR/HOW_TO_PLAY.md"
  cp "$SKILL_REPO_DIR/SKILL.md" "$SKILL_DOCS_DST_DIR/SKILL.md"
  cp "$SKILL_REPO_DIR/HOW_TO_PLAY.md" "$SKILL_DOCS_DST_DIR/HOW_TO_PLAY.md"
  echo "Synced skill docs from $SKILL_REPO_DIR -> $SKILL_DST_DIR and $SKILL_DOCS_DST_DIR"
fi
