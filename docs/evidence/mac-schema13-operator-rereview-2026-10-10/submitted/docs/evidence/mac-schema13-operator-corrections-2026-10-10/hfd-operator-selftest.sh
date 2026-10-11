#!/bin/bash
# Self-test for hfd-operator.sh covering MACV-R7 fixes.
# Runs against a disposable scratch kit so the staged kit is never mutated.
# Tests happy paths, refusal cases, symlink/traversal escapes, and permission restoration.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_KIT="${1:-$SCRIPT_DIR/hfd-operator.sh}"
NODE="${NODE:-/opt/homebrew/opt/node@22/bin/node}"
SCRATCH="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/hfd-op-selftest-XXXXXX")"
SCRATCH="$(cd "$SCRATCH" && pwd -P)"
cleanup() { /bin/rm -rf "$SCRATCH"; }
trap cleanup EXIT INT TERM

KIT="$SCRATCH/kit"
TOOLS="$SCRATCH/tools"
/bin/mkdir -p "$KIT/bin" "$KIT/profiles" "$KIT/evidence" "$TOOLS"
if [ -f "$SRC_KIT/bin/hfd-operator.sh" ]; then
  /bin/cp "$SRC_KIT/bin/hfd-operator.sh" "$KIT/bin/hfd-operator.sh"
elif [ -f "$SRC_KIT/hfd-operator.sh" ]; then
  /bin/cp "$SRC_KIT/hfd-operator.sh" "$KIT/bin/hfd-operator.sh"
elif [ -f "$SRC_KIT" ]; then
  /bin/cp "$SRC_KIT" "$KIT/bin/hfd-operator.sh"
else
  echo "Cannot find hfd-operator.sh at $SRC_KIT" >&2
  exit 1
fi
chmod +x "$KIT/bin/hfd-operator.sh"
OP="$KIT/bin/hfd-operator.sh"

MOCK_ROOT="$SCRATCH/Application Support/com.herflightdeck.app"
/bin/mkdir -p "$MOCK_ROOT/backups"
chmod 0700 "$MOCK_ROOT" "$MOCK_ROOT/backups"

# Create mock tools for UID 502 / hfdtest simulation
cat > "$TOOLS/id" <<'EOF'
#!/bin/bash
case "$1" in
  -u) echo 502 ;;
  -un) echo hfdtest ;;
  *) exit 2 ;;
esac
EOF
cat > "$TOOLS/dseditgroup" <<'EOF'
#!/bin/bash
exit "${TEST_GROUP_STATUS:-1}"
EOF
cat > "$TOOLS/pgrep" <<'EOF'
#!/bin/bash
exit 1
EOF
chmod 0755 "$TOOLS/id" "$TOOLS/dseditgroup" "$TOOLS/pgrep"

export _HFD_TEST_TOOLS_DIR="$TOOLS"
export _HFD_TEST_ROOT="$MOCK_ROOT"
export PATH="$TOOLS:$PATH"

RESULTS="$SCRATCH/results.jsonl"
: > "$RESULTS"
ALL_OK=yes

run_case() {
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
  printf '%-48s exit=%s(want %s) msg=%s\n' "$name" "$status" "$want" "$msgbit" >&2
}

export RESULTS_FILE="$RESULTS"
/bin/mkdir -p "$KIT/profiles/src/documents"
printf 'SYNTH' > "$KIT/profiles/src/documents/one.pdf"
printf 'db' > "$KIT/profiles/src/her-flight-deck.db"

# 1. Base command validations
run_case "help-exits-zero" 0 "-" help
/bin/mkdir -p "$SCRATCH/outside-a" "$SCRATCH/outside-b"
run_case "refuses-paths-outside-policy" 2 "neither the approved data root" move "$SCRATCH/outside-a" "$SCRATCH/outside-b"
run_case "refuses-missing-source" 2 "does not exist" copy "$KIT/profiles/nope" "$KIT/profiles/never"
run_case "refuses-loose-file-source" 2 "not a whole profile folder" copy "$KIT/profiles/src/her-flight-deck.db" "$KIT/profiles/loose"
run_case "refuses-unknown-subcommand" 2 "unknown subcommand" frobnicate

# 2. Traversal and symlink escapes
run_case "refuses-dot-dot-traversal-source" 2 "traversal" copy "$KIT/profiles/../outside" "$KIT/profiles/dst"
run_case "refuses-dot-dot-traversal-destination" 2 "traversal" copy "$KIT/profiles/src" "$KIT/profiles/../escaped"

/bin/ln -s "$SCRATCH" "$KIT/profiles/link-outside"
run_case "refuses-symlink-destination-parent" 2 "symlink" copy "$KIT/profiles/src" "$KIT/profiles/link-outside/nested"

/bin/ln -s "$KIT/profiles/src" "$KIT/profiles/symlink-src"
run_case "refuses-symlink-source" 2 "symlink" copy "$KIT/profiles/symlink-src" "$KIT/profiles/dst-from-symlink"

# 3. Account inspection failure fail-closed
TEST_GROUP_STATUS=2 run_case "refuses-account-inspection-error" 2 "account inspection failed" copy "$KIT/profiles/src" "$KIT/profiles/dst-error"
TEST_GROUP_STATUS=0 run_case "refuses-admin-member" 2 "is a member of admin" copy "$KIT/profiles/src" "$KIT/profiles/dst-admin"

# 4. Happy path copy and move + protection against overwrites
run_case "allows-whole-folder-copy" 0 "copied" copy "$KIT/profiles/src" "$KIT/profiles/dst"
run_case "refuses-existing-destination-copy" 2 "already exists" copy "$KIT/profiles/src" "$KIT/profiles/dst"
run_case "allows-move-between-profiles" 0 "moved" move "$KIT/profiles/dst" "$KIT/profiles/moved"
run_case "refuses-existing-destination-move" 2 "already exists" move "$KIT/profiles/src" "$KIT/profiles/moved"
run_case "refuses-self-nesting" 2 "inside source" move "$KIT/profiles/src" "$KIT/profiles/src/inner"

# 5. Backup blocking and permission restoration
run_case "block-backups-removes-write" 0 "recorded original mode 700" block-backups
run_case "refuses-repeated-block-backups" 2 "already write-blocked" block-backups
run_case "unblock-backups-restores-mode" 0 "restored.*700" unblock-backups
run_case "unblock-backups-repeated-idempotent" 0 "already at recorded original mode" unblock-backups

# 6. Mode 0750 restoration with spaces
chmod 0750 "$MOCK_ROOT/backups"
run_case "block-backups-mode-0750" 0 "recorded original mode 750" block-backups
run_case "unblock-backups-mode-0750" 0 "restored.*750" unblock-backups
chmod 0700 "$MOCK_ROOT/backups"

# Verification of file preservation
intact=yes
[ -d "$KIT/profiles/src/documents" ] || intact=no
[ -f "$KIT/profiles/src/her-flight-deck.db" ] || intact=no
[ -d "$KIT/profiles/moved/documents" ] || intact=no
nested=no
[ -e "$KIT/profiles/src/inner" ] && nested=yes
[ "$intact" = yes ] && [ "$nested" = no ] || ALL_OK=no

printf '{\n  "schema": "hfd-operator-selftest/2",\n  "scriptUnderTest": "%s",\n  "sourcesIntactAfterRefusals": "%s",\n  "nothingNested": "%s",\n  "allExpectationsMet": %s,\n  "cases": [\n' \
  "$SRC_KIT/bin/hfd-operator.sh" "$intact" "$([[ $nested == no ]] && echo yes || echo no)" "$([[ $ALL_OK == yes ]] && echo true || echo false)"
"$NODE" -e 'const fs=require("fs");const l=fs.readFileSync(process.env.RESULTS_FILE,"utf8").split("\n").filter(Boolean);process.stdout.write(l.map(x=>"    "+x).join(",\n"));'
printf '\n  ]\n}\n'
[[ $ALL_OK == yes ]] && exit 0 || exit 1
