#!/bin/bash
# Measurement only. No shipped target/config, real profile, or pressure command.
set -euo pipefail
if [[ $# != 2 || ( "$1" != baseline && "$1" != pressure ) ]]; then
  echo "Usage: $0 baseline|pressure OUTPUT_DIRECTORY" >&2
  exit 64
fi
if [[ $(uname -s) != Darwin ]]; then
  echo "This check needs macOS /usr/bin/time -l (RSS is in bytes)." >&2
  exit 64
fi
ROOT=$(cd "$(dirname "$0")/.." && pwd)
MODE=$1
mkdir -p "$2"
OUT=$(cd "$2" && pwd)
SCRATCH=$(mktemp -d "${TMPDIR:-/tmp}/hfd-extraction-pressure.XXXXXX")
trap 'rm -rf "$SCRATCH"' EXIT
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
export CARGO_NET_OFFLINE=true
# The opt-in exists only for this disposable measurement build, never a release artifact.
(cd "$ROOT/src-tauri" && env HFD_OFFLINE_EXTRACTION=1 CARGO_TARGET_DIR="$SCRATCH/target" \
  cargo build --locked --release --bin her-flight-deck --example offline_pressure_probe) >"$OUT/build.log" 2>&1
node "$ROOT/scripts/generate-pdf-fixtures.mjs" "$SCRATCH/fixtures" >"$OUT/fixtures.log"
python3 "$ROOT/scripts/offline-extraction-pressure-check.py" "$MODE" "$OUT" "$SCRATCH"
