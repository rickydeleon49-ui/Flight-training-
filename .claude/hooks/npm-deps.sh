#!/bin/bash
# Installs frontend dependencies exactly as package-lock.json records them.
#
# Cold (no node_modules, or one not made from this lock): `npm ci`, which
# installs from the lock and fails rather than rewriting it when package.json
# and the lock disagree.
# Warm: node_modules is reused only when its marker matches the current lock's
# hash AND `npm ls` finds the tree complete. Anything else falls back to cold.
#
# Either way package.json and package-lock.json must be byte-identical
# afterwards; the script fails loudly if they are not.
set -euo pipefail

dir="${1:-.}"
cd "$dir"

marker="node_modules/.claude-lock.sha256"
tracked=(package.json package-lock.json)

lock_hash() { sha256sum package-lock.json | cut -d' ' -f1; }
tracked_hashes() { sha256sum "${tracked[@]}"; }

before="$(tracked_hashes)"
want="$(lock_hash)"

if [ -f "$marker" ] && [ "$(cat "$marker")" = "$want" ] \
  && npm ls --all --offline >/dev/null 2>&1; then
  echo "npm-deps: warm, node_modules matches package-lock.json"
else
  echo "npm-deps: cold, installing from package-lock.json"
  npm ci --no-audit --no-fund
  mkdir -p node_modules
  lock_hash > "$marker"
fi

after="$(tracked_hashes)"
if [ "$before" != "$after" ]; then
  echo "npm-deps: package.json or package-lock.json changed during setup" >&2
  diff <(echo "$before") <(echo "$after") >&2 || true
  exit 1
fi
