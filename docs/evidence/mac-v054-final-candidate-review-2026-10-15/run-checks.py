import json, os, pathlib, subprocess, time
root = pathlib.Path('/Users/rickymac/code/Flight-training-')
out = pathlib.Path(__file__).parent
env = os.environ.copy()
env['PATH'] = '/opt/homebrew/opt/node@22/bin:/Users/rickymac/.cargo/bin:' + env['PATH']
checks = [
    ('helper', ['node', '--test', 'scripts/mac-schema14-profile-snapshot.test.mjs']),
    ('focused', ['node', 'node_modules/vitest/vitest.mjs', 'run', '--maxWorkers=2', 'src/logic/dailyPlan.test.ts', 'src/components/dailyPlan/DailyPlanCard.test.ts', 'src/logic/currentSchemaVerification.test.ts']),
    ('cargo-lock', ['npm', 'run', 'test:cargo-lock']),
]
results = []
for name, cmd in checks:
    start = time.monotonic()
    p = subprocess.run(cmd, cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (out / (name + '.txt')).write_bytes(p.stdout)
    results.append({'name': name, 'command': cmd, 'exit': p.returncode, 'seconds': round(time.monotonic() - start, 2)})
    (out / 'checks.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(results[-1]), flush=True)
    if p.returncode:
        print(p.stdout.decode(errors='replace')[-4000:])
        raise SystemExit(p.returncode)
