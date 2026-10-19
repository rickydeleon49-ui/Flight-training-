import os
import pathlib
import subprocess
import json
import time

root = pathlib.Path.cwd()
out = root / 'docs/evidence/gen-rel-05-2026-10-19'
env = dict(os.environ)
env['PATH'] = '/opt/homebrew/opt/node@22/bin:' + env['PATH']
env['CARGO_NET_OFFLINE'] = 'true'
checks = [
    ('typecheck', ['npm', 'run', 'typecheck']),
    ('frontend-tests', ['npm', 'test']),
    ('build', ['npm', 'run', 'build']),
    ('cargo-test', ['cargo', 'test', '--locked', '--manifest-path', 'src-tauri/Cargo.toml']),
    ('clippy', ['cargo', 'clippy', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--all-targets', '--', '-D', 'warnings']),
    ('fmt', ['cargo', 'fmt', '--manifest-path', 'src-tauri/Cargo.toml', '--check']),
    ('cargo-lock', ['npm', 'run', 'test:cargo-lock']),
    ('schema14', ['node', '--test', 'scripts/mac-schema14-profile-snapshot.test.mjs']),
    ('diff-check', ['git', 'diff', '--check']),
]
results = []
for name, args in checks:
    if name == 'schema14':
        flycheck = root / 'src-tauri/target/flycheck0'
        if flycheck.exists():
            import shutil
            shutil.rmtree(flycheck)
    check_env = dict(env)
    if args[0] == 'cargo':
        check_env['SDKROOT'] = '/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk'
    print('Starting ' + name, flush=True)
    started = time.monotonic()
    with (out / (name + '.log')).open('w') as log:
        log.write('COMMAND: ' + ' '.join(args) + '\n')
        log.write('PATH prefix: /opt/homebrew/opt/node@22/bin; CARGO_NET_OFFLINE=true\n')
        if args[0] == 'cargo':
            log.write('SDKROOT=' + check_env['SDKROOT'] + '\n')
        log.flush()
        done = subprocess.run(args, env=check_env, stdout=log, stderr=subprocess.STDOUT)
        log.write('\nEXIT: ' + str(done.returncode) + '\n')
    results.append(dict(check=name, exit=done.returncode, seconds=round(time.monotonic()-started, 2)))
    (out / 'gate-results.json').write_text(json.dumps(results, indent=2) + '\n')
    print(name + ': exit ' + str(done.returncode), flush=True)
