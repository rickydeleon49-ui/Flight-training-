#!/bin/bash
# Whitespace hygiene: the tracked diff, then every new file (raw receipts excluded,
# see .gitattributes). Any reported problem fails the step.
set -u
cd "$(dirname "$0")/../../.."
status=0
git diff --check || status=1
count=0
while IFS= read -r f; do
  count=$((count + 1))
  problems=$(git diff --no-index --check /dev/null "$f" 2>&1)
  if [ -n "$problems" ]; then echo "$problems"; status=1; fi
done < <(git status --porcelain --untracked-files=all | sed -n 's/^?? //p' | grep -v '/receipts/')
echo "new files checked: $count; problems: $([ $status -eq 0 ] && echo none || echo found)"
exit $status
