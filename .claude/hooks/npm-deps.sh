#!/bin/bash
# Installs frontend dependencies exactly as package-lock.json records them.
#
# Cold (no node_modules, or one not made from this lock): `npm ci`, which
# installs from the lock and never writes it. A real mismatch between
# package.json and the lock makes it fail visibly.
# Warm: node_modules is reused only when its marker, written after the last
# successful `npm ci`, matches the current package-lock.json, package.json and
# Node major version, AND `npm ls --all` finds the installed tree complete.
# Anything else falls back to cold.
#
# Either way package.json and package-lock.json must be byte-identical
# afterwards; the script fails loudly if they are not.
set -euo pipefail

dir="${1:-.}"
cd "$dir"

fail() {
  echo "npm-deps: $*" >&2
  exit 1
}

[ -f package-lock.json ] || fail "package-lock.json is missing; cannot install dependencies reproducibly."

marker="node_modules/.claude-setup"
tracked=(package.json package-lock.json)

# git hash-object works outside a repository and on both macOS and Linux.
tracked_hashes() { git hash-object -- "${tracked[@]}"; }
setup_key() {
  printf '%s %s node%s' \
    "$(git hash-object -- package-lock.json)" \
    "$(git hash-object -- package.json)" \
    "$(node -p 'process.versions.node.split(".")[0]')"
}

before="$(tracked_hashes)"
want="$(setup_key)"

if [ -f "$marker" ] && [ "$(cat "$marker")" = "$want" ] \
  && npm ls --all --offline >/dev/null 2>&1; then
  echo "npm-deps: warm, node_modules matches package-lock.json"
else
  echo "npm-deps: cold, installing from package-lock.json (npm ci)"
  npm ci --no-audit --no-fund \
    || fail "npm ci failed. package.json and package-lock.json may disagree; fix that in a reviewed change, not during setup."
  mkdir -p node_modules
  printf '%s' "$want" > "$marker"
fi

after="$(tracked_hashes)"
if [ "$before" != "$after" ]; then
  echo "npm-deps: package.json or package-lock.json changed during setup" >&2
  diff <(echo "$before") <(echo "$after") >&2 || true
  exit 1
fi
