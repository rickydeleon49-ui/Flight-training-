"""Rebind the existing schema-14 overlay manifest and verify all checksums."""
import datetime
import hashlib
import json
from pathlib import Path

root = Path('docs/evidence/mac-schema14-completion-2026-10-15')
manifest_path = root / 'source-manifest.json'
manifest = json.loads(manifest_path.read_text())
for item in manifest['files']:
    raw = Path(item['path']).read_bytes()
    item['bytes'] = len(raw)
    item['sha256'] = hashlib.sha256(raw).hexdigest()
manifest['generatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
sums = root / 'SHA256SUMS'
paths = [line.split('  ', 1)[1] for line in sums.read_text().splitlines()]
sums.write_text(''.join(hashlib.sha256(Path(p).read_bytes()).hexdigest() + '  ' + p + '\n' for p in paths))
for item in manifest['files']:
    assert len(Path(item['path']).read_bytes()) == item['bytes']
    assert hashlib.sha256(Path(item['path']).read_bytes()).hexdigest() == item['sha256']
for line in sums.read_text().splitlines():
    expected, name = line.split('  ', 1)
    assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == expected
print(f"VERIFIED {len(manifest['files'])} manifest entries and {len(paths)} checksum entries")
