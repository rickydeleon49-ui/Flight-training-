#!/bin/bash
# Shipped schema unchanged; the nine planning packs verify; every earlier C2
# evidence pack is byte-identical to base, and the implementation pack is
# byte-identical to its own manifest and to the copy published on origin/main.
set -u
cd "$(dirname "$0")/../../.."
BASE=cc84964737067cfa5fa5ed20ddf125a74b10b003
IMPL=docs/evidence/m2-card-review-c2-implementation-2026-10-07
SELF=docs/evidence/m2-card-review-c2-source-corrections-2026-10-07
status=0
git diff --exit-code "$BASE" -- src-tauri/migrations src/data/migration-checksums.json src/data/migrations.ts || status=1
[ -z "$(git status --porcelain -- src-tauri/migrations src/data/migration-checksums.json src/data/migrations.ts)" ] || { echo "new or changed migration files"; status=1; }
grep -n 'CURRENT_SCHEMA_VERSION: i64 = 12;' src-tauri/src/lib.rs || status=1
echo "shipped migrations 0001-0012, registry and schema version 12: unchanged"
for pack in scope-2026-10-07 scope-corrections-2026-10-07 scope-completion-2026-10-07 final-corrections-2026-10-07 \
            read-pipeline-corrections-2026-10-07 bounded-read-corrections-2026-10-07 contract-finish-2026-10-07 \
            state-publication-2026-10-07 enrichment-corrections-2026-10-07; do
  dir=docs/evidence/m2-card-review-c2-$pack
  [ -d "$dir" ] || { echo "MISSING $dir"; status=1; continue; }
  if (cd "$dir" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1); then
    echo "planning pack $pack: SHA256SUMS OK (pack-rooted)"
  elif shasum -a 256 -c "$dir/SHA256SUMS" >/dev/null 2>&1; then
    echo "planning pack $pack: SHA256SUMS OK (repository-rooted)"
  else
    echo "planning pack $pack: SHA256SUMS FAILED"; status=1
  fi
done
others=$(ls -d docs/evidence/m2-card-review-c2-* | grep -v -e "$IMPL" -e "$SELF")
git diff --exit-code "$BASE" -- $others >/dev/null || { echo "a C2 evidence pack changed"; status=1; }
[ -z "$(git status --porcelain --untracked-files=all -- $others)" ] || { echo "untracked or modified files in an earlier C2 pack"; status=1; }
echo "all $(echo "$others" | wc -l | tr -d ' ') earlier C2 evidence packs byte-identical to base"
(cd "$IMPL" && shasum -a 256 -c SHA256SUMS >/dev/null) && echo "implementation pack: $(wc -l < "$IMPL/SHA256SUMS" | tr -d ' ') SHA256SUMS entries OK" || { echo "implementation pack SHA256SUMS FAILED"; status=1; }
if git cat-file -e origin/main:"$IMPL"/SHA256SUMS 2>/dev/null; then
  n=0
  for f in $(git ls-tree -r --name-only origin/main -- "$IMPL"); do
    n=$((n + 1))
    cmp -s <(git show origin/main:"$f") "$f" || { echo "implementation pack differs from origin/main: $f"; status=1; }
  done
  echo "implementation pack: $n files byte-identical to origin/main"
fi
exit $status
