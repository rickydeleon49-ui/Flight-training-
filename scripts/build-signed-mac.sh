#!/usr/bin/env bash
#
# Build, sign, notarize and staple the Mac installer on this Mac.
#
#   scripts/build-signed-mac.sh 0.6.1
#
# Local-first Developer ID path (owner approved 28 October 2026). See
# docs/MAC_SIGNING_LOCAL_2026-10-28.md for the one-time owner steps.
#
# Needs, already set up by the owner and never stored in this repository:
#   - one "Developer ID Application: <name> (TEAMID)" identity in the login
#     keychain (or APPLE_SIGNING_IDENTITY naming exactly one of them);
#   - a notarytool keychain profile named hfd-notary.
#
# This script never reads or prints a secret, never removes quarantine and
# never weakens Gatekeeper. The committed tauri.conf.json keeps its ad-hoc
# signingIdentity "-"; the real identity reaches Tauri only through this run's
# environment and a temporary --config file outside the repository.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NOTARY_PROFILE="hfd-notary"
BUNDLE_ID="com.herflightdeck.app"
DMG_DIR="src-tauri/target/release/bundle/dmg"

fail() {
  echo "Stopped: $*" >&2
  exit 1
}

VERSION="${1:-}"
if [[ $# -ne 1 || ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: scripts/build-signed-mac.sh <version>    e.g. scripts/build-signed-mac.sh 0.6.1" >&2
  exit 1
fi

[[ "$(uname -s)" == "Darwin" ]] || fail "this script signs Mac installers and must run on macOS."

if [[ -n "$(git status --porcelain)" ]]; then
  git status --short >&2
  fail "the working tree is not clean. Build only from the committed release."
fi

TAG="v$VERSION"
if ! TAG_COMMIT="$(git rev-parse --verify --quiet "refs/tags/$TAG^{commit}")"; then
  fail "tag $TAG does not exist here. Run scripts/release.sh $VERSION first (or fetch the tag)."
fi
HEAD_COMMIT="$(git rev-parse HEAD)"
if [[ "$TAG_COMMIT" != "$HEAD_COMMIT" ]]; then
  fail "HEAD ($HEAD_COMMIT) is not tag $TAG ($TAG_COMMIT). Check out $TAG first."
fi

# --- Signing identity --------------------------------------------------------
# Only identity names are read here; the private key never leaves the keychain.
IDENTITIES=()
while IFS= read -r name; do
  [[ -n "$name" ]] && IDENTITIES+=("$name")
done < <(security find-identity -v -p codesigning 2>/dev/null \
  | sed -n 's/^ *[0-9][0-9]*) [0-9A-F]\{40\} "\(Developer ID Application: .*\)"$/\1/p' | sort -u)

NO_IDENTITY_HELP="No valid \"Developer ID Application\" signing identity is in the login keychain.
Owner step: create a Developer ID Application certificate in your Apple Developer account
and install it in the login keychain (docs/MAC_SIGNING_LOCAL_2026-10-28.md, step 1)."

if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  [[ "$APPLE_SIGNING_IDENTITY" == "Developer ID Application: "* ]] \
    || fail "APPLE_SIGNING_IDENTITY must name a \"Developer ID Application: ...\" identity."
  found=0
  for name in ${IDENTITIES[@]+"${IDENTITIES[@]}"}; do
    [[ "$name" == "$APPLE_SIGNING_IDENTITY" ]] && found=1
  done
  [[ "$found" == 1 ]] || fail "APPLE_SIGNING_IDENTITY is not a valid identity in the keychain.
$NO_IDENTITY_HELP"
  IDENTITY="$APPLE_SIGNING_IDENTITY"
else
  if [[ ${#IDENTITIES[@]} -eq 0 ]]; then
    fail "$NO_IDENTITY_HELP"
  fi
  if [[ ${#IDENTITIES[@]} -gt 1 ]]; then
    printf '  %s\n' "${IDENTITIES[@]}" >&2
    fail "more than one Developer ID Application identity was found. Set APPLE_SIGNING_IDENTITY to the one to use."
  fi
  IDENTITY="${IDENTITIES[0]}"
fi

TEAM_ID="$(printf '%s\n' "$IDENTITY" | sed -n 's/^Developer ID Application: .* (\([A-Z0-9]\{10\}\))$/\1/p')"
[[ -n "$TEAM_ID" ]] || fail "could not read the team ID from the identity name: $IDENTITY"
echo "Signing identity: $IDENTITY"

# --- Notary profile ------------------------------------------------------------
if ! xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  fail "the notarytool keychain profile \"$NOTARY_PROFILE\" is missing or not working.
Owner step (once, in Terminal; it is stored in the keychain, never in this repository):
  xcrun notarytool store-credentials $NOTARY_PROFILE --key <AuthKey_KEYID.p8> --key-id <KEYID> --issuer <issuer ID>
  (or: --apple-id <your Apple ID> --team-id $TEAM_ID with an app-specific password)
See docs/MAC_SIGNING_LOCAL_2026-10-28.md, step 2."
fi
echo "Notary profile $NOTARY_PROFILE works."

[[ -x node_modules/.bin/tauri ]] || fail "dependencies are not installed. Run npm ci first (Node 22)."

# --- Build and sign ------------------------------------------------------------
WORK="$(mktemp -d "${TMPDIR:-/tmp}/hfd-signed-build.XXXXXX")"
mountpoint=""
cleanup() {
  local status=$?
  if [[ -n "$mountpoint" ]]; then
    hdiutil detach "$mountpoint" >/dev/null || status=1
    rmdir "$mountpoint" 2>/dev/null || true
  fi
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

# The identity name goes through JSON.stringify so quotes or spaces stay data.
CONFIG="$WORK/signing.conf.json"
node -e '
  const [identity, file] = process.argv.slice(1);
  require("node:fs").writeFileSync(file, JSON.stringify({ bundle: { macOS: { signingIdentity: identity, hardenedRuntime: true } } }));
' "$IDENTITY" "$CONFIG"

rm -rf "$DMG_DIR"
echo "Building the signed DMG (HFD_OFFLINE_EXTRACTION=1)..."
# Tauri may also notarize or import certificates when Apple account variables
# are present; clear them so notarization happens exactly once, below, with
# the keychain profile.
env -u APPLE_ID -u APPLE_PASSWORD -u APPLE_TEAM_ID -u APPLE_API_KEY \
  -u APPLE_API_ISSUER -u APPLE_API_KEY_PATH -u APPLE_CERTIFICATE -u APPLE_CERTIFICATE_PASSWORD \
  HFD_OFFLINE_EXTRACTION=1 APPLE_SIGNING_IDENTITY="$IDENTITY" \
  npm run tauri -- build --bundles dmg --config "$CONFIG"

# The build must not change any committed file (tauri.conf.json keeps "-").
if [[ -n "$(git status --porcelain)" ]]; then
  git status --short >&2
  fail "the build changed committed files."
fi

shopt -s nullglob
dmgs=("$DMG_DIR"/*.dmg)
shopt -u nullglob
[[ ${#dmgs[@]} -eq 1 ]] || fail "expected exactly one DMG in $DMG_DIR, found ${#dmgs[@]}."
DMG="${dmgs[0]}"
echo "Built: $DMG"

# --- Notarize and staple -------------------------------------------------------
echo "Submitting to Apple notarization (this can take several minutes)..."
set +e
SUBMIT_JSON="$(xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait --output-format json)"
submit_status=$?
set -e
read_field() {
  node -e '
    let value = "";
    try { value = JSON.parse(process.argv[1])[process.argv[2]] ?? ""; } catch {}
    console.log(value);
  ' "$SUBMIT_JSON" "$1"
}
SUBMISSION_ID="$(read_field id)"
NOTARY_STATUS="$(read_field status)"
if [[ "$submit_status" -ne 0 || "$NOTARY_STATUS" != "Accepted" ]]; then
  echo "Notarization result: ${NOTARY_STATUS:-unknown} (notarytool exit $submit_status)" >&2
  if [[ -n "$SUBMISSION_ID" ]]; then
    echo "Submission id: $SUBMISSION_ID" >&2
    echo "Details: xcrun notarytool log $SUBMISSION_ID --keychain-profile $NOTARY_PROFILE" >&2
  fi
  fail "notarization was not Accepted. Do not upload this DMG."
fi
echo "Notarization Accepted (submission $SUBMISSION_ID)."

xcrun stapler staple "$DMG"
xcrun stapler validate "$DMG"

# --- Verify --------------------------------------------------------------------
# Strict deep verification plus Developer ID, hardened runtime, bundle ID and
# team checks on the app inside the DMG (opt-in mode of the CI gate script).
HFD_EXPECT_DEVELOPER_ID_TEAM="$TEAM_ID" bash scripts/verify-macos-bundle-signature.sh "$DMG"

# Gatekeeper assessment, read-only. A DMG is assessed as a document to open
# (`-t open --context context:primary-signature`); `-t install` is for .pkg
# installers and would reject a correctly notarized DMG.
gatekeeper() {
  local out
  if ! out="$(spctl "$@" 2>&1)"; then
    printf '%s\n' "$out" >&2
    return 1
  fi
  printf '%s\n' "$out"
  [[ "$out" == *"source=Notarized Developer ID"* ]]
}
gatekeeper -a -vvv -t open --context context:primary-signature "$DMG" \
  || fail "Gatekeeper did not accept the DMG as Notarized Developer ID."

mountpoint="$(mktemp -d "${TMPDIR:-/tmp}/hfd-gatekeeper.XXXXXX")"
hdiutil attach -nobrowse -readonly -mountpoint "$mountpoint" "$DMG" >/dev/null
apps=("$mountpoint"/*.app)
[[ ${#apps[@]} -eq 1 && -d "${apps[0]}" ]] || fail "expected exactly one app inside the DMG."
gatekeeper -a -vvv "${apps[0]}" || fail "Gatekeeper did not accept the app as Notarized Developer ID."
details="$(codesign -dv "${apps[0]}" 2>&1)"
[[ "$details" == *"Identifier=$BUNDLE_ID"* ]] || fail "bundle identifier is not $BUNDLE_ID."
hdiutil detach "$mountpoint" >/dev/null
rmdir "$mountpoint"
mountpoint=""

echo
echo "Signed, notarized and stapled: $DMG"
echo "SHA-256: $(shasum -a 256 "$DMG" | cut -d' ' -f1)"
echo "Next: replace the Mac DMG in the private $TAG release draft with this file and update its checksum."
