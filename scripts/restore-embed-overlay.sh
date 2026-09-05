#!/usr/bin/env bash
# Drops the SPA build overlaid into the go:embed directory and puts the
# committed placeholder back, leaving the working tree clean. Idempotent; a
# no-op outside a git checkout (an exported tarball just keeps the overlay).
set -euo pipefail
cd "$(dirname "$0")/.."

EMBED_DIRS=(
  apps/server/internal/web/dist
)

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  for dir in "${EMBED_DIRS[@]}"; do
    # clean first, then checkout: `git clean` removes the Vite output the
    # overlay dropped here, and `git checkout --` restores the placeholder
    # index.html it overwrote.
    #
    # -x, and this is the one place it is wanted: .gitignore ignores
    # everything in this directory except the placeholder (so that a stray
    # SPA build can never be staged by `git add -A`), which also means a
    # plain `git clean -fd` walks straight past the overlay and leaves it on
    # disk — invisible to `git status` and still embedded by the next
    # `go build`. The flag is scoped to this directory alone, where the only
    # thing git tracks is the placeholder that the next line restores.
    git clean -qfdx "$dir"
    git checkout -q -- "$dir"
  done
fi
