#!/bin/bash
# Shipped migrations 0001-0012 byte-identical to base; the registry and
# checksum list change only by adding 0013; schema version is 13; no earlier
# evidence pack changed; nothing staged.
set -u
cd "$(dirname "$0")/../../.."
BASE=$(git rev-parse HEAD)
status=0
git diff --exit-code "$BASE" -- $(git ls-tree --name-only "$BASE" src-tauri/migrations/) || { echo "a shipped migration changed"; status=1; }
new_migrations=$(git status --porcelain --untracked-files=all -- src-tauri/migrations | sed -n 's/^?? //p')
[ "$new_migrations" = "src-tauri/migrations/0013_split_source_lineage.sql" ] || { echo "unexpected migration files: $new_migrations"; status=1; }
removed=$(git diff "$BASE" -- src/data/migration-checksums.json src/data/migrations.ts | grep -E '^-[^-]' | grep -v '"0012_card_reviews.sql"' )
[ -z "$removed" ] || { echo "registry lines removed or changed: $removed"; status=1; }
expected=$(shasum -a 256 src-tauri/migrations/0013_split_source_lineage.sql | cut -c1-64)
grep -q "\"0013_split_source_lineage.sql\": \"$expected\"" src/data/migration-checksums.json || { echo "0013 checksum missing or wrong"; status=1; }
grep -n 'CURRENT_SCHEMA_VERSION: i64 = 13;' src-tauri/src/lib.rs || status=1
echo "migrations 0001-0012 unchanged; registry adds only 0013 (checksum $expected); schema version 13"
others=$(git ls-tree -d --name-only "$BASE" docs/evidence/ | tr '\n' ' ')
git diff --exit-code "$BASE" -- $others >/dev/null || { echo "an earlier evidence pack changed"; status=1; }
echo "earlier evidence packs on base: $(echo $others | wc -w | tr -d ' ') unchanged"
[ -z "$(git diff --cached --name-only)" ] || { echo "something is staged"; status=1; }
echo "nothing staged"
exit $status
