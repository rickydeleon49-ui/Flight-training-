#!/bin/bash
# Sequential C2 source gate. Each step writes receipts/<attempt>/<n>-<name>.txt
# with its full output and a trailing "exit N"; failures are kept and the gate continues.
set -u
cd "$(dirname "$0")/../../.."
export PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH
export SDKROOT=$(xcrun --sdk macosx --show-sdk-path)
ATTEMPT=${1:?attempt label}
OUT=docs/evidence/m2-card-review-c2-implementation-2026-10-07/receipts/$ATTEMPT
mkdir -p "$OUT"
SUMMARY="$OUT/00-summary.txt"
{ echo "attempt $ATTEMPT  started $(date -u +%Y-%m-%dT%H:%M:%SZ)  cwd $(pwd)"
  echo "HEAD $(git rev-parse HEAD)  branch $(git branch --show-current)"
  echo "node $(node -v)  npm $(npm -v)  $(rustc --version)  $(cargo --version)"
  echo "xcode $(xcodebuild -version 2>/dev/null | tr '\n' ' ')  SDKROOT=$SDKROOT"; } > "$SUMMARY"
step() {
  local n=$1 name=$2; shift 2
  local file="$OUT/$n-$name.txt" start=$(date +%s)
  { echo "\$ $*"; bash -c "$*"; } > "$file" 2>&1
  local code=$?
  echo "exit $code" >> "$file"
  echo "$n $name: exit $code ($(( $(date +%s) - start ))s)" >> "$SUMMARY"
}
C2_FILES="src/logic/cardLibrary.test.ts src/data/cardLibraryTauri.test.ts src/data/cardLibraryReader.test.ts src/data/cardLibraryParity.test.ts src/pages/StudyLibrary/deferredReviewRead.test.ts src/pages/StudyLibrary/StudyLibraryReviews.test.ts src/pages/StudyLibrary/StudyLibrary.test.ts src/pages/StudyLibrary/CardReviewPanel.test.ts"
step 01 focused-vitest "npx vitest run $C2_FILES"
step 02 focused-native "cargo test --locked --manifest-path src-tauri/Cargo.toml card_"
step 03 typecheck "npm run typecheck"
step 04 npm-test "npm test"
step 05 build "npm run build"
step 06 cargo-test "cargo test --locked --manifest-path src-tauri/Cargo.toml --all-targets"
step 07 clippy "cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings"
step 08 cargo-fmt "cargo fmt --manifest-path src-tauri/Cargo.toml --check"
step 09 cargo-lock "npm run test:cargo-lock"
step 10 hygiene "docs/evidence/m2-card-review-c2-implementation-2026-10-07/check_hygiene.sh"
step 11 preserved "docs/evidence/m2-card-review-c2-implementation-2026-10-07/check_preserved.sh"
echo "finished $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$SUMMARY"
