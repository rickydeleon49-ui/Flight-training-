#!/bin/bash
# Revert sensitivity for the schema-13 snapshot helper (MACV-R4/R5 permanent regressions).
#
# Each variant reverts exactly one production behaviour back to what the review rejected, then runs
# BOTH the corrected helper's own self-check and the frozen review diagnostics against that copy and
# asserts the *named* assertion fails. Nothing here touches the tracked helper: every copy lives in a
# task-owned scratch directory and is removed on exit.
#
#   usage: bash revert-sensitivity.sh <repo-root> <frozen-diagnostics.mjs>
set -uo pipefail

REPO="${1:?repo root}"
DIAG="${2:?frozen diagnostics path}"
NODE="${NODE:-/opt/homebrew/opt/node@22/bin/node}"
HELPER="$REPO/scripts/mac-schema13-profile-snapshot.mjs"
SCRATCH="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/macv-revert-XXXXXX")"
cleanup() { /bin/rm -rf "$SCRATCH"; }
trap cleanup EXIT INT TERM

RESULTS_FILE="$SCRATCH/results.jsonl"
: > "$RESULTS_FILE"

json_escape() { "$NODE" -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"; }


run_variant() { # name | perl expression | self-check assertion expected to fail (or -) | diagnostics assertion expected to fail (or -)
  local name="$1" expr="$2" selfassert="$3" diagassert="$4"
  local copy="$SCRATCH/$name.mjs"
  /bin/cp "$HELPER" "$copy"
  /usr/bin/perl -0pi -e "$expr" "$copy"
  if cmp -s "$HELPER" "$copy"; then
    printf '{"variant":%s,"error":"revert expression matched nothing"}\n' "$(json_escape "$name")" >> "$RESULTS_FILE"
    echo "$name: revert matched nothing" >&2
    return
  fi
  if ! "$NODE" --check "$copy" >/dev/null 2>&1; then
    printf '{"variant":%s,"error":"revert produced invalid javascript"}\n' "$(json_escape "$name")" >> "$RESULTS_FILE"
    echo "$name: revert produced invalid javascript" >&2
    return
  fi
  cd "$REPO" || exit 1

  local selfout="$SCRATCH/$name-selfcheck.json" selfexit selffailed selfbit
  "$NODE" "$copy" self-check > "$selfout" 2> "$SCRATCH/$name-selfcheck.err"; selfexit=$?
  selffailed="$("$NODE" -e 'const fs=require("fs");try{const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(r.checks.filter(c=>!c.pass).map(c=>c.name).join("\n"));}catch(e){process.stdout.write("(no parsable self-check report)");}' "$selfout")"
  if [ "$selfassert" = "-" ]; then selfbit="not-expected"; elif [[ "$selffailed" == *"$selfassert"* ]]; then selfbit="yes"; else selfbit="no"; fi

  local diagout="$SCRATCH/$name-diag.json" diagexit diagfailed diagbit
  "$NODE" "$DIAG" "$copy" > "$diagout" 2> "$SCRATCH/$name-diag.err"; diagexit=$?
  diagfailed="$("$NODE" -e 'const fs=require("fs");try{const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(r.results.filter(x=>!x.pass).map(x=>x.name).join("\n"));}catch(e){process.stdout.write("(no parsable diagnostics report)");}' "$diagout")"
  if [ "$diagassert" = "-" ]; then diagbit="not-expected"; elif [[ "$diagfailed" == *"$diagassert"* ]]; then diagbit="yes"; else diagbit="no"; fi

  printf '{"variant":%s,"selfCheckExit":%d,"selfCheckExpectedFailure":%s,"selfCheckFailedOnIt":%s,"selfCheckFailures":%s,"diagnosticsExit":%d,"diagnosticsExpectedFailure":%s,"diagnosticsFailedOnIt":%s,"diagnosticsFailures":%s}\n' \
    "$(json_escape "$name")" "$selfexit" "$(json_escape "$selfassert")" "$(json_escape "$selfbit")" "$(json_escape "$selffailed")" \
    "$diagexit" "$(json_escape "$diagassert")" "$(json_escape "$diagbit")" "$(json_escape "$diagfailed")" >> "$RESULTS_FILE"
  echo "$name: selfExit=$selfexit selfBite=$selfbit diagExit=$diagexit diagBite=$diagbit" >&2
}

# ---- the reverted behaviours the review named --------------------------------------------------
run_variant "inspection-fail-open" \
  's/if \(result\.status === PGREP_NO_MATCH\) return \{ state: .stopped. \};/if (result.ok === false) return { state: "stopped" };/' \
  'production guard: an unusable or unparseable inspection answer refuses fail closed' \
  '[MACV-R4] process-inspection exit 2 must fail closed'

run_variant "matched-pid-tolerated" \
  's/return \{ state: .running., pids: lines\.map\(Number\) \};/return { state: "stopped", pids: lines.map(Number) };/' \
  'production guard: a matched pid from real pgrep text refuses' \
  '[MACV-R4] a matched live app must refuse before copying'

run_variant "output-alias-both-branches-off" \
  's/if \(t\.path && \(candidate === t\.path \|\| isWithin\(t\.path, candidate\)\)\) fail/if (false \&\& t.path) fail/; s/const alias = protectedSet\.find\(t => t\.inode && t\.inode === id\);/const alias = undefined;/' \
  'output: --json cannot overwrite the input database' \
  '[MACV-R4] output cannot overwrite the input database'

run_variant "output-alias-path-branch-off" \
  's/if \(t\.path && \(candidate === t\.path \|\| isWithin\(t\.path, candidate\)\)\) fail/if (false \&\& t.path) fail/' \
  'output: --json inside the profile root is refused' \
  '-'

run_variant "output-alias-inode-branch-off" \
  's/const alias = protectedSet\.find\(t => t\.inode && t\.inode === id\);/const alias = undefined;/' \
  'output: a hard link to the database is detected as an alias' \
  '-'

run_variant "no-profile-root-protection" \
  's/^    add\(profile\);\n//m' \
  'output: --json inside the profile root is refused' \
  '-'

run_variant "nul-truncating-text" \
  's/return \{ tag: .x., payload: Buffer\.from\(hexValue, .hex.\), json: \{ t: .text., v: hexValue \} \};/return { tag: "x", payload: Buffer.from(String(value ?? ""), "utf8"), json: { t: "text", v: hexValue } };/' \
  'digest: TEXT differing only after an embedded NUL changes its digest' \
  '[MACV-R5] TEXT changed after embedded NUL must change its digest'

run_variant "frame-drops-table-identity" \
  's/Buffer\.from\(.HFDTAB1., .ascii.\), \.\.\.framed\(table\)/Buffer.from("HFDTAB1", "ascii")/' \
  'digest: table identity is part of the frame' \
  '-'

run_variant "unchanged-demands-schema13" \
  's/if \(purpose === .upgrade. && b\.ledger\.maxVersion !== CURRENT_SCHEMA_VERSION\)/if (purpose !== "history" \&\& b.ledger.maxVersion !== CURRENT_SCHEMA_VERSION)/' \
  'contract unchanged: two schema-12 captures pass without demanding schema-13' \
  '[MACV-R5] Step C default compare must accept unchanged schema 12'

run_variant "no-snapshot-validation" \
  's/const problems = \[\.\.\.validateSnapshot\(.before., a\), \.\.\.validateSnapshot\(.after., b\)\];/const problems = [];/' \
  'validation: a snapshot missing every retained table entry is refused' \
  '[MACV-R5] snapshots missing every required history table cannot pass'

run_variant "historyonly-skips-files" \
  's/  compareAnchors\(a\.fileAnchors, b\.fileAnchors, fileDiffs, .files.\);/  if (!opts.historyOnly) compareAnchors(a.fileAnchors, b.fileAnchors, fileDiffs, "files");/' \
  '-' \
  '[MACV-R5] Step D restore comparison must detect a changed document'

# ---- assemble ----------------------------------------------------------------------------------
printf '{\n  "schema": "macv-revert-sensitivity/1",\n  "helper": %s,\n  "node": "%s",\n  "variants": [\n' \
  "$(json_escape "$HELPER")" "$("$NODE" --version)"
"$NODE" -e 'const fs=require("fs");const l=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);process.stdout.write(l.map(x=>"    "+x).join(",\n"));' "$RESULTS_FILE"
printf '\n  ]\n}\n'
