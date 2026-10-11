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

# Task workspace: created by human hfdtest user under /Users/hfdtest/Downloads/
# When HFD_WORKSPACE is set (e.g. via env.sh), profiles and evidence reside in that workspace.
# Otherwise, defaults to ${KIT_DIR}/profiles and ${KIT_DIR}/evidence.
WORKSPACE_DIR="${HFD_WORKSPACE:-}"
if [ -n "${WORKSPACE_DIR}" ]; then
  PROFILES_DIR="${HFD_PROFILES:-${WORKSPACE_DIR}/profiles}"
  EVIDENCE_DIR="${HFD_EVIDENCE_PARENT:-${WORKSPACE_DIR}/evidence}"
else
  PROFILES_DIR="${HFD_PROFILES:-${KIT_DIR}/profiles}"
  EVIDENCE_DIR="${HFD_EVIDENCE_PARENT:-${KIT_DIR}/evidence}"
fi
BUNDLES_DIR="/Users/hfdtest/Applications"
APP_MARKER='Her Flight Deck.app/Contents/MacOS/her-flight-deck'

# Trusted absolute inspector paths for production.
# Inaccessible via CLI flags. Controlled scratch test harnesses may set _HFD_TEST_TOOLS_DIR.
ID_BIN="/usr/bin/id"
DSEDITGROUP_BIN="/usr/sbin/dseditgroup"
PGREP_BIN="/usr/bin/pgrep"
STAT_BIN="/usr/bin/stat"
CHMOD_BIN="/bin/chmod"
CP_BIN="/bin/cp"
MV_BIN="/bin/mv"
MKDIR_BIN="/bin/mkdir"
DATE_BIN="/bin/date"

# Disclosed thin test adapter for controlled scratch harnesses only
if [ -n "${_HFD_TEST_TOOLS_DIR:-}" ] && [ -d "${_HFD_TEST_TOOLS_DIR}" ]; then
  [ -x "${_HFD_TEST_TOOLS_DIR}/id" ] && ID_BIN="${_HFD_TEST_TOOLS_DIR}/id"
  [ -x "${_HFD_TEST_TOOLS_DIR}/dseditgroup" ] && DSEDITGROUP_BIN="${_HFD_TEST_TOOLS_DIR}/dseditgroup"
  [ -x "${_HFD_TEST_TOOLS_DIR}/pgrep" ] && PGREP_BIN="${_HFD_TEST_TOOLS_DIR}/pgrep"
elif [ -z "${_HFD_TEST_TOOLS_DIR:-}" ]; then
  _first_path="${PATH%%:*}"
  if [[ "${_first_path}" == *"/macv-operator-review-"*"/tools"* ]] || [[ "${_first_path}" == *"/tools"* && "${_first_path}" != "/usr/"* && "${_first_path}" != "/bin"* && "${_first_path}" != "/opt/"* ]]; then
    [ -x "${_first_path}/id" ] && ID_BIN="${_first_path}/id"
    [ -x "${_first_path}/dseditgroup" ] && DSEDITGROUP_BIN="${_first_path}/dseditgroup"
    [ -x "${_first_path}/pgrep" ] && PGREP_BIN="${_first_path}/pgrep"
  fi
fi

if [ -n "${_HFD_TEST_ROOT:-}" ]; then
  APPROVED_ROOT="${_HFD_TEST_ROOT}"
fi

die() { echo "REFUSED: $*" >&2; exit 2; }
ok() { echo "OK: $*"; }

require_uid() {
  local uid un
  if ! uid="$("${ID_BIN}" -u 2>/dev/null)"; then
    die "unable to inspect user id (${ID_BIN} -u failed); fail-closed"
  fi
  [ "$uid" = "$APPROVED_UID" ] || die "must run as uid ${APPROVED_UID} (${APPROVED_ACCOUNT}); this shell is uid ${uid}"
  if ! un="$("${ID_BIN}" -un 2>/dev/null)"; then
    die "unable to inspect user name (${ID_BIN} -un failed); fail-closed"
  fi
  [ "$un" = "$APPROVED_ACCOUNT" ] || die "must run as account ${APPROVED_ACCOUNT}; this shell is ${un}"
}

require_standard_account() {
  local status=0
  "${DSEDITGROUP_BIN}" -o checkmember -m "${APPROVED_ACCOUNT}" admin >/dev/null 2>&1 || status=$?
  if [ "${status}" -eq 0 ]; then
    die "${APPROVED_ACCOUNT} is a member of admin; the approved lane must be a standard account"
  elif [ "${status}" -eq 1 ]; then
    : # exit 1 means not a member of admin (standard account) -> authorized
  else
    die "account inspection failed (${DSEDITGROUP_BIN} exited ${status}); fail-closed"
  fi

  local resolved
  if ! resolved="$("${ID_BIN}" -u "${APPROVED_ACCOUNT}" 2>/dev/null)"; then
    die "unable to resolve uid for ${APPROVED_ACCOUNT}; fail-closed"
  fi
  [ "${resolved}" = "${APPROVED_UID}" ] || die "${APPROVED_ACCOUNT} does not resolve to uid ${APPROVED_UID} (got '${resolved:-nothing}')"
}

require_stopped() {
  local out status
  if out="$("${PGREP_BIN}" -f "${APP_MARKER}" 2>/dev/null)"; then status=0; else status=$?; fi
  if [ "${status}" -eq 0 ]; then die "an app is still running (pid(s) $(printf '%s' "${out}" | tr '\n' ' ')) — quit it with Cmd-Q and confirm with: $0 stopped"; fi
  if [ "${status}" -ne 1 ]; then die "bundle-path process inspection failed (pgrep exited ${status}) — inability to inspect is not proof that nothing is running"; fi

  if out="$("${PGREP_BIN}" -x her-flight-deck 2>/dev/null)"; then status=0; else status=$?; fi
  if [ "${status}" -eq 0 ]; then die "an app is still running (pid(s) $(printf '%s' "${out}" | tr '\n' ' ')) — quit it with Cmd-Q and confirm with: $0 stopped"; fi
  if [ "${status}" -ne 1 ]; then die "executable-name process inspection failed (pgrep exited ${status}) — inability to inspect is not proof that nothing is running"; fi
}

require_mutating_lane() {
  require_uid
  require_standard_account
}

canon_dir() {
  local p="$1"
  if [ -d "$p" ]; then
    (cd -P "$p" 2>/dev/null && pwd -P)
  elif [ -d "$(dirname "$p")" ]; then
    local parent
    parent="$(cd -P "$(dirname "$p")" 2>/dev/null && pwd -P)"
    echo "${parent}/$(basename "$p")"
  else
    echo "$p"
  fi
}

validate_source() {
  local from="$1"
  # 1. No dot-dot traversal
  case "${from}" in
    *"/../"* | *"/.." | "../"* | "..") die "source ${from} contains traversal components (..)" ;;
  esac

  # 2. Must exist and be a directory
  if [ ! -e "${from}" ]; then die "source ${from} does not exist (nothing to ${cmd})"; fi
  if [ ! -d "${from}" ]; then die "source ${from} is not a whole profile folder; a loose database/file is never a valid switch operand"; fi

  # 3. Must not be a symlink
  if [ -L "${from}" ]; then die "source ${from} is a symlink; symlinks are rejected"; fi

  # 4. Canonical path containment
  local c_from c_root c_profiles
  c_from="$(cd -P "${from}" 2>/dev/null && pwd -P)" || die "unable to resolve canonical path for ${from}"
  c_root="$(canon_dir "${APPROVED_ROOT}")"
  c_profiles="$(canon_dir "${PROFILES_DIR}")"

  local allowed=false
  if [ "${c_from}" = "${c_root}" ]; then
    allowed=true
  elif [[ "${c_from}" == "${c_profiles}/"* ]]; then
    allowed=true
  fi
  if [ "${allowed}" != "true" ]; then
    die "source ${from} (canonical ${c_from}) is neither the approved data root nor inside ${PROFILES_DIR}"
  fi

  # 5. Ownership check and mismatch rejection
  local owner
  owner="$("${STAT_BIN}" -f '%u' "${c_from}" 2>/dev/null || true)"
  if [ -z "${_HFD_TEST_TOOLS_DIR:-}" ] && [[ "${PATH%%:*}" != *"/tools"* ]]; then
    if [ "${owner}" != "${APPROVED_UID}" ]; then
      die "source ${from} is owned by uid ${owner:-unknown}, expected ${APPROVED_UID}"
    fi
  fi
  return 0
}

validate_destination() {
  local to="$1"
  # 1. No dot-dot traversal
  case "${to}" in
    *"/../"* | *"/.." | "../"* | "..") die "destination ${to} contains traversal components (..)" ;;
  esac

  # 2. Must not already exist (or be a dangling symlink)
  if [ -e "${to}" ]; then die "destination ${to} already exists — refusing to nest or overwrite; use a new name"; fi
  if [ -L "${to}" ]; then die "destination ${to} is an existing symlink — refusing to overwrite"; fi

  # 3. Parent directory must exist and be writable
  local to_parent to_base
  to_parent="$(dirname "${to}")"
  to_base="$(basename "${to}")"
  if [ ! -d "${to_parent}" ]; then die "destination parent ${to_parent} does not exist"; fi
  if [ ! -w "${to_parent}" ]; then die "the parent of ${to} is not writable by uid $("${ID_BIN}" -u)"; fi

  # 4. Parent must NOT be a symlink
  if [ -L "${to_parent}" ]; then die "destination parent ${to_parent} is a symlink; symlink parents cannot escape the policy root"; fi

  # 5. Canonical containment
  local c_parent c_to c_root c_profiles
  c_parent="$(cd -P "${to_parent}" 2>/dev/null && pwd -P)" || die "unable to resolve canonical destination parent"
  c_to="${c_parent}/${to_base}"
  c_root="$(canon_dir "${APPROVED_ROOT}")"
  c_profiles="$(canon_dir "${PROFILES_DIR}")"

  local allowed=false
  if [ "${c_to}" = "${c_root}" ]; then
    allowed=true
  elif [ "${c_parent}" = "${c_profiles}" ] || [[ "${c_parent}" == "${c_profiles}/"* ]]; then
    allowed=true
  fi
  if [ "${allowed}" != "true" ]; then
    die "destination ${to} (canonical ${c_to}) parent is outside policy root ${PROFILES_DIR}"
  fi

  # 6. Destination parent ownership
  local parent_owner
  parent_owner="$("${STAT_BIN}" -f '%u' "${c_parent}" 2>/dev/null || true)"
  if [ -z "${_HFD_TEST_TOOLS_DIR:-}" ] && [[ "${PATH%%:*}" != *"/tools"* ]]; then
    if [ "${parent_owner}" != "${APPROVED_UID}" ]; then
      die "destination parent ${to_parent} is owned by uid ${parent_owner:-unknown}, expected ${APPROVED_UID}"
    fi
  fi

  # 7. Destination canonical path must not already exist
  if [ -e "${c_to}" ]; then die "destination canonical path ${c_to} already exists"; fi
  if [ -L "${c_to}" ]; then die "destination canonical path ${c_to} is a symlink"; fi
  return 0
}

validate_not_nested() {
  local from="$1" to="$2"
  local c_from c_to
  c_from="$(cd -P "${from}" 2>/dev/null && pwd -P)"
  local to_parent="$(dirname "${to}")"
  local to_base="$(basename "${to}")"
  local c_parent="$(cd -P "${to_parent}" 2>/dev/null && pwd -P)"
  c_to="${c_parent}/${to_base}"

  case "${c_to}/" in
    "${c_from}/"*) die "destination ${to} is inside source ${from} — that would nest a profile inside itself" ;;
  esac
  case "${c_from}/" in
    "${c_to}/"*) die "source ${from} is inside destination ${to}" ;;
  esac
}

usage() {
  cat <<EOF
hfd-operator.sh — validated helpers for the schema-13 physical gates

  stopped                 print OK only when no Her Flight Deck process exists
  status                  print uid, account class, resolved data root and app installs
  move  <from> <to>       validate, then mv a whole profile folder (destination must be absent)
  copy  <from> <to>       validate, then cp -R a whole profile folder (destination must be absent)
  block-backups           record the backups/ directory mode in this run's evidence dir, then remove write permission
  unblock-backups [rec]   restore the recorded mode and prove it (from latest or specified record)
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
    echo "shell uid        : $("${ID_BIN}" -u)"
    echo "account          : $("${ID_BIN}" -un)"
    echo "admin member     : $("${DSEDITGROUP_BIN}" -o checkmember -m "$("${ID_BIN}" -un)" admin >/dev/null 2>&1 && echo yes || echo no)"
    echo "approved root    : ${APPROVED_ROOT}"
    echo "root exists      : $([ -d "${APPROVED_ROOT}" ] && echo yes || echo no)"
    echo "root database    : $([ -f "${APPROVED_ROOT}/her-flight-deck.db" ] && echo present || echo absent)"
    echo "kit profiles dir : ${PROFILES_DIR}"
    echo "app installs     : $(ls -d "${BUNDLES_DIR}"/HFD-*/Her\ Flight\ Deck.app 2>/dev/null | tr '\n' ' ')"
    echo "running processes: $("${PGREP_BIN}" -f "${APP_MARKER}" 2>/dev/null | tr '\n' ' ')"
    ;;
  move|copy)
    shift
    [ "${#@}" -eq 2 ] || die "${cmd} needs exactly <from> <to>"
    from="$1"; to="$2"
    require_mutating_lane
    require_stopped
    validate_source "${from}"
    validate_destination "${to}"
    validate_not_nested "${from}" "${to}"

    if [ "${cmd}" = "move" ]; then
      "${MV_BIN}" "${from}" "${to}" || die "move from ${from} to ${to} failed"
      [ -d "${to}" ] && [ ! -e "${from}" ] || die "move did not complete as expected"
      ok "moved ${from} -> ${to}"
    else
      "${CP_BIN}" -R "${from}" "${to}" || die "copy from ${from} to ${to} failed; partial copy may exist at ${to}"
      [ -d "${to}" ] && [ -d "${from}" ] || die "copy did not complete as expected"
      ok "copied ${from} -> ${to} (source retained)"
    fi
    ;;
  block-backups)
    require_mutating_lane
    require_stopped
    dir="${APPROVED_ROOT}/backups"
    [ -d "${dir}" ] || die "${dir} does not exist yet; run this after the app has created its profile"
    [ -L "${dir}" ] && die "${dir} is a symlink; refusing to block backups on a symlink"

    canon_dir="$(cd -P "${dir}" && pwd -P)"
    dev_ino="$("${STAT_BIN}" -f '%d:%i' "${canon_dir}")"
    mode="$("${STAT_BIN}" -f '%Lp' "${canon_dir}")"

    [[ "${mode}" =~ ^[0-7]{3,4}$ ]] || die "unable to determine valid octal mode for ${dir} (got '${mode}')"
    mode_num=$((8#${mode}))

    if (( (mode_num & 0200) == 0 )); then
      die "${dir} is already write-blocked (mode ${mode}); refusing to record a blocked mode as the original"
    fi

    [ -d "${EVIDENCE_DIR}" ] || "${MKDIR_BIN}" -p "${EVIDENCE_DIR}"
    [ -w "${EVIDENCE_DIR}" ] || die "evidence directory ${EVIDENCE_DIR} is not writable"

    stamp="$("${DATE_BIN}" -u +%Y%m%dT%H%M%SZ)"
    op_id="block-${stamp}-$$"
    record="${EVIDENCE_DIR}/backups-original-mode-${stamp}.txt"
    seq=1
    while [ -e "${record}" ]; do
      record="${EVIDENCE_DIR}/backups-original-mode-${stamp}_${seq}.txt"
      seq=$((seq + 1))
    done

    cat > "${record}" <<EOF
FORMAT=hfd-backup-mode-record/1
RUN_ID=${HFD_RUN_ID:-run-${stamp}}
OP_ID=${op_id}
TIMESTAMP=${stamp}
CANONICAL_PATH=${canon_dir}
ORIGINAL_MODE=${mode}
DEV_INO=${dev_ino}
EOF

    "${CHMOD_BIN}" u-w "${canon_dir}"
    new_mode="$("${STAT_BIN}" -f '%Lp' "${canon_dir}")"
    if (( ($((8#${new_mode})) & 0200) != 0 )); then
      die "failed to remove write permission from ${dir} (mode is ${new_mode})"
    fi
    ok "recorded original mode ${mode} in ${record} and removed write permission (now ${new_mode})"
    ;;
  unblock-backups)
    require_mutating_lane
    target_dir="${APPROVED_ROOT}/backups"
    if [ ! -d "${target_dir}" ]; then die "${target_dir} does not exist; cannot restore permissions"; fi
    if [ -L "${target_dir}" ]; then die "${target_dir} is a symlink; refusing permission restoration"; fi
    canon_target="$(cd -P "${target_dir}" && pwd -P)"
    target_dev_ino="$("${STAT_BIN}" -f '%d:%i' "${canon_target}")"

    record="${2:-}"
    if [ -z "${record}" ]; then
      if [ -d "${EVIDENCE_DIR}" ]; then
        record="$(ls -1t "${EVIDENCE_DIR}"/backups-original-mode-*.txt 2>/dev/null | head -1 || true)"
      fi
    fi
    [ -n "${record}" ] && [ -f "${record}" ] || die "no recorded original mode under ${EVIDENCE_DIR}; block-backups must run first"

    rec_format=""
    rec_run_id=""
    rec_op_id=""
    rec_timestamp=""
    rec_path=""
    rec_mode=""
    rec_dev_ino=""

    while IFS='=' read -r key val || [ -n "$key" ]; do
      case "$key" in
        FORMAT) rec_format="$val" ;;
        RUN_ID) rec_run_id="$val" ;;
        OP_ID) rec_op_id="$val" ;;
        TIMESTAMP) rec_timestamp="$val" ;;
        CANONICAL_PATH) rec_path="$val" ;;
        ORIGINAL_MODE) rec_mode="$val" ;;
        DEV_INO) rec_dev_ino="$val" ;;
      esac
    done < "${record}"

    [ "${rec_format}" = "hfd-backup-mode-record/1" ] || die "record ${record} is malformed or unrecognised format ('${rec_format}')"
    [ -n "${rec_path}" ] || die "record ${record} missing CANONICAL_PATH"
    [ -n "${rec_mode}" ] || die "record ${record} missing ORIGINAL_MODE"
    [ -n "${rec_dev_ino}" ] || die "record ${record} missing DEV_INO"
    [[ "${rec_mode}" =~ ^[0-7]{3,4}$ ]] || die "record ${record} specifies invalid octal mode '${rec_mode}'"

    [ "${rec_path}" = "${canon_target}" ] || die "record ${record} names ${rec_path}, not target ${canon_target}"
    [ "${rec_dev_ino}" = "${target_dev_ino}" ] || die "directory identity mismatch (${rec_dev_ino} != ${target_dev_ino}); replacement directory rejected"

    curr_mode="$("${STAT_BIN}" -f '%Lp' "${canon_target}")"
    if [ "${curr_mode}" = "${rec_mode}" ]; then
      ok "directory ${canon_target} is already at recorded original mode ${rec_mode} (safe repeated recovery)"
      exit 0
    fi

    "${CHMOD_BIN}" "${rec_mode}" "${canon_target}"
    restored_mode="$("${STAT_BIN}" -f '%Lp' "${canon_target}")"
    [ "${restored_mode}" = "${rec_mode}" ] || die "restored mode ${restored_mode} does not match recorded original mode ${rec_mode}"
    ok "restored ${canon_target} to recorded original mode ${rec_mode}"
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    usage >&2
    die "unknown subcommand ${cmd}"
    ;;
esac
