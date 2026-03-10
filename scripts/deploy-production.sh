#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENVIRONMENT="${1:-production}"

echo "==> Building frontend"
cd "$ROOT_DIR/frontend"
npm run build

echo "==> Syncing frontend export to worker/public"
cd "$ROOT_DIR"
mkdir -p worker/public
rsync -a --delete frontend/out/ worker/public/

echo "==> Deploying worker to Cloudflare (${ENVIRONMENT})"
cd "$ROOT_DIR/worker"
npx wrangler deploy --env "$ENVIRONMENT"
