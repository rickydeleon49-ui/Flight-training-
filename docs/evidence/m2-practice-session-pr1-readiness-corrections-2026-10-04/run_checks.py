"""Focused checks, then (only if they pass) the one sequential required source
gate. Every step's full output goes to its own log; exits are recorded and a
failure never stops later steps, so a failed attempt is preserved as-is.

Usage: run_checks.py <phase-dir-name> [step ...]   (default: all steps)"""
from pathlib import Path
import datetime, hashlib, json, os, subprocess, sys, time

root = Path('/Users/rickymac/code/Flight-training-pr70-integration')
out = Path(__file__).resolve().parent / sys.argv[1]
out.mkdir(parents=True, exist_ok=True)
only = set(sys.argv[2:])
env = os.environ.copy()
env['PATH'] = '/opt/homebrew/opt/node@22/bin:/Users/rickymac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:' + env['PATH']
env['SDKROOT'] = '/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk'
MANIFEST = ['--manifest-path', 'src-tauri/Cargo.toml']

FOCUSED_FRONTEND = [
    'src/data/practiceStartupValidation.test.ts', 'src/data/practiceSessionContract.test.ts',
    'src/data/singleConnectionDrivers.test.ts', 'src/data/structuredImport.test.ts',
    'src/data/migrationSafety.test.ts', 'src/data/migrations.test.ts',
    'src/data/repositories/importStudyPacket.test.ts', 'src/acceptance/m1Upgrade.acceptance.test.ts',
]


def whitespace_check():
    """`git diff --check` for tracked changes plus the same check for every
    untracked file (against /dev/null, which never touches the index)."""
    lines, problems = [], 0
    tracked = subprocess.run(['git', 'diff', '--check', 'HEAD'], cwd=root, capture_output=True, text=True)
    lines.append(f'$ git diff --check HEAD  -> exit {tracked.returncode}\n{tracked.stdout}{tracked.stderr}')
    problems += tracked.returncode != 0
    untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=root, text=True).split()
    for name in untracked:
        r = subprocess.run(['git', 'diff', '--no-index', '--check', '/dev/null', name], cwd=root, capture_output=True, text=True)
        bad = r.returncode not in (0, 1) or r.stdout.strip() != ''
        problems += bad
        if bad:
            lines.append(f'$ git diff --no-index --check /dev/null {name} -> exit {r.returncode}\n{r.stdout}{r.stderr}')
    lines.append(f'untracked files checked: {len(untracked)}; files with whitespace problems: {problems}')
    return (1 if problems else 0), '\n'.join(lines) + '\n'


def migration_consistency():
    """Shipped migrations 1-10 byte-identical to HEAD; every migration file's
    SHA-256 equals migration-checksums.json; the registry lists every file."""
    lines, failures = [], 0
    files = sorted((root / 'src-tauri/migrations').glob('*.sql'))
    shipped = [f'src-tauri/migrations/{f.name}' for f in files if int(f.name[:4]) <= 10]
    diff = subprocess.run(['git', 'diff', '--exit-code', '--stat', 'HEAD', '--', *shipped], cwd=root, capture_output=True, text=True)
    lines.append(f'shipped migrations 0001-0010 unchanged vs HEAD: exit {diff.returncode} {diff.stdout.strip()}')
    failures += diff.returncode != 0
    sums = json.loads((root / 'src/data/migration-checksums.json').read_text())
    for f in files:
        actual = hashlib.sha256(f.read_bytes()).hexdigest()
        ok = sums.get(f.name) == actual
        failures += not ok
        lines.append(f'{f.name}: {"ok" if ok else "MISMATCH"} {actual}')
    extra = sorted(set(sums) - {f.name for f in files})
    failures += bool(extra)
    lines.append(f'checksum entries without a file: {extra}')
    registry = (root / 'src/data/migrations.ts').read_text()
    missing = [f.name for f in files if f.name not in registry]
    failures += bool(missing)
    lines.append(f'files missing from src/data/migrations.ts: {missing}')
    return (1 if failures else 0), '\n'.join(lines) + '\n'


STEPS = [
    ('00-focused-frontend', ['npx', 'vitest', 'run', *FOCUSED_FRONTEND]),
    ('00-focused-native', ['cargo', 'test', *MANIFEST, '--locked', '--lib', '--', 'practice_sessions::tests', 'backup::tests', '--test-threads=1']),
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
    summary['attempts'].append({
        'step': name, 'command': shown, 'exit': code,
        'seconds': round(time.time() - started, 1),
        'finished_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
    })
    summary_path.write_text(json.dumps(summary, indent=2) + '\n')
    print(name, code, flush=True)
