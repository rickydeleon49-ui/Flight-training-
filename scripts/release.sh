#!/usr/bin/env bash
#
# Cut a release.
#
#   scripts/release.sh 0.2.0 --no-tag   # on the release branch: bump + commit, no tag
#   scripts/release.sh 0.2.0            # on merged main (HEAD = origin/main): checks + tag
#
# Tags are made only on main's head; tagging refuses when a bump is still needed.
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

VERSION=""
NO_TAG=false
for arg in "$@"; do
  case "$arg" in
    --no-tag) NO_TAG=true ;;
    *) if [ -z "$VERSION" ]; then VERSION="$arg"; else VERSION="invalid"; fi ;;
  esac
done
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: scripts/release.sh <version> [--no-tag]    e.g. scripts/release.sh 0.2.0"
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

BUMP=true
if node scripts/check-release-version.mjs "$VERSION" --agree >/dev/null 2>&1; then
  BUMP=false
  echo "Repository is already prepared for the unreleased version $VERSION across all version files (including the iOS marketing version)"
else
  echo "Releasing to $VERSION (current: package.json=$(node -p "require('./package.json').version"))"
fi

# The release workflow builds only a tag on main's head. A bump needs a commit
# that is not on main yet, so it goes through a PR (--no-tag); the tag comes
# afterwards, from a prepared checkout whose HEAD is origin/main.
if [ "$NO_TAG" = false ]; then
  if [ "$BUMP" = true ]; then
    echo "The version files need a bump commit, which is not main's head yet."
    echo "Run with --no-tag, merge the release PR, then run this again on main to tag."
    exit 1
  fi
  git fetch -q origin main 2>/dev/null || true
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse -q --verify origin/main 2>/dev/null || true)" ]; then
    echo "HEAD is not origin/main. Tag only main's head: check out the merged main and run this again."
    exit 1
  fi
fi

CHANGED_FILES=""
if [ "$BUMP" = true ]; then
  BUMP_LOG="$(mktemp "${TMPDIR:-/tmp}/hfd-bump.XXXXXX")"
  node scripts/bump-version.mjs "$VERSION" | tee "$BUMP_LOG"
  CHANGED_FILES="$(sed -n 's/^CHANGED: //p' "$BUMP_LOG" | tail -n 1)"
  rm -f "$BUMP_LOG"
  if [ -z "$CHANGED_FILES" ]; then
    echo "bump-version did not report the files it changed."
    exit 1
  fi
fi

# Every version file (including the iOS marketing version) must say $VERSION.
node scripts/check-release-version.mjs "$VERSION" --agree

echo
echo "Checks"
# Match the installer workflow; this script prepares a tag, it does not build.
# README.md: Offline PDF reading and search documents both build gates.
export HFD_OFFLINE_EXTRACTION=1
npm run typecheck
npm test
npm run test:cargo-lock

echo
if [ "$BUMP" = true ]; then
  # Stage exactly the files bump-version reported (no list here that can drift).
  # shellcheck disable=SC2086
  git add -- $CHANGED_FILES
  git commit -q -m "release: $VERSION"
fi

LEFTOVER="$(git status --porcelain)"
if [ -n "$LEFTOVER" ]; then
  echo "bump left uncommitted files: $(printf '%s\n' "$LEFTOVER" | sed 's/^...//' | tr '\n' ' ')"
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$NO_TAG" = true ]; then
  echo "Committed $VERSION without a tag (--no-tag). Make the tag on main's head after the merge:"
  echo
  echo "    git tag -a v$VERSION -m \"Your Flight Deck $VERSION\""
  echo
  exit 0
fi
git tag -a "v$VERSION" -m "Your Flight Deck $VERSION"

echo "Committed and tagged v$VERSION."
echo
echo "Push it to build installers and prepare a private release draft for owner review:"
echo
echo "    git push origin $BRANCH && git push origin v$VERSION"
echo
