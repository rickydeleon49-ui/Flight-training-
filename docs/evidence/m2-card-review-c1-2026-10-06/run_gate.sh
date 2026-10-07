#!/bin/bash
# Sequential C1 verification gate. Each step writes receipts/<attempt>/<n>-<name>.txt
# with its full output and a trailing "exit N" line. A failing step is recorded
# and the gate continues, so one attempt shows every result.
set -u
cd "$(dirname "$0")/../../.."
export PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH
export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
ATTEMPT=${1:?attempt label}
OUT=docs/evidence/m2-card-review-c1-2026-10-06/receipts/$ATTEMPT
mkdir -p "$OUT"
SUMMARY="$OUT/00-summary.txt"
{ echo "attempt $ATTEMPT  started $(date -u +%Y-%m-%dT%H:%M:%SZ)"; echo "HEAD $(git rev-parse HEAD)  branch $(git branch --show-current)"
  echo "node $(node -v)  npm $(npm -v)  $(rustc --version)  $(cargo --version)  SDKROOT=$SDKROOT"; } > "$SUMMARY"
step() {
  local n=$1 name=$2; shift 2
  local file="$OUT/$n-$name.txt"
  local start=$(date +%s)
  { echo "\$ $*"; bash -c "$*"; } > "$file" 2>&1
  local code=$?
  echo "exit $code" >> "$file"
  echo "$n $name: exit $code ($(( $(date +%s) - start ))s)" >> "$SUMMARY"
}
step 01 focused-vitest "npx vitest run src/logic/cardScheduler.test.ts src/logic/localDay.test.ts src/logic/cardIdentity.test.ts src/data/cardReviewContract.test.ts src/data/cardValidationParity.test.ts src/data/cardReviewTauri.test.ts src/pages/StudyLibrary/CardReviewPanel.test.ts"
step 02 focused-cargo "cargo test --locked --manifest-path src-tauri/Cargo.toml card_reviews"
step 03 typecheck "npm run typecheck"
step 04 npm-test "npm test"
step 05 build "npm run build"
step 06 cargo-test "cargo test --locked --manifest-path src-tauri/Cargo.toml --all-targets"
step 07 clippy "cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings"
step 08 cargo-fmt "cargo fmt --manifest-path src-tauri/Cargo.toml --check"
step 09 cargo-lock "npm run test:cargo-lock"
step 10 hygiene "docs/evidence/m2-card-review-c1-2026-10-06/check_hygiene.sh"
step 11 migrations "git diff --exit-code 73b1597 -- src-tauri/migrations/0001_initial_schema.sql src-tauri/migrations/0002_profile_details.sql src-tauri/migrations/0003_personal_note.sql src-tauri/migrations/0004_app_metadata.sql src-tauri/migrations/0005_flight_log.sql src-tauri/migrations/0006_pilot_toolkit.sql src-tauri/migrations/0007_ai_study.sql src-tauri/migrations/0008_notes.sql src-tauri/migrations/0009_practice_tests.sql src-tauri/migrations/0010_debrief_links.sql src-tauri/migrations/0011_practice_sessions.sql && echo '0001-0011 byte-identical to main 73b1597' && shasum -a 256 src-tauri/migrations/0012_card_reviews.sql && grep -n '0012_card_reviews' src/data/migration-checksums.json src/data/migrations.ts src-tauri/src/lib.rs && python3 -c \"import json,hashlib;d=json.load(open('src/data/migration-checksums.json'));h=hashlib.sha256(open('src-tauri/migrations/0012_card_reviews.sql','rb').read()).hexdigest();assert d['0012_card_reviews.sql']==h,(d['0012_card_reviews.sql'],h);print('0012 checksum registered and matching')\" && grep -n 'CURRENT_SCHEMA_VERSION: i64 = 12' src-tauri/src/lib.rs"
echo "finished $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$SUMMARY"
