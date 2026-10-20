import os, subprocess, sys
from pathlib import Path
phase = sys.argv[1]
root = Path('/Users/rickymac/code/Flight-training-offline-gen-00')
evidence = root / 'docs/evidence/offline-gen-02a-2026-10-20/correction-r3'
receipt = '/Users/rickymac/code/.gen-rel-loop/offline/qwen-03b-r4-20261019/receipt.py'
os.chdir(root / 'src-tauri')
cmd = ['cargo', 'test', '--locked', 'cancellable_drop_restart_resume', '--', '--test-threads=1']
stress = subprocess.Popen(['python3', receipt, str(evidence / ('cargo-test-1.log' if phase == 'after' else 'stress-' + phase + '.log')), 'cargo', 'test', '--locked', '--no-fail-fast'])
failures = 0
attempts = 0
for attempt in range(1, 201):
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    attempts = attempt
    print(f'ATTEMPT {attempt}: $ {" ".join(cmd)}', flush=True)
    print(result.stdout.decode(errors='replace'), end='', flush=True)
    print(f'ATTEMPT {attempt} EXIT {result.returncode}', flush=True)
    (evidence / ("progress-" + phase + ".txt")).write_text(f"attempts={attempt} failures={failures + int(bool(result.returncode))}\n")
    if result.returncode:
        failures += 1
        if phase == 'before':
            break
stress_exit = stress.wait()
print(f'SUMMARY phase={phase} attempts={attempts} failures={failures} stress_EXIT={stress_exit}', flush=True)
sys.exit(1 if failures else 0)
