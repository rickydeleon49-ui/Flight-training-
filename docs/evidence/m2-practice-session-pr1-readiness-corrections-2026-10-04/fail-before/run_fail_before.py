"""Fail-before runner: the readiness review's three diagnostics against the
frozen submission (all 23 source hashes verified first). Temporary test files
are removed and backup.rs restored byte-for-byte in `finally`."""
from pathlib import Path
import hashlib, json, os, subprocess, sys

root = Path('/Users/rickymac/code/Flight-training-pr70-integration')
out = Path(__file__).resolve().parent
scratch = Path(sys.argv[1])
review = root / 'docs/evidence/m2-practice-session-pr1-readiness-review-2026-10-04'
expected = json.loads(subprocess.check_output(
    ['git', 'show', f'origin/main:{review.relative_to(root)}/source-hashes.json'], cwd=root, text=True))
env = os.environ.copy()
env['PATH'] = '/opt/homebrew/opt/node@22/bin:/Users/rickymac/.rustup/toolchains/stable-aarch64-apple-darwin/bin:' + env['PATH']
env['SDKROOT'] = '/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk'

def digest(p):
    return hashlib.sha256((root / p).read_bytes()).hexdigest()

results = {'frozen_source_hashes_match': all(digest(p) == h for p, h in expected.items())}
assert results['frozen_source_hashes_match'], 'source differs from the frozen submission'
backup = root / 'src-tauri/src/backup.rs'
original = backup.read_bytes()
browser = root / 'src/data/review-browser-startup.test.ts'
assert not browser.exists()
try:
    browser.write_bytes((scratch / 'browser-startup.test.ts').read_bytes())
    with (out / 'browser-fail-before.txt').open('w') as log:
        results['browser_exit'] = subprocess.run(
            ['npx', 'vitest', 'run', 'src/data/review-browser-startup.test.ts'],
            cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT).returncode
    backup.write_bytes(original + b'\n' + (scratch / 'native.rs').read_bytes())
    with (out / 'native-fail-before.txt').open('w') as log:
        results['native_exit'] = subprocess.run(
            ['cargo', 'test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--lib', '--',
             'codex_m2_readiness_review', '--test-threads=1'],
            cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT).returncode
finally:
    backup.write_bytes(original)
    browser.unlink(missing_ok=True)
    results['all_source_restored'] = all(digest(p) == h for p, h in expected.items())
    (out / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results))
