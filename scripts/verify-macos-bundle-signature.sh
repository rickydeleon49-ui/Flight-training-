#!/bin/bash
set -euo pipefail

# Every DMG must pass. Also verify any staged bundles that remain; Tauri's
# DMG bundler may remove them after packing the shipped installer.
fail() {
  echo "::error::$*" >&2
  exit 1
}

mountpoint=""
cleanup() {
  local status=$?
  if [[ -n "$mountpoint" ]]; then
    if hdiutil detach "$mountpoint"; then
      rmdir "$mountpoint" || status=1
    else
      echo "::error::Could not detach signature audit mount: $mountpoint" >&2
      status=1
    fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

verify_app() {
  local app="$1" details failed=0
  echo "Checking bundle signature: $app"
  if ! codesign --verify --deep --strict --verbose=2 "$app"; then
    echo "::error::Strict bundle signature verification failed: $app" >&2
    failed=1
  fi
  if ! details=$(codesign -dvvv "$app" 2>&1); then
    fail "Could not inspect bundle signature: $app ($details)"
  fi
  printf '%s\n' "$details"
  if [[ "$details" != *"Sealed Resources version="* ]]; then
    echo "::error::Missing Sealed Resources version= in bundle signature: $app" >&2
    failed=1
  fi
  if [[ "$details" == *"linker-signed"* ]]; then
    echo "::error::Rejected linker-signed bundle: $app" >&2
    failed=1
  fi
  if [[ "$details" == *"Info.plist=not bound"* ]]; then
    echo "::error::Info.plist=not bound in bundle signature: $app" >&2
    failed=1
  fi
  if [[ -n "$expected_team" ]]; then
    # Opt-in Developer ID mode (scripts/build-signed-mac.sh). Adds checks on
    # top of the ones above; CI's ad-hoc run leaves it unset.
    if [[ "$details" != *"Authority=Developer ID Application: "*"($expected_team)"* ]]; then
      echo "::error::Not signed by Developer ID Application ($expected_team): $app" >&2
      failed=1
    fi
    if [[ "$details" != *"TeamIdentifier=$expected_team"* ]]; then
      echo "::error::TeamIdentifier is not $expected_team: $app" >&2
      failed=1
    fi
    if [[ ! "$details" =~ flags=0x[0-9a-f]+\([^\)]*runtime[^\)]*\) ]]; then
      echo "::error::Hardened runtime flag missing: $app" >&2
      failed=1
    fi
    if [[ "$details" == *"Signature=adhoc"* ]]; then
      echo "::error::Ad-hoc signature where Developer ID was required: $app" >&2
      failed=1
    fi
    if [[ "$details" != *"Identifier=com.herflightdeck.app"$'\n'* ]]; then
      echo "::error::Bundle identifier is not com.herflightdeck.app: $app" >&2
      failed=1
    fi
  fi
  [[ "$failed" == 0 ]] || fail "Incomplete or invalid bundle signature: $app"
}

# Optional: a 10-character Apple team ID turns on the Developer ID checks.
expected_team="${HFD_EXPECT_DEVELOPER_ID_TEAM:-}"
if [[ -n "$expected_team" && ! "$expected_team" =~ ^[A-Z0-9]{10}$ ]]; then
  fail "HFD_EXPECT_DEVELOPER_ID_TEAM must be a 10-character Apple team ID."
fi

shopt -s nullglob
[[ $# -gt 0 ]] || fail "Supply a DMG directory or one or more DMG paths (shell globs are accepted)."
dmgs=()
for input in "$@"; do
  if [[ -d "$input" ]]; then
    matches=("$input"/*.dmg)
    [[ ${#matches[@]} -gt 0 ]] || fail "No DMGs found in: $input"
    dmgs+=("${matches[@]}")
  elif [[ -f "$input" && "$input" == *.dmg ]]; then
    dmgs+=("$input")
  else
    fail "Missing DMG or directory: $input"
  fi
done

apps=(src-tauri/target/release/bundle/macos/*.app)
if [[ ${#apps[@]} -eq 0 ]]; then
  echo "No staged .app found in src-tauri/target/release/bundle/macos/; continuing with mandatory DMG verification."
else
  for app in "${apps[@]}"; do
    verify_app "$app"
  done
fi

for dmg in "${dmgs[@]}"; do
  mountpoint=$(mktemp -d "${TMPDIR:-/tmp}/hfd-signature.XXXXXX") || fail "Could not create signature audit mountpoint"
  # Set the trap's mountpoint before attaching, so a partial attach is cleaned up.
  hdiutil attach -nobrowse -readonly -mountpoint "$mountpoint" "$dmg" || fail "Could not attach DMG for signature audit: $dmg"
  apps=("$mountpoint"/*.app)
  [[ ${#apps[@]} -gt 0 ]] || fail "No .app found inside DMG: $dmg"
  for app in "${apps[@]}"; do
    verify_app "$app"
  done
  hdiutil detach "$mountpoint" || fail "Could not detach DMG after signature audit: $dmg"
  rmdir "$mountpoint"
  mountpoint=""
done
echo "All requested macOS bundle signatures passed."
