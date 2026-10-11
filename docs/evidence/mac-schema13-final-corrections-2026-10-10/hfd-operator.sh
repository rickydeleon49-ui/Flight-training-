#!/bin/bash
# Production entry point: fixed lane and trusted inspectors; no test/environment bypasses.
set -euo pipefail
APPROVED_UID=502
APPROVED_ACCOUNT=hfdtest
APPROVED_ROOT='/Users/hfdtest/Library/Application Support/com.herflightdeck.app'
WORKSPACE='/Users/hfdtest/Downloads/hfd-schema13-workspace'
APPLICATIONS='/Users/hfdtest/Applications'
ID_BIN=/usr/bin/id
GROUP_BIN=/usr/sbin/dseditgroup
PGREP_BIN=/usr/bin/pgrep
STAT_BIN=/usr/bin/stat
CHMOD_BIN=/bin/chmod
CP_BIN=/bin/cp
MV_BIN=/bin/mv
NODE_BIN=/opt/homebrew/opt/node@22/bin/node
KIT='/Users/Shared/hfd-schema13-kit-2026-10-08'
die() { echo "REFUSED: $*" >&2; exit 2; }
ok() { echo "OK: $*"; }
require_account() {
  local uid name resolved status=0
  uid="$("$ID_BIN" -u)" || die 'cannot inspect uid'
  name="$("$ID_BIN" -un)" || die 'cannot inspect account'
  resolved="$("$ID_BIN" -u "$APPROVED_ACCOUNT")" || die 'cannot resolve approved account'
  [ "$uid" = "$APPROVED_UID" ] && [ "$name" = "$APPROVED_ACCOUNT" ] && [ "$resolved" = "$APPROVED_UID" ] || die 'must run as uid 502 (hfdtest)'
  "$GROUP_BIN" -o checkmember -m "$APPROVED_ACCOUNT" admin >/dev/null 2>&1 || status=$?
  [ "$status" -eq 1 ] || die "admin account or account inspection failed (exit $status)"
}
stopped() {
  local status probe
  for probe in bundle executable; do
    status=0
    if [ "$probe" = bundle ]; then "$PGREP_BIN" -f 'Her Flight Deck.app/Contents/MacOS/her-flight-deck' >/dev/null 2>&1 || status=$?
    else "$PGREP_BIN" -x her-flight-deck >/dev/null 2>&1 || status=$?; fi
    [ "$status" -eq 1 ] || die "app running or process inspection failed ($probe exit $status)"
  done
}
# Reject aliases in every component, including nonexistent final destinations.
plain_path() {
  local p="$1" rest component current=''
  [[ "$p" = /* ]] || die 'path must be absolute'
  [[ "$p" != *$'\n'* && "$p" != *$'\r'* ]] || die 'path contains a line break'
  rest="${p#/}"
  while [ -n "$rest" ]; do
    component="${rest%%/*}"
    [[ "$component" != . && "$component" != .. && -n "$component" ]] || die 'path contains traversal or empty component'
    current="$current/$component"
    [ ! -L "$current" ] || die "symlink component: $current"
    if [[ "$rest" = */* ]]; then rest="${rest#*/}"; else rest=''; fi
  done
}
owned_dir() {
  local p="$1" owner
  plain_path "$p"
  [ -d "$p" ] || die "directory absent: $p"
  owner="$("$STAT_BIN" -f %u "$p")" || die 'cannot inspect ownership'
  [ "$owner" = "$APPROVED_UID" ] || die "ownership mismatch: $p"
}
regular_record() {
  local p="$1" owner links
  plain_path "$p"
  [ -f "$p" ] || die "record absent or non-regular: $p"
  owner="$("$STAT_BIN" -f %u "$p")"; links="$("$STAT_BIN" -f %l "$p")"
  [ "$owner" = "$APPROVED_UID" ] && [ "$links" = 1 ] || die 'record owner/link mismatch'
}
require_workspace() {
  [ "${HFD_WORKSPACE:-$WORKSPACE}" = "$WORKSPACE" ] || die 'workspace cannot redefine the approved lane'
  PROFILES="$WORKSPACE/profiles"
  [ "${HFD_PROFILES:-$PROFILES}" = "$PROFILES" ] || die 'profiles cannot redefine the approved lane'
  owned_dir "$(/usr/bin/dirname "$WORKSPACE")"
  owned_dir "$WORKSPACE"; owned_dir "$PROFILES"; owned_dir "$WORKSPACE/evidence"
  [ -w "$WORKSPACE" ] && [ -w "$PROFILES" ] && [ -w "$WORKSPACE/evidence" ] || die 'workspace outputs are not writable'
}
require_run() {
  require_workspace
  RUN_ID="${HFD_RUN_ID:-}"
  [[ "$RUN_ID" =~ ^run-[A-Za-z0-9_-]+$ ]] || die 'set the explicit current HFD_RUN_ID'
  EVIDENCE="$WORKSPACE/evidence/$RUN_ID"
  [ "${HFD_EVID:-$EVIDENCE}" = "$EVIDENCE" ] || die 'run evidence path does not match its ID'
  owned_dir "$EVIDENCE"; [ -w "$EVIDENCE" ] || die 'run evidence is not writable'
  ACTIVE="$EVIDENCE/active-backup-operation.txt"
}
allowed_source() {
  local p="$1"
  owned_dir "$p"
  [[ "$p" = "$APPROVED_ROOT" || "$p" = "$PROFILES/"* ]] || die 'source outside the approved profile boundary'
}
allowed_destination() {
  local p="$1" parent
  plain_path "$p"; parent="$(/usr/bin/dirname "$p")"; owned_dir "$parent"
  [ ! -e "$p" ] && [ ! -L "$p" ] || die 'destination already exists; refusing overwrite or nesting'
  [[ "$p" = "$APPROVED_ROOT" || "$parent" = "$PROFILES" || "$parent" = "$PROFILES/"* ]] || die 'destination outside the approved profile boundary'
  [ -w "$parent" ] || die 'destination parent not writable'
}
read_active() {
  regular_record "$ACTIVE"
  active_name="$(/bin/cat "$ACTIVE")"
  [[ "$active_name" =~ ^backup-[A-Za-z0-9_-]+\.txt$ ]] || die 'invalid active operation pointer'
  record="$EVIDENCE/$active_name"
  regular_record "$record"
}
restore_record() {
  local requested="${1:-}" key value keys='|' fmt='' run='' op='' dir='' mode='' identity=''
  read_active
  [ -z "$requested" ] || [ "$requested" = "$record" ] || die 'record is not this run’s active operation'
  while IFS='=' read -r key value || [ -n "$key" ]; do
    [[ "$keys" != *"|$key|"* ]] || die "duplicate record key: $key"
    keys="$keys$key|"
    case "$key" in
      FORMAT) fmt="$value";; RUN_ID) run="$value";; OP_ID) op="$value";;
      CANONICAL_PATH) dir="$value";; ORIGINAL_MODE) mode="$value";; DEV_INO) identity="$value";;
      *) die "unknown record key: $key";;
    esac
  done < "$record"
  [ "$fmt" = hfd-backup-mode-record/2 ] && [ "$run" = "$RUN_ID" ] && [ "$op.txt" = "$active_name" ] || die 'record run/operation/format mismatch'
  [ "$dir" = "$APPROVED_ROOT/backups" ] || die 'record backup path mismatch'
  [[ "$mode" =~ ^[0-7]{3,4}$ && "$identity" =~ ^[0-9]+:[0-9]+$ ]] || die 'record mode/identity missing or invalid'
  (( (8#$mode & 0200) != 0 )) || die 'record original mode was already blocked'
  owned_dir "$APPROVED_ROOT"; owned_dir "$dir"
  if [ -e "$record.restored" ] || [ -L "$record.restored" ]; then
    regular_record "$record.restored"
    [ "$(/bin/cat "$record.restored")" = "$op" ] || die 'restoration completion marker mismatch'
  fi
  [ "$("$STAT_BIN" -f '%d:%i' "$dir")" = "$identity" ] || die 'replacement directory identity mismatch'
  local current="$("$STAT_BIN" -f %Lp "$dir")" blocked=$((8#$mode & ~0200))
  (( 8#$current == 8#$mode || 8#$current == blocked )) || die 'current mode is neither this operation’s blocked nor original mode'
  "$CHMOD_BIN" "$mode" "$dir"
  local restored="$("$STAT_BIN" -f %Lp "$dir")"
  (( 8#$restored == 8#$mode )) || die 'permission restoration did not match recorded mode'
  if [ ! -e "$record.restored" ]; then
    (umask 077; set -o noclobber; /usr/bin/printf '%s\n' "$op" > "$record.restored") || die 'completion marker collision'
  fi
  ok "restored exact mode $mode using $record (safe repeated recovery)"
}
cmd="${1:-help}"; shift || true
case "$cmd" in
  stopped) stopped; ok 'no Her Flight Deck process is running';;
  status) require_account; require_workspace; ok "approved account; workspace $WORKSPACE; root $APPROVED_ROOT";;
  fresh-root)
    require_account; stopped; require_workspace; plain_path "$APPROVED_ROOT"
    [ ! -e "$APPROVED_ROOT" ] && [ ! -L "$APPROVED_ROOT" ] || die 'existing app profile; preserve it and stop before launching'
    ok 'approved app root is absent; fresh-profile gate may begin';;
  prepare)
    require_account; stopped
    [ "${HFD_WORKSPACE:-$WORKSPACE}" = "$WORKSPACE" ] || die 'workspace override refused'
    owned_dir "$(/usr/bin/dirname "$WORKSPACE")"
    plain_path "$WORKSPACE"
    [ ! -e "$WORKSPACE" ] || die 'workspace exists; preserve it and resume the original run'
    /bin/mkdir -m 700 "$WORKSPACE"
    /bin/mkdir -m 700 "$WORKSPACE/profiles" "$WORKSPACE/evidence"
    ok "fresh workspace $WORKSPACE";;
  new-run)
    require_account; stopped; require_workspace
    [ "$#" -eq 1 ] || die 'new-run requires an explicit run-ID'
    RUN_ID="$1"; [[ "$RUN_ID" =~ ^run-[A-Za-z0-9_-]+$ ]] || die 'invalid run ID'
    target="$WORKSPACE/evidence/$RUN_ID"; profile_target="$WORKSPACE/profiles/$RUN_ID"; plain_path "$target"; plain_path "$profile_target"
    [ ! -e "$target" ] && [ ! -e "$profile_target" ] || die 'run already exists; resume without overwriting'
    /bin/mkdir -m 700 "$target" "$profile_target"; ok "fresh run $RUN_ID";;
  copy|move)
    [ "$#" -eq 2 ] || die 'copy/move needs source and destination'
    require_account; stopped; require_workspace
    from="$1"; to="$2"; allowed_source "$from"; allowed_destination "$to"
    [[ "$to/" != "$from/"* && "$from/" != "$to/"* ]] || die 'self-nesting refused'
    if [ "$cmd" = copy ]; then "$CP_BIN" -R "$from" "$to" || die "copy failed; source retained, partial destination may exist at $to"
    else "$MV_BIN" "$from" "$to" || die "move failed; inspect both task paths before recovery"; fi
    ok "$cmd completed: $from -> $to";;
  block-backups)
    [ "$#" -eq 0 ] || die 'block takes no operands'
    require_account; stopped; require_run
    dir="$APPROVED_ROOT/backups"; owned_dir "$APPROVED_ROOT"; owned_dir "$dir"
    mode="$("$STAT_BIN" -f %Lp "$dir")"; [[ "$mode" =~ ^[0-7]{3,4}$ ]] || die 'invalid directory mode'
    (( (8#$mode & 0200) != 0 )) || die 'backups already write-blocked'
    if [ -e "$ACTIVE" ] || [ -L "$ACTIVE" ]; then
      read_active; regular_record "$record.restored"
      [ "$(/bin/cat "$record.restored")" = "${active_name%.txt}" ] || die 'previous operation is not completed'
    fi
    op_id="backup-$(/bin/date -u +%Y%m%dT%H%M%SZ)-$$"
    record="$EVIDENCE/$op_id.txt"; plain_path "$record"; [ ! -e "$record" ] && [ ! -L "$record" ] || die 'record target exists'
    identity="$("$STAT_BIN" -f '%d:%i' "$dir")"
    (umask 077; set -o noclobber; /usr/bin/printf 'FORMAT=hfd-backup-mode-record/2\nRUN_ID=%s\nOP_ID=%s\nCANONICAL_PATH=%s\nORIGINAL_MODE=%s\nDEV_INO=%s\n' "$RUN_ID" "$op_id" "$dir" "$mode" "$identity" > "$record") || die 'record collision; no permissions changed'
    pointer="$EVIDENCE/.active-$$"; plain_path "$pointer"; [ ! -e "$pointer" ] && [ ! -L "$pointer" ] || die 'pointer target exists'
    (umask 077; set -o noclobber; /usr/bin/printf '%s\n' "$op_id.txt" > "$pointer") || die 'pointer collision; no permissions changed'
    /bin/mv "$pointer" "$ACTIVE"
    "$CHMOD_BIN" u-w "$dir"
    current="$("$STAT_BIN" -f %Lp "$dir")"
    (( (8#$current & 0200) == 0 )) || die "block failed; recover with unblock-backups $record"
    ok "blocked backups; explicit recovery record $record";;
  unblock-backups)
    [ "$#" -le 1 ] || die 'unblock takes at most the explicit record'
    require_account; stopped; require_run; restore_record "${1:-}";;
  install)
    [ "$#" -eq 1 ] || die 'install requires OLD or NEW'
    require_account; stopped; require_run
    owned_dir "$APPLICATIONS"
    [ -x "$NODE_BIN" ] || die 'required Node22 runtime unavailable'
    "$NODE_BIN" "$KIT/bin/hfd-install-candidate.mjs" "$1";;
  help|--help|-h) echo 'hfd-operator: fresh-root | prepare | new-run run-ID | stopped | status | copy source destination | move source destination | block-backups | unblock-backups [record] | install OLD|NEW';;
  *) die 'unknown subcommand';;
esac
