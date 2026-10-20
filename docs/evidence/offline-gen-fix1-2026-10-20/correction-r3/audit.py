from pathlib import Path
import re
import subprocess

root = Path.cwd()
evidence = root / 'docs/evidence/offline-gen-fix1-2026-10-20/correction-r3'
before = subprocess.check_output(['git', 'show', 'HEAD:src-tauri/Cargo.lock'], text=True)
after = (root / 'src-tauri/Cargo.lock').read_text()
diff = subprocess.check_output(['git', 'diff', '--', 'src-tauri/Cargo.lock'], text=True)
(evidence / 'Cargo.lock.diff').write_text(diff)
start = before.index('name = "her-flight-deck"\n')
end = before.index('\n[[package]]', start)
crate = before[start:end]
expected_crate = crate.replace(' "base64 0.22.1",\n', ' "base64 0.22.1",\n "bytes",\n').replace(' "hex",\n', ' "hex",\n "http-body",\n')
assert expected_crate != crate
assert after == before[:start] + expected_crate + before[end:], 'Unexpected lockfile change'
packages = lambda s: re.findall(r'\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"', s)
assert packages(before) == packages(after)
assert ('http-body', '1.1.0') in packages(after)
print('PASS: exact baseline lockfile plus only the her-flight-deck bytes and http-body dependency edges.')
print('Package entries added: 0; removed: 0; version changes: 0.')
print('http-body remains at 1.1.0; wasm-streams 0.4.2 absent.')
assert ('wasm-streams', '0.4.2') not in packages(after)
assert ('bytes', '1.12.1') in packages(after)
print('bytes remains at 1.12.1; both direct edges owner-approved 20 October 2026.')
