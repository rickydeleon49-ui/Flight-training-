#!/usr/bin/env bash
#
# Public repository hygiene gate. Fails when a tracked file contains a local
# home path, a local account name, a private workflow folder or a personal
# email address. Run from anywhere: `npm run hygiene` or
# `bash scripts/public-hygiene.sh`.
#
# Test code often needs a fake home path ("/Users/someone/secret.pdf") to prove
# that paths are redacted, so only the placeholder user names below may follow
# "/Users/". Anything else after "/Users/" fails.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

SELF="scripts/public-hygiene.sh"

# Fail anywhere except in this script.
STRICT='rickymac|hfdtest|\.gen-rel-loop'

# Placeholder user names allowed after "/Users/" in tests.
PLACEHOLDER_USERS='someone|x|pilot|example|private-sentinel'

# Personal mailbox domains. Third-party license texts legitimately list their
# authors' addresses, so these files are exempt for this pattern only.
EMAIL='@(yahoo|gmail)\.'
EMAIL_ALLOWED=(
  "public/THIRD_PARTY_NOTICES.txt"
  "scripts/license-texts/"
  "src/logic/studyPacket/notices.test.ts"
)

failed=0
report() {
  echo "public-hygiene: $1" >&2
  failed=1
}

files=()
while IFS= read -r -d '' f; do
  [[ "$f" == "$SELF" ]] && continue
  [[ -f "$f" ]] || continue
  files+=("$f")
done < <(git ls-files -z)

if [[ ${#files[@]} -eq 0 ]]; then
  echo "public-hygiene: no tracked files found" >&2
  exit 2
fi

check() {
  # $1 = label, $2 = pattern, $3.. = files
  local label="$1" pattern="$2"
  shift 2
  [[ $# -eq 0 ]] && return 0
  local hits
  hits="$(printf '%s\0' "$@" | xargs -0 grep -I -n -E -i -- "$pattern" 2>/dev/null || true)"
  if [[ -n "$hits" ]]; then
    report "$label"
    printf '%s\n' "$hits" | cut -c1-200 >&2
  fi
}

check "local account or private workflow name" "$STRICT" "${files[@]}"

# Every "/Users/" occurrence must be followed by a placeholder user name.
users_hits="$(printf '%s\0' "${files[@]}" | xargs -0 grep -I -n -o -E -- '/Users/[A-Za-z0-9._-]*' 2>/dev/null || true)"
if [[ -n "$users_hits" ]]; then
  bad="$(printf '%s\n' "$users_hits" | grep -v -E -- ":/Users/(($PLACEHOLDER_USERS))?\$" || true)"
  if [[ -n "$bad" ]]; then
    report "home path with a real-looking user name (allowed placeholders: ${PLACEHOLDER_USERS//|/, })"
    printf '%s\n' "$bad" >&2
  fi
fi

email_files=()
for f in "${files[@]}"; do
  skip=0
  for allowed in "${EMAIL_ALLOWED[@]}"; do
    if [[ "$allowed" == */ ]]; then
      [[ "$f" == "$allowed"* ]] && skip=1
    else
      [[ "$f" == "$allowed" ]] && skip=1
    fi
  done
  [[ $skip -eq 1 ]] || email_files+=("$f")
done
check "personal email address" "$EMAIL" ${email_files[@]+"${email_files[@]}"}

if [[ $failed -ne 0 ]]; then
  echo "public-hygiene: FAIL (see above). Keep local paths, account names and personal addresses out of the public tree." >&2
  exit 1
fi
echo "public-hygiene: OK (${#files[@]} tracked files checked)"
