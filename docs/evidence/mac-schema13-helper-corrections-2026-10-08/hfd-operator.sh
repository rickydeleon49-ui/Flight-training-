#!/bin/bash
# Her Flight Deck schema-13 operator kit — validated profile switches and permission restore.
#
# Everything here refuses rather than repairs. It never deletes a profile, never writes
# inside an existing destination, and never touches a path outside the approved lane.
# Subcommands: stopped | status | move | copy | block-backups | unblock-backups | help
set -euo pipefail

APP_ID="com.herflightdeck.app"
APPROVED_UID="502"
APPROVED_ACCOUNT="hfdtest"
APPROVED_ROOT="/Users/hfdtest/Library/Application Support/${APP_ID}"
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILES_DIR="${KIT_DIR}/profiles"
EVIDENCE_DIR="${KIT_DIR}/evidence"
BUNDLES_DIR="/Users/hfdtest/Applications"
APP_MARKER='Her Flight Deck.app/Contents/MacOS/her-flight-deck'

die() { echo "REFUSED: $*" >&2; exit 2; }
ok() { echo "OK: $*"; }

require_uid() {
  local uid
  uid="$(id -u)"
  [ "$uid" = "$APPROVED_UID" ] || die "must run as uid ${APPROVED_UID} (${APPROVED_ACCOUNT}); this shell is uid ${uid}"
}

require_standard_account() {
  dseditgroup -o checkmember -m "${APPROVED_ACCOUNT}" admin >/dev/null 2>&1 \
    && die "${APPROVED_ACCOUNT} is a member of admin; the approved lane must be a standard account" \
    || true
  local resolved
  resolved="$(id -u "${APPROVED_ACCOUNT}" 2>/dev/null || true)"
  [ "${resolved}" = "${APPROVED_UID}" ] || die "${APPROVED_ACCOUNT} does not resolve to uid ${APPROVED_UID} (got '${resolved:-nothing}')"
}

# Both installs share one executable name, so both patterns are checked.
# pgrep(1): exit 0 = matched, 1 = nothing matched, anything else = cannot inspect (refuse).
# die runs in the current shell here — never inside a command substitution, whose refusal
# would be lost with the subshell.
require_stopped() {
  local out status
  if out="$(pgrep -f "${APP_MARKER}" 2>/dev/null)"; then status=0; else status=$?; fi
  if [ "${status}" -eq 0 ]; then die "an app is still running (pid(s) $(printf '%s' "${out}" | tr '\n' ' ')) — quit it with Cmd-Q and confirm with: $0 stopped"; fi
  if [ "${status}" -ne 1 ]; then die "bundle-path process inspection failed (pgrep exited ${status}) — inability to inspect is not proof that nothing is running"; fi
  if out="$(pgrep -x her-flight-deck 2>/dev/null)"; then status=0; else status=$?; fi
  if [ "${status}" -eq 0 ]; then die "an app is still running (pid(s) $(printf '%s' "${out}" | tr '\n' ' ')) — quit it with Cmd-Q and confirm with: $0 stopped"; fi
  if [ "${status}" -ne 1 ]; then die "executable-name process inspection failed (pgrep exited ${status}) — inability to inspect is not proof that nothing is running"; fi
}

touches_approved_root() {
  case "$1" in
    "${APPROVED_ROOT}") return 0 ;;
    *) return 1 ;;
  esac
}

allowed_path() {
  case "$1" in
    "${APPROVED_ROOT}") return 0 ;;
    "${PROFILES_DIR}"/*/) die "path $1 has a trailing slash; name the exact directory" ;;
    "${PROFILES_DIR}"/*) return 0 ;;
    *) die "path $1 is neither the approved data root nor inside ${PROFILES_DIR}" ;;
  esac
}

require_lane_for() {
  if touches_approved_root "$1" || touches_approved_root "$2"; then
    require_uid
    require_standard_account
  fi
}

usage() {
  cat <<EOF
hfd-operator.sh — validated helpers for the schema-13 physical gates

  stopped                 print OK only when no Her Flight Deck process exists
  status                  print uid, account class, resolved data root and app installs
  move  <from> <to>       validate, then mv a whole profile folder (destination must be absent)
  copy  <from> <to>       validate, then cp -R a whole profile folder (destination must be absent)
  block-backups           record the backups/ directory mode in this run's evidence dir, then remove write permission
  unblock-backups         restore the recorded mode and prove it
  help                    this text

Only the approved data root and paths under ${PROFILES_DIR} may be moved or copied.
Nothing here ever deletes a profile: a switch always has a named destination.
EOF
}

cmd="${1:-help}"
case "${cmd}" in
  stopped)
    require_stopped
    ok "no Her Flight Deck process is running"
    ;;
  status)
    echo "shell uid        : $(id -u)"
    echo "account          : $(id -un)"
    echo "admin member     : $(dseditgroup -o checkmember -m "$(id -un)" admin >/dev/null 2>&1 && echo yes || echo no)"
    echo "approved root    : ${APPROVED_ROOT}"
    echo "root exists      : $([ -d "${APPROVED_ROOT}" ] && echo yes || echo no)"
    echo "root database    : $([ -f "${APPROVED_ROOT}/her-flight-deck.db" ] && echo present || echo absent)"
    echo "kit profiles dir : ${PROFILES_DIR}"
    echo "app installs     : $(ls -d "${BUNDLES_DIR}"/HFD-*/Her\ Flight\ Deck.app 2>/dev/null | tr '\n' ' ')"
    echo "running processes: $(pgrep -f "${APP_MARKER}" | tr '\n' ' ')"
    ;;
  move|copy)
    shift
    [ "${#@}" -eq 2 ] || die "${cmd} needs exactly <from> <to>"
    from="$1"; to="$2"
    allowed_path "${from}"; allowed_path "${to}"
    require_lane_for "${from}" "${to}"
    require_stopped
    if [ ! -e "${from}" ]; then die "source ${from} does not exist (nothing to ${cmd})"; fi
    if [ ! -d "${from}" ]; then die "source ${from} is not a whole profile folder; a loose database/file is never a valid switch operand"; fi
    case "${to}/" in
      "${from}/"*) die "destination ${to} is inside the source ${from} — that would nest a profile inside itself" ;;
    esac
    case "${from}/" in
      "${to}/"*) die "source ${from} is inside the destination ${to}" ;;
    esac
    [ -e "${to}" ] && die "destination ${to} already exists — refusing to nest or overwrite; use a new name"
    [ -w "$(dirname "${to}")" ] || die "the parent of ${to} is not writable by uid $(id -u)"
    if [ "${cmd}" = "move" ]; then
      /bin/mv "${from}" "${to}"
      [ -d "${to}" ] && [ ! -e "${from}" ] || die "move did not complete as expected"
      ok "moved ${from} -> ${to}"
    else
      /bin/cp -R "${from}" "${to}"
      [ -d "${to}" ] && [ -d "${from}" ] || die "copy did not complete as expected"
      ok "copied ${from} -> ${to} (source retained)"
    fi
    ;;
  block-backups)
    require_uid
    require_standard_account
    dir="${APPROVED_ROOT}/backups"
    [ -d "${dir}" ] || die "${dir} does not exist yet; run this after the app has created its profile"
    mkdir -p "${EVIDENCE_DIR}"
    mode="$(stat -f '%Lp' "${dir}")"
    [ "${mode:0:1}" != "2" ] && [ "${mode:0:1}" != "0" ] || die "${dir} is already write-blocked (mode ${mode}); refusing to record a blocked mode as the original"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    record="${EVIDENCE_DIR}/backups-original-mode-${stamp}.txt"
    [ ! -e "${record}" ] || die "evidence record ${record} already exists"
    printf '%s %s\n' "${dir}" "${mode}" > "${record}"
    chmod u-w "${dir}"
    ok "recorded original mode ${mode} in ${record} and removed write permission"
    ;;
  unblock-backups)
    require_uid
    require_standard_account
    record="$(ls -1 "${EVIDENCE_DIR}"/backups-original-mode-*.txt 2>/dev/null | tail -1 || true)"
    [ -n "${record}" ] || die "no recorded original mode under ${EVIDENCE_DIR}; block-backups must run first"
    read -r dir mode < "${record}"
    [ "${dir}" = "${APPROVED_ROOT}/backups" ] || die "record ${record} names ${dir}, not the approved backups directory"
    chmod u+w "${dir}"
    now="$(stat -f '%Lp' "${dir}")"
    [ "${now}" = "${mode}" ] || die "restored mode ${now} does not equal the recorded original ${mode} — restore it by hand and record the difference"
    ok "restored ${dir} to its recorded original mode ${mode}"
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    usage >&2
    die "unknown subcommand ${cmd}"
    ;;
esac
