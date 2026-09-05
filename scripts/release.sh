#!/usr/bin/env bash
#
# Cut a release.
#
#   scripts/release.sh 0.2.0
#
# Bumps the version everywhere it is recorded, runs the checks, commits and
# tags. Pushing the tag is what builds the installers and publishes them, so
# that step is left to you — the command is printed at the end.
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

CURRENT="$(node -p "require('./package.json').version")"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree is not clean. Commit or stash first."
  git status --short
  exit 1
fi

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "Tag v$VERSION already exists."
  exit 1
fi

# Re-releasing the version already in the files is only sensible the first
# time, when nothing has shipped yet. After that a bump is required, because
# the application only takes its safety copy when the version changes.
BUMP=true
if [ "$VERSION" = "$CURRENT" ]; then
  if [ -n "$(git tag --list 'v*')" ]; then
    echo "Already at $CURRENT and earlier releases exist."
    echo "Pick a higher version, or her database will not be copied on update."
    exit 1
  fi
  BUMP=false
  echo "First release of $VERSION"
else
  echo "Releasing $CURRENT -> $VERSION"
fi

if [ "$BUMP" = true ]; then
node -e '
  const fs = require("node:fs");
  const version = process.argv[1];

  for (const file of ["package.json", "src-tauri/tauri.conf.json"]) {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    json.version = version;
    fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  }

  // Only the package version, never a dependency that happens to match.
  const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
  fs.writeFileSync(
    "src-tauri/Cargo.toml",
    cargo.replace(/^version = ".*"$/m, `version = "${version}"`),
  );
' "$VERSION"

# Cargo.lock records the package version too, and is committed.
( cd src-tauri && cargo update --workspace --quiet 2>/dev/null || cargo check --quiet >/dev/null 2>&1 || true )
fi

echo
echo "Checks"
npm run typecheck
npm test

echo
if [ "$BUMP" = true ]; then
  git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
  git commit -q -m "release: $VERSION"
fi
git tag -a "v$VERSION" -m "Her Flight Deck $VERSION"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "Committed and tagged v$VERSION."
echo
echo "Push it to build and publish the installers:"
echo
echo "    git push origin $BRANCH && git push origin v$VERSION"
echo
