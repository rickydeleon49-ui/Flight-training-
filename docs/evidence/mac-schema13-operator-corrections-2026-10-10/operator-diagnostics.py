"""Promoted operator diagnostics and comprehensive MACV-R7 test suite for Her Flight Deck.
Preserves all original reviewer assertions from mac-schema13-operator-review-2026-10-09
and exercises:
- 0700 -> 0500 -> 0700 restoration
- Paths with spaces and another valid original mode (0750)
- Interrupted recovery and malformed/stale records
- Account-inspection failure (dseditgroup exit 2) and admin member refusal (exit 0)
- Traversal and symlink escapes (source & destination parent)
- Copy/move preservation, absent destinations, and self-nesting rejection
- Correct separation of readable inputs and writable user-owned outputs

Uses disclosed thin test adapter (_HFD_TEST_TOOLS_DIR / mock tools in PATH), inaccessible via CLI flags.
All profiles and directories are controlled disposable scratch fixtures.
"""
import pathlib
import tempfile
import subprocess
import json
import shutil
import os
import stat

source = pathlib.Path(__file__).parent / 'hfd-operator.sh'
scratch = pathlib.Path(tempfile.mkdtemp(prefix='macv-operator-review-')).resolve()

kit = scratch / 'kit'
tools = scratch / 'tools'
tools.mkdir()
(kit / 'bin').mkdir(parents=True)
(kit / 'profiles').mkdir()
(kit / 'evidence').mkdir()

root = scratch / 'Application Support/com.herflightdeck.app'
(root / 'backups').mkdir(parents=True)
root.chmod(0o700)
(root / 'backups').chmod(0o700)

script = source.read_text().replace(
    'APPROVED_ROOT="/Users/hfdtest/Library/Application Support/${APP_ID}"',
    f'APPROVED_ROOT="{root}"'
)
op = kit / 'bin/hfd-operator.sh'
op.write_text(script)
op.chmod(0o755)

def mock(name, body):
    p = tools / name
    p.write_text('#!/bin/bash\n' + body + '\n')
    p.chmod(0o755)

mock('id', 'case "$1" in -u) echo 502;; -un) echo hfdtest;; *) exit 2;; esac')
mock('dseditgroup', 'exit "${REVIEW_GROUP_STATUS:-1}"')
mock('pgrep', 'exit 1')

env = dict(os.environ, PATH=str(tools) + ':' + os.environ['PATH'], _HFD_TEST_TOOLS_DIR=str(tools))
results = []

def run(*args, extra=None):
    call_env = dict(env, **(extra or {}))
    return subprocess.run([str(op), *map(str, args)], capture_output=True, text=True, env=call_env)

def case(name, passed, p):
    results.append({
        'name': name,
        'pass': bool(passed),
        'exit': p.returncode,
        'output': p.stdout + p.stderr
    })

# -------------------------------------------------------------
# 1. Reviewer's 6 Baseline Tests (2 controls + 4 MACV-R7 assertions)
# -------------------------------------------------------------
src = kit / 'profiles/source'
src.mkdir()
(src / 'owned.txt').write_text('synthetic')

out = run('copy', src, kit / 'profiles/control')
case('[control] an allowed fresh copy preserves the source',
     out.returncode == 0 and (kit / 'profiles/control/owned.txt').read_text() == 'synthetic' and src.exists(),
     out)

out = run('block-backups')
case('[control] backup block succeeds and removes owner write',
     out.returncode == 0 and not (root / 'backups').stat().st_mode & 0o200,
     out)

out = run('unblock-backups')
case('[MACV-R7] unblock round-trips a path with Application Support spaces',
     out.returncode == 0 and (root / 'backups').stat().st_mode & 0o777 == 0o700,
     out)

(root / 'backups').chmod(0o700)
out = run('copy', root, kit / 'profiles/group-error', extra={'REVIEW_GROUP_STATUS': '2'})
case('[MACV-R7] account-inspection failure must refuse before copying',
     out.returncode == 2 and not (kit / 'profiles/group-error').exists(),
     out)

outside = kit / 'outside'
outside.mkdir()
(outside / 'owned.txt').write_text('task-owned outside policy')
out = run('copy', str(kit / 'profiles') + '/../outside', kit / 'profiles/traversal')
case('[MACV-R7] dot-dot operands cannot escape the profiles directory',
     out.returncode == 2 and not (kit / 'profiles/traversal').exists(),
     out)

target = scratch / 'outside-target'
target.mkdir()
(kit / 'profiles/link').symlink_to(target, target_is_directory=True)
out = run('copy', src, kit / 'profiles/link/escaped')
case('[MACV-R7] a symlink destination parent cannot escape the policy root',
     out.returncode == 2 and not (target / 'escaped').exists(),
     out)

# -------------------------------------------------------------
# 2. Promoted Tests: Permission Restoration Details
# -------------------------------------------------------------
# 2a: 0700 -> 0500 -> 0700 restoration
(root / 'backups').chmod(0o700)
out_block = run('block-backups')
blocked_mode = (root / 'backups').stat().st_mode & 0o777
out_unblock = run('unblock-backups')
restored_mode = (root / 'backups').stat().st_mode & 0o777
case('[MACV-R7] 0700 -> 0500 -> 0700 restoration preserves exact original mode',
     out_block.returncode == 0 and blocked_mode == 0o500 and out_unblock.returncode == 0 and restored_mode == 0o700,
     out_unblock)

# 2b: Non-standard valid original mode (0750) with spaces
(root / 'backups').chmod(0o750)
out_block750 = run('block-backups')
blocked_mode750 = (root / 'backups').stat().st_mode & 0o777
out_unblock750 = run('unblock-backups')
restored_mode750 = (root / 'backups').stat().st_mode & 0o777
case('[MACV-R7] non-default original mode 0750 round-trips exactly',
     out_block750.returncode == 0 and blocked_mode750 == 0o550 and out_unblock750.returncode == 0 and restored_mode750 == 0o750,
     out_unblock750)

# Reset to 0700
(root / 'backups').chmod(0o700)

# 2c: Repeated recovery / idempotent unblock
run('block-backups')
run('unblock-backups')
out_repeat_unblock = run('unblock-backups')
case('[MACV-R7] safe repeated unblock recovery is idempotent and exits 0',
     out_repeat_unblock.returncode == 0 and 'already at recorded original mode' in out_repeat_unblock.stdout,
     out_repeat_unblock)

# 2d: Repeated block-backups refused
run('block-backups')
out_repeat_block = run('block-backups')
case('[MACV-R7] repeated block-backups refuses recording already-blocked mode',
     out_repeat_block.returncode == 2 and 'already write-blocked' in out_repeat_block.stderr,
     out_repeat_block)
run('unblock-backups')

# 2e: Malformed mode record rejected
bad_record = kit / 'evidence/backups-original-mode-99999999T999999Z.txt'
bad_record.write_text('CORRUPT DATA NO FORMAT HEADER\n')
out_bad_rec = run('unblock-backups', bad_record)
case('[MACV-R7] malformed mode record is refused (fail closed)',
     out_bad_rec.returncode == 2 and 'malformed' in out_bad_rec.stderr,
     out_bad_rec)
bad_record.unlink()

# 2f: Stale / unrelated record path rejected
stale_record = kit / 'evidence/backups-original-mode-88888888T888888Z.txt'
stale_record.write_text(f"""FORMAT=hfd-backup-mode-record/1
RUN_ID=run-stale
OP_ID=block-stale
TIMESTAMP=20261008T000000Z
CANONICAL_PATH=/tmp/unrelated/path
ORIGINAL_MODE=0700
DEV_INO=1234:5678
""")
out_stale_rec = run('unblock-backups', stale_record)
case('[MACV-R7] unrelated record path is refused',
     out_stale_rec.returncode == 2 and 'names /tmp/unrelated/path' in out_stale_rec.stderr,
     out_stale_rec)
stale_record.unlink()

# 2g: Replacement directory rejected (device:inode mismatch)
run('block-backups')
# Replace directory with a fresh one (different inode)
shutil.rmtree(root / 'backups')
(root / 'backups').mkdir()
(root / 'backups').chmod(0o500)
out_replace_dir = run('unblock-backups')
case('[MACV-R7] replacement directory (device:inode mismatch) is refused',
     out_replace_dir.returncode == 2 and 'directory identity mismatch' in out_replace_dir.stderr,
     out_replace_dir)
# Clean up
(root / 'backups').chmod(0o700)

# -------------------------------------------------------------
# 3. Account Inspection Policy
# -------------------------------------------------------------
# 3a: Admin member (exit 0) refuses mutating command
out_admin = run('copy', root, kit / 'profiles/admin-leak', extra={'REVIEW_GROUP_STATUS': '0'})
case('[MACV-R7] admin group member refuses mutating operation (exit 2)',
     out_admin.returncode == 2 and 'is a member of admin' in out_admin.stderr and not (kit / 'profiles/admin-leak').exists(),
     out_admin)

# -------------------------------------------------------------
# 4. Path Validation & Mutation Safeguards
# -------------------------------------------------------------
# 4a: Traversal in destination path
out_traversal_dst = run('copy', src, kit / 'profiles/../escaped-dst')
case('[MACV-R7] traversal in destination operand is refused',
     out_traversal_dst.returncode == 2 and not (kit / 'escaped-dst').exists(),
     out_traversal_dst)

# 4b: Symlink source is refused
src_link = kit / 'profiles/src-link'
src_link.symlink_to(src, target_is_directory=True)
out_symlink_src = run('copy', src_link, kit / 'profiles/symlink-src-out')
case('[MACV-R7] symlink source operand is refused',
     out_symlink_src.returncode == 2 and not (kit / 'profiles/symlink-src-out').exists(),
     out_symlink_src)

# 4c: Existing destination copy refused and existing content preserved
existing_dst = kit / 'profiles/existing'
existing_dst.mkdir()
(existing_dst / 'original.txt').write_text('do-not-touch')
out_clobber_copy = run('copy', src, existing_dst)
case('[MACV-R7] existing destination copy is refused and preserves destination content',
     out_clobber_copy.returncode == 2 and (existing_dst / 'original.txt').read_text() == 'do-not-touch',
     out_clobber_copy)

# 4d: Existing destination move refused and source preserved
move_src = kit / 'profiles/move-src'
move_src.mkdir()
(move_src / 'keep.txt').write_text('keep-me')
out_clobber_move = run('move', move_src, existing_dst)
case('[MACV-R7] existing destination move is refused and preserves source and destination',
     out_clobber_move.returncode == 2 and (move_src / 'keep.txt').read_text() == 'keep-me' and (existing_dst / 'original.txt').read_text() == 'do-not-touch',
     out_clobber_move)

# 4e: Allowed move completes and removes source
out_valid_move = run('move', move_src, kit / 'profiles/move-dst')
case('[MACV-R7] allowed move completes and removes source folder',
     out_valid_move.returncode == 0 and not move_src.exists() and (kit / 'profiles/move-dst/keep.txt').read_text() == 'keep-me',
     out_valid_move)

# 4f: Self-nesting destination inside source is refused
out_nest = run('copy', src, src / 'inner')
case('[MACV-R7] self-nesting destination inside source is refused',
     out_nest.returncode == 2 and not (src / 'inner').exists(),
     out_nest)

# -------------------------------------------------------------
# 5. Separation of readable kit inputs and writable task workspace outputs
# -------------------------------------------------------------
workspace = scratch / 'workspace'
(workspace / 'profiles').mkdir(parents=True)
(workspace / 'evidence').mkdir(parents=True)
ws_env = dict(env, HFD_WORKSPACE=str(workspace), HFD_PROFILES=str(workspace / 'profiles'), HFD_EVIDENCE_PARENT=str(workspace / 'evidence'))
# In production runbook: copy "$HFD_ROOT" "$HFD_PROFILES/schema12-baseline"
out_ws_copy = subprocess.run([str(op), 'copy', str(root), str(workspace / 'profiles/copied-profile')],
                             capture_output=True, text=True, env=ws_env)
case('[MACV-R7] copy into user-owned task workspace succeeds cleanly',
     out_ws_copy.returncode == 0 and (workspace / 'profiles/copied-profile/backups').exists(),
     out_ws_copy)

shutil.rmtree(scratch)

report = {
    'source': str(source),
    'passed': sum(r['pass'] for r in results),
    'failed': sum(not r['pass'] for r in results),
    'total': len(results),
    'results': results
}
print(json.dumps(report, indent=2))
raise SystemExit(0 if all(r['pass'] for r in results) else 1)
