#!/bin/bash
# Whitespace hygiene: tracked diff, then every new file (raw receipts and the
# implementer's preserved partial work excluded; `node_modules` is the local
# dependency link, not delivered content).
set -u
cd "$(dirname "$0")/../../.."
status=0
git diff --check || status=1
count=0
while IFS= read -r f; do
  count=$((count + 1))
  problems=$(git diff --no-index --check /dev/null "$f" 2>&1)
  if [ -n "$problems" ]; then echo "$problems"; status=1; fi
done < <(git status --porcelain --untracked-files=all | sed -n 's/^?? //p' | grep -v '/receipts/' | grep -v '/implementer-partial/' | grep -vx 'node_modules')
echo "new files checked: $count; problems: $([ $status -eq 0 ] && echo none || echo found)"
exit $status
