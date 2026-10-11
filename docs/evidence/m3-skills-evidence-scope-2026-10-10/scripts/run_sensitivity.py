#!/usr/bin/env python3
"""Targeted reversions: each removes one protection and must make its named
test fail. Runs on an isolated scratch copy; the worktree is never edited.

  python3 -I docs/evidence/m3-skills-evidence-scope-2026-10-10/scripts/run_sensitivity.py <scratch-dir>

Writes receipts/sensitivity/<id>.txt (command, cwd, output, exit) and
receipts/sensitivity/summary.json.
"""
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[4]
PACK_REL = "docs/evidence/m3-skills-evidence-scope-2026-10-10"
PACK = REPO / PACK_REL
OUT = PACK / "receipts" / "sensitivity"
NODE_BIN = "/opt/homebrew/opt/node@22/bin"

VARIANTS = [
    ("S1", "idempotency: same id, different content is no longer refused", "prototype/skillEvidenceTransaction.ts",
     '      if (receipt["request_hash"] !== requestHash) refuse("OPERATION_CONFLICT", "That request id was already used for a different change.");\n', "",
     "tests/writes.test.ts", "the same request id with different content is refused"),
    ("S2", "retention: erasing no longer tombstones earlier receipts", "prototype/skillEvidenceTransaction.ts",
     '"UPDATE skill_evidence_operations SET is_erased = 1, result_json = NULL WHERE subject_id = ? AND is_erased = 0"',
     '"SELECT ? AS unused"', "tests/writes.test.ts", "an old retry cannot resurrect an erased observation"),
    ("S3", "attribution: a verified-instructor value is accepted at the boundary", "prototype/skillEvidenceTransaction.ts",
     'const ATTRIBUTIONS: ReadonlySet<string> = new Set(["self_report", "instructor_transcribed"]);',
     'const ATTRIBUTIONS: ReadonlySet<string> = new Set(["self_report", "instructor_transcribed", "instructor_verified"]);',
     "tests/writes.test.ts", "there is no verified-instructor attribution"),
    ("S4a", "transaction: only the transaction's own ROLLBACK is removed (expected MASKED: the production ConnectionOwner's rollbackIfOpen still rolls back)", "prototype/skillEvidenceTransaction.ts",
     '      await exec("ROLLBACK");\n    } catch {\n      // The original error is the one worth reporting.\n    }\n    if (error instanceof SkillEvidenceError) throw error;',
     '      void 0;\n    } catch {\n      // The original error is the one worth reporting.\n    }\n    if (error instanceof SkillEvidenceError) throw error;',
     "tests/writes.test.ts", "leaves no partial change", "masked"),
    ("S4b", "transaction: transaction control is removed, so each statement autocommits", "prototype/skillEvidenceTransaction.ts",
     '  await exec("BEGIN IMMEDIATE");\n  try {\n    // 0. Replay, conflict or erased.',
     '  exec = () => undefined;\n  await exec("BEGIN IMMEDIATE");\n  try {\n    // 0. Replay, conflict or erased.',
     "tests/writes.test.ts", "leaves no partial change"),
    ("S5", "history: an edit no longer appends a revision", "prototype/skillEvidenceTransaction.ts",
     "      await appendObservationRevision(run, action.observationId, revision, kind, next, action.operationId, timestamp);\n",
     "      if (kind !== \"edited\") await appendObservationRevision(run, action.observationId, revision, kind, next, action.operationId, timestamp);\n",
     "tests/writes.test.ts", "editing wording, date and attribution keeps every earlier version"),
    ("S6", "restore: the validator stops checking append-only triggers", "prototype/skillEvidenceValidation.ts",
     "  for (const trigger of M3_TRIGGERS) {\n", "  for (const trigger of [] as string[]) {\n",
     "tests/contract.test.ts", "node:sqlite gives the listed outcome for every case"),
    ("S7", "schema: the observation-history update guard is dropped", "candidate/0014_skills_evidence.sql",
     "CREATE TRIGGER IF NOT EXISTS trg_skill_observation_revisions_no_update\nBEFORE UPDATE ON skill_observation_revisions\nBEGIN\n  SELECT RAISE(ABORT, 'observation history is append-only');\nEND;\n",
     "", "tests/writes.test.ts", "history rows cannot be rewritten"),
    ("S8", "publication: a late answer for an obsolete request is published", "prototype/evidenceController.ts",
     "      if (mine !== generation) return;\n      publish({ status: \"ready\", items: page.items, nextCursor: page.nextCursor, summary, readError: null });",
     "      publish({ status: \"ready\", items: page.items, nextCursor: page.nextCursor, summary, readError: null });",
     "tests/controller.test.ts", "A -> B -> A publishes only the last A answer"),
]


def sha(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def copy_tree(scratch: pathlib.Path) -> None:
    if scratch.exists():
        shutil.rmtree(scratch)
    scratch.mkdir(parents=True)
    for rel in ["package.json", "tsconfig.json"]:
        shutil.copy2(REPO / rel, scratch / rel)
    shutil.copytree(REPO / "src", scratch / "src")
    shutil.copytree(REPO / "src-tauri" / "migrations", scratch / "src-tauri" / "migrations")
    pack = scratch / PACK_REL
    pack.mkdir(parents=True)
    for rel in ["prototype", "tests", "fixtures", "candidate"]:
        shutil.copytree(PACK / rel, pack / rel)
    shutil.copy2(PACK / "vitest.config.ts", pack / "vitest.config.ts")
    os.symlink(os.path.realpath(REPO / "node_modules"), scratch / "node_modules")


def run_named(scratch: pathlib.Path, test_file: str, name: str):
    cmd = ["npx", "vitest", "run", "--config", f"{PACK_REL}/vitest.config.ts", test_file, "-t", name, "--reporter=verbose"]
    env = dict(os.environ, PATH=f"{NODE_BIN}:{os.environ.get('PATH', '')}")
    proc = subprocess.run(cmd, cwd=scratch, env=env, capture_output=True, text=True, timeout=600)
    return cmd, proc


def main() -> int:
    scratch = pathlib.Path(sys.argv[1]).resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    copy_tree(scratch)
    summary = []
    # Control: unmodified copy passes every named test.
    for vid, _, _, _, _, test_file, name, *_ in VARIANTS:
        cmd, proc = run_named(scratch, test_file, name)
        if proc.returncode != 0:
            print(f"CONTROL FAILED for {vid}: {name}\n{proc.stdout[-2000:]}{proc.stderr[-2000:]}")
            return 2
    summary.append({"control": "all named tests pass on the unmodified copy"})
    for vid, description, rel, find, replace, test_file, name, *rest in VARIANTS:
        expected = rest[0] if rest else "caught"
        target = scratch / PACK_REL / rel
        original = target.read_bytes()
        before = sha(target)
        text = original.decode()
        if text.count(find) != 1:
            print(f"{vid}: reversion pattern must match exactly once in {rel}")
            return 2
        target.write_text(text.replace(find, replace))
        try:
            cmd, proc = run_named(scratch, test_file, name)
        finally:
            target.write_bytes(original)
        restored = sha(target) == before
        caught = proc.returncode != 0 and ("FAIL" in proc.stdout or "×" in proc.stdout)
        (OUT / f"{vid}.txt").write_text(
            f"$ {' '.join(cmd)}\n# cwd: <scratch copy>\n# variant: {vid} {description}\n# file: {rel}\n"
            f"{proc.stdout}{proc.stderr}\n# exit={proc.returncode}\n# restored-sha-matches={restored}\n"
        )
        as_expected = caught if expected == "caught" else not caught
        summary.append({"id": vid, "reverts": description, "file": rel, "test": name, "exit": proc.returncode, "caught": caught, "expected": expected, "asExpected": as_expected, "restored": restored})
        print(f"{vid}: {'CAUGHT' if caught else 'NOT CAUGHT'} (exit {proc.returncode}, expected {expected}) by '{name}'; restored={restored}")
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    shutil.rmtree(scratch)
    return 0 if all(s.get("asExpected", True) and s.get("restored", True) for s in summary) else 1


if __name__ == "__main__":
    sys.exit(main())
