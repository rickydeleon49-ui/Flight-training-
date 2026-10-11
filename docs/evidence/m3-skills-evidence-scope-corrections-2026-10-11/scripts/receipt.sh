#!/usr/bin/env bash
# Record one check: command, cwd, UTC time, combined output and exit status.
#   docs/evidence/m3-skills-evidence-scope-corrections-2026-10-11/scripts/receipt.sh <receipt-file> '<command>'
out="$1"
cmd="$2"
{
  printf '$ %s\n# cwd: %s\n# utc: %s\n' "$cmd" "$PWD" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  bash -c "$cmd" 2>&1
  echo "# exit=$?"
} > "$out"
tail -n 1 "$out"
