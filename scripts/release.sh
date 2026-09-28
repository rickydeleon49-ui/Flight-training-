#!/usr/bin/env bash
#
# Cut a release.
#
#   scripts/release.sh 0.2.0
#
# Bumps the version everywhere it is recorded, runs the checks, commits and
# tags. Pushing the tag builds installers and prepares a private release draft
# for owner review, so that step is left to you — the command is printed at the end.
#
# The version matters beyond bookkeeping: the application backs her database
# up when it notices the version has changed since the last run. A release
# that forgets to bump is a release that skips her safety copy, so this
# refuses to tag one.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: scripts/release.sh <version>    e.g. scripts/release.sh 0.2.0"
  exit 1
fi

node scripts/check-release-version.mjs "$VERSION"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit or stash first."
  git status --short
  exit 1
fi

if git rev-parse --verify "refs/tags/v$VERSION" >/dev/null 2>&1; then
  echo "Tag v$VERSION already exists."
  exit 1
fi

VERSIONS_JSON="$(node -e '
  const fs = require("node:fs");
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8")).version;
  const tauri = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
  const cargoMatch = fs.readFileSync("src-tauri/Cargo.toml", "utf8").match(/^version\s*=\s*"([^"]+)"/m);
  const cargo = cargoMatch ? cargoMatch[1] : "";
  console.log(JSON.stringify({ pkg, lock, tauri, cargo }));
')"

PKG_VER="$(node -e "console.log(JSON.parse(process.argv[1]).pkg)" "$VERSIONS_JSON")"
LOCK_VER="$(node -e "console.log(JSON.parse(process.argv[1]).lock)" "$VERSIONS_JSON")"
TAURI_VER="$(node -e "console.log(JSON.parse(process.argv[1]).tauri)" "$VERSIONS_JSON")"
CARGO_VER="$(node -e "console.log(JSON.parse(process.argv[1]).cargo)" "$VERSIONS_JSON")"

BUMP=true
if [ "$VERSION" = "$PKG_VER" ] && [ "$VERSION" = "$LOCK_VER" ] && [ "$VERSION" = "$TAURI_VER" ] && [ "$VERSION" = "$CARGO_VER" ]; then
  BUMP=false
  echo "Repository is already prepared for the unreleased version $VERSION across all version files"
else
  echo "Releasing to $VERSION (current: package.json=$PKG_VER, lock=$LOCK_VER, tauri=$TAURI_VER, cargo=$CARGO_VER)"
fi

if [ "$BUMP" = true ]; then
  node scripts/bump-version.mjs "$VERSION"
fi

node -e '
  const fs = require("node:fs");
  const version = process.argv[1];
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8")).version;
  const tauri = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
  const cargoMatch = fs.readFileSync("src-tauri/Cargo.toml", "utf8").match(/^version\s*=\s*"([^"]+)"/m);
  const cargo = cargoMatch ? cargoMatch[1] : "";
  const lockMatch = fs.readFileSync("src-tauri/Cargo.lock", "utf8").match(/\[\[package\]\]\s+name\s*=\s*"her-flight-deck"\s+version\s*=\s*"([^"]+)"/);
  const cargoLock = lockMatch ? lockMatch[1] : "";
  if (pkg !== version || lock !== version || tauri !== version || cargo !== version || cargoLock !== version) {
    console.error(`Version mismatch: expected=${version} package.json=${pkg} lock=${lock} tauri=${tauri} cargo=${cargo} Cargo.lock=${cargoLock}`);
    process.exit(1);
  }
' "$VERSION"

echo
echo "Checks"
npm run typecheck
npm test
npm run test:cargo-lock

echo
if [ "$BUMP" = true ]; then
  git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
  git commit -q -m "release: $VERSION"
fi
git tag -a "v$VERSION" -m "Her Flight Deck $VERSION"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "Committed and tagged v$VERSION."
echo
echo "Push it to build installers and prepare a private release draft for owner review:"
echo
echo "    git push origin $BRANCH && git push origin v$VERSION"
echo
