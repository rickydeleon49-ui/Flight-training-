"""R14 final sequential source gate. Every step's full output goes to its own
log; exits are recorded and a failure never stops later steps, so a failed
attempt is preserved as-is. npm test additionally records whether Vitest
reported any unhandled error.

Usage: run_checks.py <phase-dir-name> [step ...]   (default: all steps)"""
from pathlib import Path
import datetime, hashlib, json, os, subprocess, sys, time

root = Path('/Users/rickymac/.codex/worktrees/m2-pr2-source-integration/Flight-training-')
out = Path(__file__).resolve().parent / sys.argv[1]
out.mkdir(parents=True, exist_ok=True)
only = set(sys.argv[2:])
env = os.environ.copy()
env['PATH'] = '/opt/homebrew/opt/node@22/bin:/Users/rickymac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:' + env['PATH']
env['CARGO_TARGET_DIR'] = '/Users/rickymac/code/Flight-training-pr70-integration/src-tauri/target'
env['SDKROOT'] = '/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk'
MANIFEST = ['--manifest-path', 'src-tauri/Cargo.toml']

# Earlier local evidence directories hold verbatim tool output and must stay
# byte-unchanged; their whitespace is reported, not counted as a failure.
PRESERVED = (
    'docs/evidence/m2-practice-session-pr2-ui-2026-10-05/',
    'docs/evidence/m2-practice-session-pr2-corrections-2026-10-05/',
    'docs/evidence/m2-practice-session-pr2-finish-corrections-2026-10-05/',
    'docs/evidence/m2-practice-session-pr2-controller-fix-2026-10-06/',
    'docs/evidence/m2-practice-session-pr2-controller-fix-completion-2026-10-06/',
)


def whitespace_check():
    """`git diff --check` for tracked changes plus the same check (honouring
    .gitattributes) for every untracked file against /dev/null, which never
    touches the index. Fails on any problem outside the preserved receipts."""
    lines, problems, preserved = [], 0, []
    tracked = subprocess.run(['git', 'diff', '--check', 'HEAD'], cwd=root, capture_output=True, text=True)
    lines.append(f'$ git diff --check HEAD  -> exit {tracked.returncode}\n{tracked.stdout}{tracked.stderr}')
    problems += tracked.returncode != 0
    untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=root, text=True).split()
    for name in untracked:
        r = subprocess.run(['git', 'diff', '--no-index', '--check', '/dev/null', name], cwd=root, capture_output=True, text=True)
        if r.returncode in (0, 1) and r.stdout.strip() == '':
            continue
        if name.startswith(PRESERVED):
            preserved.append(name)
            continue
        problems += 1
        lines.append(f'$ git diff --no-index --check /dev/null {name} -> exit {r.returncode}\n{r.stdout}{r.stderr}')
    lines.append(f'untracked files checked: {len(untracked)}; files with whitespace problems (counted): {problems}')
    lines.append(f'preserved earlier receipts with verbatim-log whitespace (not edited, not counted): {len(preserved)}')
    lines.extend(f'  {name}' for name in preserved)
    return (1 if problems else 0), '\n'.join(lines) + '\n'


def migration_consistency():
    """Migrations 0001-0011, their checksum file and the registry are
    byte-identical to HEAD; every file's SHA-256 equals its checksum entry."""
    lines, failures = [], 0
    files = sorted((root / 'src-tauri/migrations').glob('*.sql'))
    paths = [f'src-tauri/migrations/{f.name}' for f in files] + ['src/data/migration-checksums.json', 'src/data/migrations.ts']
    diff = subprocess.run(['git', 'diff', '--exit-code', '--stat', 'HEAD', '--', *paths], cwd=root, capture_output=True, text=True)
    lines.append(f'migrations 0001-{files[-1].name[:4]}, checksums and registry unchanged vs HEAD: exit {diff.returncode} {diff.stdout.strip()}')
    failures += diff.returncode != 0
    untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', 'src-tauri/migrations'], cwd=root, text=True).split()
    lines.append(f'untracked migration files: {untracked}')
    failures += bool(untracked)
    sums = json.loads((root / 'src/data/migration-checksums.json').read_text())
    for f in files:
        actual = hashlib.sha256(f.read_bytes()).hexdigest()
        ok = sums.get(f.name) == actual
        failures += not ok
        lines.append(f'{f.name}: {"ok" if ok else "MISMATCH"} {actual}')
    registry = (root / 'src/data/migrations.ts').read_text()
    missing = [f.name for f in files if f.name not in registry]
    failures += bool(missing)
    lines.append(f'files missing from src/data/migrations.ts: {missing}')
    return (1 if failures else 0), '\n'.join(lines) + '\n'


STEPS = [
    ('01-typecheck', ['npm', 'run', 'typecheck']),
    ('02-npm-test', ['npm', 'test']),
    ('03-build', ['npm', 'run', 'build']),
    ('04-cargo-test', ['cargo', 'test', *MANIFEST, '--locked', '--all-targets']),
    ('05-clippy', ['cargo', 'clippy', '--locked', *MANIFEST, '--all-targets', '--', '-D', 'warnings']),
    ('06-fmt', ['cargo', 'fmt', *MANIFEST, '--check']),
    ('07-test-cargo-lock', ['npm', 'run', 'test:cargo-lock']),
    ('08-git-diff-check', whitespace_check),
    ('09-migration-consistency', migration_consistency),
]

summary_path = out / 'summary.json'
summary = json.loads(summary_path.read_text()) if summary_path.exists() else {'attempts': []}
for name, command in STEPS:
    if only and name not in only:
        continue
    started = time.time()
    log = out / f'{name}.txt'
    if callable(command):
        code, text = command()
        log.write_text(text)
        shown = command.__name__
    else:
        with log.open('w') as handle:
            handle.write(f'$ {" ".join(command)}\n')
            handle.flush()
            code = subprocess.run(command, cwd=root, env=env, stdout=handle, stderr=subprocess.STDOUT).returncode
        shown = ' '.join(command)
    body = log.read_text()
    summary['attempts'].append({
        'step': name, 'command': shown, 'exit': code,
        'unhandled_reported': ('nhandled Error' in body or 'unhandled error' in body) if name == '02-npm-test' else None,
        'seconds': round(time.time() - started, 1),
        'finished_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
    })
    summary_path.write_text(json.dumps(summary, indent=2) + '\n')
    print(name, code, flush=True)
