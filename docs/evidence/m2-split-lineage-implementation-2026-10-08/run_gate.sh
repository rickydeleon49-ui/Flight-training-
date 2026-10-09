#!/bin/bash
# Sequential split-lineage gate. Each step writes receipts/<attempt>/<n>-<name>.txt
# with its full output and a trailing "exit N"; failures are kept and the gate continues.
set -u
cd "$(dirname "$0")/../../.."
export PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH
export SDKROOT=$(xcrun --sdk macosx --show-sdk-path)
ATTEMPT=${1:?attempt label}
PACK=docs/evidence/m2-split-lineage-implementation-2026-10-08
OUT=$PACK/receipts/$ATTEMPT
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
FOCUSED="src/logic/splitLineage.test.ts src/data/splitLineageShapes.test.ts src/data/splitLineageStorage.test.ts src/data/splitLineageValidationParity.test.ts src/pages/StudyLibrary/SplitLineage.test.ts src/data/cardReviewContract.test.ts src/acceptance/m1Upgrade.acceptance.test.ts"
step 01 focused-vitest "npx vitest run $FOCUSED"
step 02 focused-native "cargo test --locked --manifest-path src-tauri/Cargo.toml lineage && cargo test --locked --manifest-path src-tauri/Cargo.toml split && cargo test --locked --manifest-path src-tauri/Cargo.toml newer_database"
step 03 typecheck "npm run typecheck"
step 04 npm-test "npm test"
step 05 build "npm run build"
step 06 cargo-test "cargo test --locked --manifest-path src-tauri/Cargo.toml --all-targets"
step 07 clippy "cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings"
step 08 cargo-fmt "cargo fmt --manifest-path src-tauri/Cargo.toml --check"
step 09 cargo-lock "npm run test:cargo-lock"
step 10 hygiene "$PACK/check_hygiene.sh"
step 11 preserved "$PACK/check_preserved.sh"
echo "finished $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$SUMMARY"
