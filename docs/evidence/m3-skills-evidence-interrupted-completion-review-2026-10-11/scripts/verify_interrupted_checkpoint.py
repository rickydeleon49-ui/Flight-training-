#!/usr/bin/env python3
"""Read-only checkpoint verification. Supply the actual subject worktree."""
import sys,pathlib,json,hashlib
root=pathlib.Path(sys.argv[1]).resolve()
manifest=pathlib.Path(__file__).resolve().parents[1]/"interrupted-submission-hashes.json"
files=json.loads(manifest.read_text())["files"]
bad=[p for p,h in files.items() if not (root/p).is_file() or hashlib.sha256((root/p).read_bytes()).hexdigest()!=h]
for p in bad: print("MISMATCH",p)
print(f"{len(files)-len(bad)}/{len(files)} interrupted checkpoint paths match")
sys.exit(bool(bad))
