#!/usr/bin/env bash
# Build a TestFlight .ipa, or check one before upload.
#   scripts/testflight.sh                      bump build number, build, check, upload to TestFlight, record
#   scripts/testflight.sh --build-only         same but stop before the upload (prints the ipa path)
#   scripts/testflight.sh --check-only [ipa] [--record]
#                                              pre-upload checks on an existing ipa
# --record writes the build number to .last-testflight-build (do it after the upload).
# Auth: App Store Connect API key if ~/.apple-keys/asc.conf exists (ASC_KEY_ID= and ASC_ISSUER_ID=,
# key file ~/.apple-keys/AuthKey_<ASC_KEY_ID>.p8); no Xcode sign-in needed. Without asc.conf it
# falls back to the Apple ID signed in to Xcode (Settings > Accounts).
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

UPLOAD=1
[ "${1:-}" = "--build-only" ] && { UPLOAD=0; shift; }
[ "$#" -eq 0 ] || { echo "Usage: $0 [--build-only | --check-only [ipa] [--record]]" >&2; exit 2; }

# The iOS build needs rustup's cargo (it has the aarch64-apple-ios std); a plain
# Homebrew rust earlier on PATH has no iOS target. Tauri's Xcode step reuses this PATH.
for d in "$HOME/.cargo/bin" /opt/homebrew/opt/rustup/bin; do
  if [ -x "$d/cargo" ] && [ -d "$HOME/.rustup" ]; then export PATH="$d:$PATH"; break; fi
done

LAST=0
[ -f "$LAST_FILE" ] && LAST="$(tr -dc '0-9' < "$LAST_FILE")"
BUILD="$(node scripts/bump-version.mjs --build "${LAST:-0}")"
echo "Build number is now $BUILD"

AUTH=()
ASC_CONF="$HOME/.apple-keys/asc.conf"
if [ -f "$ASC_CONF" ]; then
  # shellcheck disable=SC1090
  . "$ASC_CONF"
  KEY="$HOME/.apple-keys/AuthKey_${ASC_KEY_ID:-}.p8"
  [ -n "${ASC_KEY_ID:-}" ] && [ -n "${ASC_ISSUER_ID:-}" ] && [ -f "$KEY" ] \
    || { echo "asc.conf needs ASC_KEY_ID and ASC_ISSUER_ID, and $KEY must exist" >&2; exit 1; }
  # Tauri passes these to its xcodebuild archive step as -authenticationKey* flags.
  export APPLE_API_KEY="$ASC_KEY_ID" APPLE_API_ISSUER="$ASC_ISSUER_ID" APPLE_API_KEY_PATH="$KEY"
  AUTH=(-authenticationKeyPath "$KEY" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
  echo "Auth: App Store Connect API key $ASC_KEY_ID (no Xcode sign-in needed)"
else
  echo "Auth: Apple ID signed in to Xcode (no $ASC_CONF)"
fi

# Tauri rewrites CFBundleVersion from tauri.conf (the app version) unless bundle.iOS.bundleVersion is set.
npm run tauri ios build -- --export-method app-store-connect --config "{\"bundle\":{\"iOS\":{\"bundleVersion\":\"$BUILD\"}}}"

IPA="$(latest_ipa)"
[ -n "$IPA" ] || { echo "Build finished but no .ipa was found under $APPLE_DIR/build" >&2; exit 1; }
echo "IPA: $ROOT/$IPA"
if [ "$UPLOAD" = 0 ]; then
  echo "Next: scripts/testflight.sh --check-only \"$IPA\""
  exit 0
fi

# Pre-upload checks must pass before anything is sent to Apple.
node scripts/testflight-checks.mjs "$IPA" "$LAST_FILE"

# Upload the same archive (API key above, or Xcode's signed-in account).
ARCHIVE="$APPLE_DIR/build/her-flight-deck_iOS.xcarchive"
[ -d "$ARCHIVE" ] || { echo "No archive at $ARCHIVE" >&2; exit 1; }
UPDIR="$(mktemp -d)"
cp "$APPLE_DIR/build/ExportOptions.plist" "$UPDIR/ExportOptions.plist"
plutil -replace destination -string upload "$UPDIR/ExportOptions.plist"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$UPDIR/ExportOptions.plist" \
  -exportPath "$UPDIR" -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"}
node scripts/testflight-checks.mjs "$IPA" "$LAST_FILE" --record
echo "Uploaded build $BUILD. Apple emails when processing is done (about 10-30 min); testers get it in the TestFlight app."
