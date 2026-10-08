#!/bin/bash
# Shipped schema and every earlier C2 evidence pack unchanged against base.
set -u
cd "$(dirname "$0")/../../.."
BASE=cc84964737067cfa5fa5ed20ddf125a74b10b003
status=0
git diff --exit-code "$BASE" -- src-tauri/migrations src/data/migration-checksums.json src/data/migrations.ts || status=1
[ -z "$(git status --porcelain -- src-tauri/migrations)" ] || { echo "new or changed migration files"; status=1; }
grep -n 'CURRENT_SCHEMA_VERSION: i64 = 12;' src-tauri/src/lib.rs || status=1
echo "shipped migrations 0001-0012, registry and schema version 12: unchanged"
for pack in scope-2026-10-07 scope-corrections-2026-10-07 scope-completion-2026-10-07 final-corrections-2026-10-07 \
            read-pipeline-corrections-2026-10-07 bounded-read-corrections-2026-10-07 contract-finish-2026-10-07 \
            state-publication-2026-10-07 enrichment-corrections-2026-10-07; do
  dir=docs/evidence/m2-card-review-c2-$pack
  [ -d "$dir" ] || { echo "MISSING $dir"; status=1; continue; }
  if [ -f "$dir/SHA256SUMS" ]; then
    # Packs root their manifest either in the pack or at the repository root.
    if (cd "$dir" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1); then
      echo "planning pack $pack: SHA256SUMS OK (pack-rooted)"
    elif shasum -a 256 -c "$dir/SHA256SUMS" >/dev/null 2>&1; then
      echo "planning pack $pack: SHA256SUMS OK (repository-rooted)"
    else
      echo "planning pack $pack: SHA256SUMS FAILED"; status=1
    fi
  else
    echo "planning pack $pack: no SHA256SUMS (byte check below)"
  fi
done
others=$(ls -d docs/evidence/m2-card-review-c2-* | grep -v m2-card-review-c2-implementation-2026-10-07)
git diff --exit-code "$BASE" -- $others >/dev/null || { echo "a C2 evidence pack changed"; status=1; }
[ -z "$(git status --porcelain --untracked-files=all -- $others)" ] || { echo "untracked or modified files in an earlier C2 pack"; status=1; }
echo "all $(echo "$others" | wc -l | tr -d ' ') earlier C2 evidence packs byte-identical to base"
exit $status
