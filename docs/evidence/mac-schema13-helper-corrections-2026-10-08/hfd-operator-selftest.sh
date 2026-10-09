#!/bin/bash
# Self-test for the operator kit's hfd-operator.sh (MACV-R6 reversibility + refuse-existing rules).
#
# Runs against a throwaway copy of the kit so the real staged kit is never mutated. Cases that need
# the approved lane (uid 502) are asserted to REFUSE when executed from this preparation account —
# which is exactly the guard the review asked for. Cases that only involve the kit's own profiles/
# directory run for real, including both happy paths.
#
#   usage: bash hfd-operator-selftest.sh <path to staged kit>
set -uo pipefail

SRC_KIT="${1:?staged kit path}"
NODE="${NODE:-/opt/homebrew/opt/node@22/bin/node}"
SCRATCH="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/hfd-op-selftest-XXXXXX")"
# Canonicalize: /var is a symlink to /private/var on macOS, and the kit's path policy compares
# resolved prefixes (fail closed), so the test must pass canonical paths exactly as an operator would.
SCRATCH="$(cd "$SCRATCH" && pwd -P)"
cleanup() { /bin/rm -rf "$SCRATCH"; }
trap cleanup EXIT INT TERM

KIT="$SCRATCH/kit"
/bin/mkdir -p "$KIT/bin" "$KIT/profiles" "$KIT/evidence"
/bin/cp "$SRC_KIT/bin/hfd-operator.sh" "$KIT/bin/hfd-operator.sh"
chmod +x "$KIT/bin/hfd-operator.sh"
OP="$KIT/bin/hfd-operator.sh"
APPROVED_ROOT="/Users/hfdtest/Library/Application Support/com.herflightdeck.app"

RESULTS="$SCRATCH/results.jsonl"
: > "$RESULTS"
ALL_OK=yes

run_case() { # name | expected exit | expected stderr regex (- to skip) | args...
  local name="$1" want="$2" wantmsg="$3"; shift 3
  local out status exitbit msgbit
  out="$("$OP" "$@" 2>&1)" && status=0 || status=$?
  if [ "$status" = "$want" ]; then exitbit=yes; else exitbit=no; ALL_OK=no; fi
  if [ "$wantmsg" = "-" ]; then msgbit=yes
  elif [[ "$out" =~ $wantmsg ]]; then msgbit=yes
  else msgbit=no; ALL_OK=no; fi
  "$NODE" -e '
    const fs = require("fs");
    const [name, args, exit, want, msgbit, exitbit, output] = process.argv.slice(1);
    fs.appendFileSync(process.env.RESULTS_FILE, JSON.stringify({
      case: name, args: args.split("\u0001"), exit: Number(exit), expectedExit: Number(want),
      messageMatch: msgbit, exitMatch: exitbit, output: output.slice(0, 400),
    }) + "\n");
  ' "$name" "$(printf '%s\001' "$@")" "$status" "$want" "$msgbit" "$exitbit" "$out"
  printf '%-42s exit=%s(want %s) msg=%s\n' "$name" "$status" "$want" "$msgbit" >&2
}

export RESULTS_FILE="$RESULTS"
/bin/mkdir -p "$KIT/profiles/src/documents"
printf 'SYNTH' > "$KIT/profiles/src/documents/one.pdf"
printf 'db' > "$KIT/profiles/src/her-flight-deck.db"

run_case "help-exits-zero" 0 "-" help
run_case "refuses-paths-outside-policy" 2 "neither the approved data root" move /tmp/hfd-a /tmp/hfd-b
run_case "refuses-approved-root-without-lane" 2 "must run as uid 502" move "$APPROVED_ROOT" "$KIT/profiles/leak"
run_case "refuses-approved-root-copy-without-lane" 2 "must run as uid 502" copy "$APPROVED_ROOT" "$KIT/profiles/leak2"
run_case "refuses-block-backups-without-lane" 2 "must run as uid 502" block-backups
run_case "refuses-unblock-backups-without-lane" 2 "must run as uid 502" unblock-backups
run_case "refuses-trailing-slash" 2 "trailing slash" copy "$KIT/profiles/a/" "$KIT/profiles/b"
run_case "refuses-missing-source" 2 "does not exist" copy "$KIT/profiles/nope" "$KIT/profiles/never"
run_case "refuses-loose-file-source" 2 "not a whole profile folder" copy "$KIT/profiles/src/her-flight-deck.db" "$KIT/profiles/loose"
run_case "allows-whole-folder-copy" 0 "copied" copy "$KIT/profiles/src" "$KIT/profiles/dst"
run_case "refuses-existing-destination-copy" 2 "already exists" copy "$KIT/profiles/src" "$KIT/profiles/dst"
run_case "allows-move-between-kit-profiles" 0 "moved" move "$KIT/profiles/dst" "$KIT/profiles/moved"
run_case "refuses-existing-destination-move" 2 "already exists" move "$KIT/profiles/src" "$KIT/profiles/moved"
run_case "refuses-self-nesting" 2 "inside the source" move "$KIT/profiles/src" "$KIT/profiles/src/inner"
run_case "refuses-unknown-subcommand" 2 "unknown subcommand" frobnicate

# The refused operations must have left both profiles intact and never nested one inside another.
intact=yes
[ -d "$KIT/profiles/src/documents" ] || intact=no
[ -f "$KIT/profiles/src/her-flight-deck.db" ] || intact=no
[ -d "$KIT/profiles/moved/documents" ] || intact=no
nested=no
[ -e "$KIT/profiles/src/src" ] && nested=yes
[ -e "$KIT/profiles/src/inner" ] && nested=yes
[ "$intact" = yes ] && [ "$nested" = no ] || ALL_OK=no

printf '{\n  "schema": "hfd-operator-selftest/1",\n  "scriptUnderTest": "%s",\n  "ranAsUid": "%s",\n  "sourcesIntactAfterRefusals": "%s",\n  "nothingNested": "%s",\n  "allExpectationsMet": %s,\n  "cases": [\n' \
  "$SRC_KIT/bin/hfd-operator.sh" "$(id -u)" "$intact" "$([[ $nested == no ]] && echo yes || echo no)" "$([[ $ALL_OK == yes ]] && echo true || echo false)"
"$NODE" -e 'const fs=require("fs");const l=fs.readFileSync(process.env.RESULTS_FILE,"utf8").split("\n").filter(Boolean);process.stdout.write(l.map(x=>"    "+x).join(",\n"));'
printf '\n  ]\n}\n'
[[ $ALL_OK == yes ]] && exit 0 || exit 1
