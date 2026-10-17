#!/usr/bin/env python3
"""Run worker fault cases against a built proof binary.

Each case runs in a fresh process group under an external safety timeout. The
timeout only protects the harness: if it fires, the proof failed to settle by
itself and the case is recorded as such. Usage:

  worker-fault-driver.py BINARY OUT.json SCRATCH_ROOT MODE [MODE ...]

BINARY must accept `review-case MODE NEW_SCRATCH` (the review adapter entry
point, or the corrected proof's built-in `fault-case`, selected with
--entry).
"""
import json, os, signal, subprocess, sys, time
from pathlib import Path

args = sys.argv[1:]
entry = 'review-case'
if args and args[0].startswith('--entry='):
    entry = args.pop(0).split('=', 1)[1]
binary, out, root, modes = Path(args[0]), Path(args[1]), Path(args[2]), args[3:]
if out.exists() or root.exists():
    sys.exit('refusing existing output or scratch root')
root.mkdir(parents=True)
SAFETY_SECONDS = 3
results = []
for mode in modes:
    scratch = root / mode
    start = time.monotonic()
    proc = subprocess.Popen([str(binary), entry, mode, str(scratch)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    forced = False
    try:
        stdout, stderr = proc.communicate(timeout=SAFETY_SECONDS)
    except subprocess.TimeoutExpired:
        forced = True
        os.killpg(proc.pid, signal.SIGKILL)
        stdout, stderr = proc.communicate()
    results.append({
        'mode': mode,
        'externalSafetyTimeoutSeconds': SAFETY_SECONDS,
        'externalSafetyKillNeeded': forced,
        'exit': proc.returncode,
        'elapsedSeconds': time.monotonic() - start,
        'stdout': stdout.decode('utf-8', 'replace'),
        'stderr': stderr.decode('utf-8', 'replace')[-2000:],
    })
out.write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
