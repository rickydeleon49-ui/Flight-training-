#!/usr/bin/env python3
"""Verify the re-review's frozen correction submission and the anchors, from
git objects only (nothing is written):

  python3 -I docs/evidence/m3-skills-evidence-scope-remaining-corrections-2026-10-11/scripts/verify_rereview_identity.py

1. The 127 frozen paths (re-review submitted-hashes.json on origin/main)
   against origin/main: 124 directly, ROADMAP/STATUS/handoff through the
   re-review's submitted-documents snapshots.
2. The corrections pack's 64 SHA256SUMS entries and the 56 scope-pack
   checksums (corrections pack scope-pack-SHA256SUMS), against origin/main.
3. The six document hashes (corrections pack document-hashes.json).
4. The 30 production anchors: worktree == 48fa47d == origin/main.
5. Which frozen paths this worktree now changes (expected: the remaining
   corrections only).
"""
import hashlib
import json
import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[4]
BASE = "48fa47d9d035b2636b72fd6692930d85f4992bb9"
REREVIEW = "docs/evidence/m3-skills-evidence-scope-rereview-2026-10-11"
CORR = "docs/evidence/m3-skills-evidence-scope-corrections-2026-10-11"
PACK = "docs/evidence/m3-skills-evidence-scope-2026-10-10"
TRACKING = ("ROADMAP.md", "STATUS.md", "docs/PROJECT_HANDOFF.md")


def show(rev, path):
    out = subprocess.run(["git", "show", f"{rev}:{path}"], cwd=REPO, capture_output=True)
    return out.stdout if out.returncode == 0 else None


def sha(data):
    return hashlib.sha256(data).hexdigest() if data is not None else None


def check_sums(text, root, label):
    bad = 0
    lines = text.decode().splitlines()
    for line in lines:
        digest, rel = line.split(maxsplit=1)
        rel = rel.lstrip("*").removeprefix("./")
        if sha(show("origin/main", f"{root}/{rel}")) != digest:
            bad += 1
            print(f"   MISMATCH {label}: {rel}")
    print(f"   {len(lines) - bad}/{len(lines)} {label} entries verify against origin/main")
    return bad


def main():
    failures = 0
    frozen = json.loads(show("origin/main", f"{REREVIEW}/submitted-hashes.json"))
    assert frozen["base"] == BASE
    files = frozen["files"]
    good = 0
    for path, digest in files.items():
        source = f"{REREVIEW}/submitted-documents/{path}" if path in TRACKING else path
        if sha(show("origin/main", source)) == digest:
            good += 1
        else:
            failures += 1
            print(f"   MISMATCH {path}")
    print(f"1. frozen correction-submission paths: {good}/{len(files)} (124 direct, 3 tracking documents via snapshots)")
    print("2. manifests")
    failures += check_sums(show("origin/main", f"{CORR}/SHA256SUMS"), CORR, "corrections-pack")
    failures += check_sums(show("origin/main", f"{CORR}/scope-pack-SHA256SUMS"), PACK, "scope-pack")
    docs = json.loads(show("origin/main", f"{CORR}/document-hashes.json"))
    doc_good = sum(sha(show("origin/main", f"{REREVIEW}/submitted-documents/{d}" if d in TRACKING else d)) == h for d, h in docs.items())
    failures += len(docs) - doc_good
    print(f"3. document hashes: {doc_good}/{len(docs)}")
    anchors = json.loads((REPO / PACK / "base-anchors.json").read_text())["files"]
    good = 0
    for path, entry in anchors.items():
        expected = entry if isinstance(entry, str) else entry["sha256"]
        if sha((REPO / path).read_bytes()) == expected == sha(show(BASE, path)) == sha(show("origin/main", path)):
            good += 1
        else:
            failures += 1
            print(f"   MISMATCH {path}")
    print(f"4. production anchors: {good}/{len(anchors)} identical in the worktree, at {BASE[:7]} and on origin/main")
    print("5. frozen paths changed by the remaining corrections in this worktree:")
    for path, digest in files.items():
        if sha((REPO / path).read_bytes()) != digest:
            print(f"   corrected  {path}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
