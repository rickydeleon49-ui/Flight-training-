from pathlib import Path
import re
import subprocess

root = Path.cwd()
evidence = root / 'docs/evidence/offline-gen-fix1-2026-10-20/correction-r2'
before = subprocess.check_output(['git', 'show', 'HEAD:src-tauri/Cargo.lock'], text=True)
after = (root / 'src-tauri/Cargo.lock').read_text()
diff = subprocess.check_output(['git', 'diff', '--', 'src-tauri/Cargo.lock'], text=True)
(evidence / 'Cargo.lock.diff').write_text(diff)
start = before.index('name = "her-flight-deck"\n')
end = before.index('\n[[package]]', start)
crate = before[start:end]
expected_crate = crate.replace(' "hex",\n', ' "hex",\n "http-body",\n')
assert expected_crate != crate
assert after == before[:start] + expected_crate + before[end:], 'Unexpected lockfile change'
packages = lambda s: re.findall(r'\[\[package\]\]\nname = "([^"]+)"\nversion = "([^"]+)"', s)
assert packages(before) == packages(after)
assert ('http-body', '1.1.0') in packages(after)
print('PASS: exact baseline lockfile plus only the her-flight-deck http-body dependency edge.')
print('Package entries added: 0; removed: 0; version changes: 0.')
print('http-body remains at 1.1.0; wasm-streams 0.4.2 absent.')
assert ('wasm-streams', '0.4.2') not in packages(after)
manifest = (root / 'src-tauri/Cargo.toml').read_text()
assert not re.search(r'^bytes\s*=', manifest, re.M)
reqwest = next(Path('/Users/rickymac/.cargo/registry/src').glob('*/reqwest-0.12.28/src'))
exports = [line for line in (reqwest / 'lib.rs').read_text().splitlines() if line.startswith('pub use')]
assert not any('bytes' in line.lower() for line in exports)
body = (reqwest / 'async_impl/body.rs').read_text()
assert 'use bytes::Bytes;' in body and 'pub use bytes::Bytes;' not in body
print('BLOCKER: bytes is not a direct application dependency; reqwest 0.12.28 privately imports Bytes and does not re-export it.')
print('reqwest source:', reqwest)
print('Public use declarations:')
print('\n'.join(exports))
print('Body source uses private: use bytes::Bytes;')
print('Step 3 requires stopping when bytes is unavailable directly or via a reqwest re-export.')
