#!/usr/bin/env python3
"""Write the remaining-corrections manifests (reads the interrupted checkpoint
from origin/main; writes only into this pack):

  python3 -I docs/evidence/m3-skills-evidence-scope-remaining-corrections-2026-10-11/scripts/write_manifests.py

- scope-pack-SHA256SUMS: every current file of the scope pack (relative to it);
- changes-from-checkpoint.json: the 145 checkpoint paths (checkpoint vs current
  SHA-256, status) and every file added since;
- document-hashes.json: the corrected top-level documents;
- SHA256SUMS: every file of this pack except itself (written last).
"""
import hashlib
import json
import pathlib
import subprocess

REPO = pathlib.Path(__file__).resolve().parents[4]
HERE = REPO / "docs/evidence/m3-skills-evidence-scope-remaining-corrections-2026-10-11"
PACK = REPO / "docs/evidence/m3-skills-evidence-scope-2026-10-10"
CHECKPOINT = "docs/evidence/m3-skills-evidence-interrupted-completion-review-2026-10-11/interrupted-submission-hashes.json"
DOCS = [
    "docs/M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md",
    "docs/M3_SKILLS_EVIDENCE_IMPLEMENTATION_PROMPT_2026-10-10.md",
    "docs/M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_REPORT_2026-10-11.md",
    "docs/M3_SKILLS_EVIDENCE_SCOPE_REMAINING_CORRECTIONS_REPORT_2026-10-11.md",
    "ROADMAP.md",
    "STATUS.md",
    "docs/PROJECT_HANDOFF.md",
]
MANIFESTS = ("SHA256SUMS", "scope-pack-SHA256SUMS", "changes-from-checkpoint.json", "document-hashes.json")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def files_under(root, skip=()):
    return sorted(p for p in root.rglob("*") if p.is_file() and p.name not in skip and "target" not in p.relative_to(root).parts)


def sums(root, skip=()):
    return "".join(f"{sha(p)}  ./{p.relative_to(root).as_posix()}\n" for p in files_under(root, skip))


def main():
    (HERE / "scope-pack-SHA256SUMS").write_text(sums(PACK))
    raw = json.loads(subprocess.run(["git", "show", f"origin/main:{CHECKPOINT}"], cwd=REPO, capture_output=True, check=True).stdout)
    checkpoint = raw.get("files", raw)
    changes = {"checkpoint": CHECKPOINT, "paths": {}, "added": {}}
    for path, digest in sorted(checkpoint.items()):
        target = REPO / path
        current = sha(target) if target.exists() else None
        changes["paths"][path] = {"checkpoint": digest, "current": current, "status": "unchanged" if current == digest else "changed"}
    for root in (PACK, HERE):
        for p in files_under(root):
            rel = p.relative_to(REPO).as_posix()
            if rel not in checkpoint and not (root == HERE and p.name in MANIFESTS):
                changes["added"][rel] = sha(p)
    for doc in DOCS:
        if doc not in checkpoint:
            changes["added"][doc] = sha(REPO / doc)
    (HERE / "changes-from-checkpoint.json").write_text(json.dumps(changes, indent=2) + "\n")
    (HERE / "document-hashes.json").write_text(json.dumps({d: sha(REPO / d) for d in DOCS}, indent=2) + "\n")
    (HERE / "SHA256SUMS").write_text(sums(HERE, skip=("SHA256SUMS",)))
    print("manifests written")


if __name__ == "__main__":
    main()
