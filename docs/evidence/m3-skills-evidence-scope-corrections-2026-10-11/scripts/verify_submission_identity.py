#!/usr/bin/env python3
"""Verify the frozen M3 submission identity and the production anchors.

  python3 -I docs/evidence/m3-skills-evidence-scope-corrections-2026-10-11/scripts/verify_submission_identity.py

Checks, reading git objects only (nothing is written):
1. The review's 57 frozen submitted hashes (submitted-hashes.json on
   origin/main) against the submitted bytes published on origin/main: the 54
   unchanged paths directly, ROADMAP/STATUS/handoff through the review's
   submitted-documents snapshots, and the two top-level documents both
   directly and through their snapshots.
2. The submission's original 51-entry SHA256SUMS, entry by entry, against
   the published submitted pack.
3. The 30 production/base anchors: worktree == base 48fa47d == origin/main.
4. Which of the 57 submitted paths the corrections changed in this worktree
   (expected: corrected prototype/test/fixture/native/doc files only).
"""
import hashlib
import json
import pathlib
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[4]
BASE = "48fa47d9d035b2636b72fd6692930d85f4992bb9"
REVIEW = "docs/evidence/m3-skills-evidence-scope-review-2026-10-10"
PACK = "docs/evidence/m3-skills-evidence-scope-2026-10-10"
SNAPSHOT = {
    "ROADMAP.md": f"{REVIEW}/submitted-documents/ROADMAP.md",
    "STATUS.md": f"{REVIEW}/submitted-documents/STATUS.md",
    "docs/PROJECT_HANDOFF.md": f"{REVIEW}/submitted-documents/docs/PROJECT_HANDOFF.md",
    "docs/M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md": f"{REVIEW}/submitted-documents/docs/M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md",
    "docs/M3_SKILLS_EVIDENCE_IMPLEMENTATION_PROMPT_2026-10-10.md": f"{REVIEW}/submitted-documents/docs/M3_SKILLS_EVIDENCE_IMPLEMENTATION_PROMPT_2026-10-10.md",
}


def show(rev, path):
    out = subprocess.run(["git", "show", f"{rev}:{path}"], cwd=REPO, capture_output=True)
    return out.stdout if out.returncode == 0 else None


def sha(data):
    return hashlib.sha256(data).hexdigest() if data is not None else None


def main():
    failures = 0
    frozen = json.loads(show("origin/main", f"{REVIEW}/submitted-hashes.json"))
    assert frozen["base"] == BASE
    files = frozen["files"]
    print(f"1. frozen submitted paths: {len(files)}")
    ok = 0
    for path, expected in files.items():
        direct = sha(show("origin/main", path))
        snap = sha(show("origin/main", SNAPSHOT[path])) if path in SNAPSHOT else None
        if path in ("ROADMAP.md", "STATUS.md", "docs/PROJECT_HANDOFF.md"):
            good = snap == expected  # the published copies prepend the review entry
        elif path in SNAPSHOT:
            good = direct == expected and snap == expected
        else:
            good = direct == expected
        ok += good
        if not good:
            failures += 1
            print(f"   MISMATCH {path}")
    print(f"   {ok}/{len(files)} match the published submission (54 direct, 3 tracking documents via snapshots, 2 documents both ways)")

    sums = show("origin/main", f"{PACK}/SHA256SUMS").decode().splitlines()
    print(f"2. original SHA256SUMS entries: {len(sums)}; file hash {sha(show('origin/main', f'{PACK}/SHA256SUMS'))}")
    good = 0
    for line in sums:
        digest, rel = line.split(maxsplit=1)
        rel = rel.lstrip("*").removeprefix("./")
        if sha(show("origin/main", f"{PACK}/{rel}")) == digest:
            good += 1
        else:
            failures += 1
            print(f"   MISMATCH {rel}")
    worktree_sums = (REPO / PACK / "SHA256SUMS").read_bytes()
    print(f"   {good}/{len(sums)} entries verify against the published submitted pack")
    print(f"   worktree SHA256SUMS preserved byte-for-byte: {sha(worktree_sums) == files[f'{PACK}/SHA256SUMS']}")
    failures += sha(worktree_sums) != files[f"{PACK}/SHA256SUMS"]

    anchors = json.loads((REPO / PACK / "base-anchors.json").read_text())["files"]
    print(f"3. production/base anchors: {len(anchors)}")
    good = 0
    for path, entry in anchors.items():
        expected = entry if isinstance(entry, str) else entry["sha256"]
        here = sha((REPO / path).read_bytes())
        if here == expected == sha(show(BASE, path)) == sha(show("origin/main", path)):
            good += 1
        else:
            failures += 1
            print(f"   MISMATCH {path}")
    print(f"   {good}/{len(anchors)} identical in the worktree, at {BASE[:7]} and on origin/main")

    print("4. submitted paths changed by the corrections in this worktree:")
    for path, expected in files.items():
        here = sha((REPO / path).read_bytes()) if (REPO / path).exists() else None
        if here != expected:
            print(f"   corrected  {path}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
