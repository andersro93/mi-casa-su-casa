#!/usr/bin/env bash
# Builds the SPA and overlays it into apps/server/internal/web/dist, where
# go:embed picks it up at compile time (a committed placeholder index.html
# normally sits there so plain `go build`/`go test` work without a frontend
# build). Used by scripts/build-artifacts.sh — callers are responsible for
# restoring the overlay afterwards (scripts/restore-embed-overlay.sh) so the
# working tree stays clean.
set -euo pipefail
cd "$(dirname "$0")/.."

EMBED_DIR=apps/server/internal/web/dist

echo "==> SPA (vite)"
# Through the workspace filter rather than `cd apps/frontend && bun run
# build`: the SPA's dependencies are hoisted to the root node_modules, so
# the build must run with the workspace root resolved.
bun run --filter @mi-casa/frontend build   # writes dist/client at the repo root

echo "==> embed overlay"
rm -rf "$EMBED_DIR"
mkdir -p "$EMBED_DIR"
cp -R dist/client/. "$EMBED_DIR/"
