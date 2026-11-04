#!/usr/bin/env bash
# Build a TestFlight .ipa, or check one before upload.
#   scripts/testflight.sh                      bump build number, build, print ipa path
#   scripts/testflight.sh --check-only [ipa] [--record]
#                                              pre-upload checks on an existing ipa
# --record writes the build number to .last-testflight-build (do it after the upload).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
APPLE_DIR="src-tauri/gen/apple"
LAST_FILE="$APPLE_DIR/.last-testflight-build"

latest_ipa() {
  find "$APPLE_DIR/build" -name '*.ipa' -type f -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -n 1
}

if [ "${1:-}" = "--check-only" ]; then
  shift
  IPA=""
  RECORD=""
  for arg in "$@"; do
    case "$arg" in
      --record) RECORD="--record" ;;
      *) IPA="$arg" ;;
    esac
  done
  [ -n "$IPA" ] || IPA="$(latest_ipa)"
  [ -n "$IPA" ] && [ -f "$IPA" ] || { echo "No .ipa found. Pass a path." >&2; exit 2; }
  echo "Checking $IPA"
  exec node scripts/testflight-checks.mjs "$IPA" "$LAST_FILE" $RECORD
fi

[ "$#" -eq 0 ] || { echo "Usage: $0 [--check-only [ipa] [--record]]" >&2; exit 2; }

# The iOS build needs rustup's cargo (it has the aarch64-apple-ios std); a plain
# Homebrew rust earlier on PATH has no iOS target. Tauri's Xcode step reuses this PATH.
for d in "$HOME/.cargo/bin" /opt/homebrew/opt/rustup/bin; do
  if [ -x "$d/cargo" ] && [ -d "$HOME/.rustup" ]; then export PATH="$d:$PATH"; break; fi
done

LAST=0
[ -f "$LAST_FILE" ] && LAST="$(tr -dc '0-9' < "$LAST_FILE")"
BUILD="$(node scripts/bump-version.mjs --build "${LAST:-0}")"
echo "Build number is now $BUILD"

# Tauri rewrites CFBundleVersion from tauri.conf (the app version) unless bundle.iOS.bundleVersion is set.
npm run tauri ios build -- --export-method app-store-connect --config "{\"bundle\":{\"iOS\":{\"bundleVersion\":\"$BUILD\"}}}"

IPA="$(latest_ipa)"
[ -n "$IPA" ] || { echo "Build finished but no .ipa was found under $APPLE_DIR/build" >&2; exit 1; }
echo "IPA: $ROOT/$IPA"
echo "Next: scripts/testflight.sh --check-only \"$IPA\""
