#!/usr/bin/env python3
"""Write the corrections manifests (run from anywhere; reads git objects for
the submitted hashes):

  python3 -I docs/evidence/m3-skills-evidence-scope-corrections-2026-10-11/scripts/write_manifests.py

- scope-pack-SHA256SUMS: every current file of the scope pack (relative to it);
- changes-from-submission.json: the 57 submitted paths (submitted vs current
  SHA-256, status) and every file added since;
- document-hashes.json: the corrected top-level documents;
- SHA256SUMS: every file of this corrections pack except itself (written last).
"""
import hashlib
import json
import pathlib
import subprocess

REPO = pathlib.Path(__file__).resolve().parents[4]
HERE = REPO / "docs/evidence/m3-skills-evidence-scope-corrections-2026-10-11"
PACK = REPO / "docs/evidence/m3-skills-evidence-scope-2026-10-10"
REVIEW = "docs/evidence/m3-skills-evidence-scope-review-2026-10-10"
DOCS = [
    "docs/M3_SKILLS_EVIDENCE_SCOPE_2026-10-10.md",
    "docs/M3_SKILLS_EVIDENCE_IMPLEMENTATION_PROMPT_2026-10-10.md",
    "docs/M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_REPORT_2026-10-11.md",
    "ROADMAP.md",
    "STATUS.md",
    "docs/PROJECT_HANDOFF.md",
]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def files_under(root, skip=()):
    return sorted(p for p in root.rglob("*") if p.is_file() and p.name not in skip and "target" not in p.relative_to(root).parts)


def sums(root, skip=()):
    return "".join(f"{sha(p)}  ./{p.relative_to(root).as_posix()}\n" for p in files_under(root, skip))


def main():
    (HERE / "scope-pack-SHA256SUMS").write_text(sums(PACK))
    submitted = json.loads(subprocess.run(["git", "show", f"origin/main:{REVIEW}/submitted-hashes.json"], cwd=REPO, capture_output=True, check=True).stdout)
    changes = {"base": submitted["base"], "submitted": {}, "added": {}}
    for path, digest in sorted(submitted["files"].items()):
        current = sha(REPO / path)
        status = "unchanged" if current == digest else "corrected"
        if path in ("ROADMAP.md", "STATUS.md", "docs/PROJECT_HANDOFF.md"):
            status = "history prepended (review entry, then correction entry)"
        changes["submitted"][path] = {"submitted": digest, "current": current, "status": status}
    known = set(submitted["files"])
    manifests = {HERE / n for n in ("SHA256SUMS", "scope-pack-SHA256SUMS", "changes-from-submission.json", "document-hashes.json")}
    for root in (PACK, HERE):
        for p in files_under(root):
            rel = p.relative_to(REPO).as_posix()
            if rel not in known and p not in manifests:
                changes["added"][rel] = sha(p)
    changes["added"]["docs/M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_REPORT_2026-10-11.md"] = sha(REPO / DOCS[2])
    (HERE / "changes-from-submission.json").write_text(json.dumps(changes, indent=2, ensure_ascii=False) + "\n")
    (HERE / "document-hashes.json").write_text(json.dumps({d: sha(REPO / d) for d in DOCS}, indent=2) + "\n")
    (HERE / "SHA256SUMS").write_text(sums(HERE, skip=("SHA256SUMS",)))
    print("manifests written")


if __name__ == "__main__":
    main()
