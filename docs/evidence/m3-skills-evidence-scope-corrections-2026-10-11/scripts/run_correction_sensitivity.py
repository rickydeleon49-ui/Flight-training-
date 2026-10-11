#!/usr/bin/env python3
"""Targeted reversions for the M3-R1-R7 corrections. Each removes one decisive
guard on an isolated scratch copy and must make its named test fail. The
original S1-S8 reversions (read unchanged from the original pack's
run_sensitivity.py) are re-run on the corrected code first, so the S4a
"masked by ConnectionOwner" explanation is rechecked. The worktree is never
edited.

  python3 -I docs/evidence/m3-skills-evidence-scope-corrections-2026-10-11/scripts/run_correction_sensitivity.py <scratch-dir>

Writes receipts/sensitivity/<id>.txt (command, cwd, output, exit, restored
hash) and receipts/sensitivity/summary.json in the corrections pack.
"""
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[4]
PACK_REL = "docs/evidence/m3-skills-evidence-scope-2026-10-10"
PACK = REPO / PACK_REL
OUT = REPO / "docs/evidence/m3-skills-evidence-scope-corrections-2026-10-11/receipts/sensitivity"
NODE_BIN = "/opt/homebrew/opt/node@22/bin"
CARGO_BIN = "/opt/homebrew/opt/rustup/bin"

# Load the original variant list without writing bytecode into the original pack.
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("original_sensitivity", PACK / "scripts" / "run_sensitivity.py")
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)

CTRL = "prototype/evidenceController.ts"
READER = "prototype/skillEvidenceReader.ts"
VALID = "prototype/skillEvidenceValidation.ts"
RESULT = "prototype/skillEvidenceResult.ts"
TX = "prototype/skillEvidenceTransaction.ts"
UI = "prototype/SkillEvidenceSpecimen.tsx"
NATIVE = "native/src/lib.rs"
CC = "tests/corrections-controller.test.ts"
CR = "tests/corrections-reader.test.ts"
CU = "tests/corrections-ui.test.tsx"
CONTRACT = "tests/contract.test.ts"

# (id, finding, what is reverted, file, find, replace, test file or "cargo", test name)
VARIANTS = [
    ("C1", "M3-R1", "an acknowledged save forgets its draft identity", CTRL,
     "    record.saved = { fingerprint: pending.fingerprint, revision: result.revision };\n",
     "    record.saved = null;\n",
     CC, "[M3-R1a] an acknowledged save keeps its draft identity while its refresh is held"),
    ("C2", "M3-R1", "write notices and refreshes publish on whichever skill is shown", CTRL,
     "const owns = (record: DraftRecord) => active && record.lifetime === lifetime && state.skillId === record.skillId;",
     "const owns = (record: DraftRecord) => active && record.lifetime === lifetime;",
     CC, "[M3-R1b] a late A acknowledgment cannot clear B's saving lock"),
    ("C3", "M3-R1", "one saving lock for every skill", CTRL,
     "d.flight !== null && d.lifetime === lifetime && d.skillId === skillId);",
     "d.flight !== null && d.lifetime === lifetime);",
     CC, "[M3-R1b] A -> B -> A"),
    ("C4", "M3-R1", "a first-page generation change keeps the older-page lock", CTRL,
     "    generation += 1;\n    publish({ loadingMore: false });\n",
     "    generation += 1;\n",
     CC, "[M3-R1c] a refresh that supersedes a held older page releases its lock"),
    ("C5", "M3-R2", "an empty history read is taken as proof the earlier save failed", CTRL,
     "        present = false;\n      }\n",
     "        present = false;\n      }\n      if (!present) {\n        record.pending = null;\n        return { kind: \"refused\", code: \"NOT_FOUND\", message: \"earlier save absent\" };\n      }\n",
     CC, "[M3-R2b] empty history is not proof"),
    ("C6", "M3-R2", "an erased earlier save is not recognised", CTRL,
     "        if (code === \"ERASED\") {\n          record.pending = null;",
     "        if (code === \"ERASED_IGNORED\") {\n          record.pending = null;",
     CC, "[M3-R2a] a changed draft after an unknown outcome and an erase cannot recreate the erased save"),
    ("C7", "M3-R2", "the form clears its wording when an earlier save is found", UI,
     "    } else if (outcome.kind === \"earlier_saved\") {\n      setFollowUp({ kind: \"earlier\" });",
     "    } else if (outcome.kind === \"earlier_saved\") {\n      setWording(\"\");\n      setFollowUp({ kind: \"earlier\" });",
     CU, "[M3-R2c] discovering an earlier save keeps the newly edited unsaved wording"),
    ("C8", "M3-R3", "the lifecycle effect only cleans up (no symmetric setup)", UI,
     "    controller.activate();\n    return () => controller.deactivate();",
     "    return () => controller.deactivate();",
     CU, "[M3-R3] under real StrictMode the live replay generation finishes loading"),
    ("C9", "M3-R4", "history pages offer no way to older revisions", READER,
     "    nextCursor: rows.length > limit && last ? encodeHistoryCursor(input.observationId, Number(last[\"revision\"])) : null,",
     "    nextCursor: null,",
     CR, "[M3-R4] the earliest wording is reachable through bounded pages after 100 later revisions"),
    ("C10", "M3-R4", "a history cursor is accepted for another observation", READER,
     "  if (id !== observationId) throw new SkillEvidenceError(\"INVALID_ARGUMENT\", \"That history link belongs to a different observation.\");\n",
     "",
     CR, "[M3-R4] a history cursor is bound to its observation and validated"),
    ("C11", "M3-R5", "TS: the result subject is not bound to the receipt", RESULT,
     "    if (record[\"observationId\"] !== expected.subjectId) fail(\"The result names a different observation.\");\n    const revision",
     "    const revision",
     CONTRACT, "node:sqlite gives the listed outcome for every case"),
    ("C12", "M3-R5", "TS: a receipt may name history another operation wrote", VALID,
     "      if (!row || row[\"operation_id\"] !== id) refuse(`Operation ${id} does not own the observation history it names.`);",
     "      if (!row) refuse(`Operation ${id} does not own the observation history it names.`);",
     CONTRACT, "sql.js gives the listed outcome for every case"),
    ("C13", "M3-R5", "replay trusts the stored result without decoding it", TX,
     "        result = decodeStoredResult(receipt[\"result_json\"], { action: action.action, subjectId });",
     "        result = JSON.parse(String(receipt[\"result_json\"])) as SkillEvidenceResult;",
     CR, "[M3-R5] replaying a receipt whose result names another observation is STORAGE_FAILURE"),
    ("C14", "M3-R6", "TS: built-in wording is no longer pinned after revision 1", VALID,
     "      if (ref && pinned.some((k) => str(h[k]) !== str(ref[k]))) refuse(`Built-in skill ${id} changed its catalog wording.`);\n",
     "",
     CONTRACT, "node:sqlite gives the listed outcome for every case"),
    ("C15", "M3-R6", "TS: active names compared raw, not by labelKey", VALID,
     "      const key = labelKey(String(skill[\"label\"]));",
     "      const key = String(skill[\"label\"]);",
     CONTRACT, "sql.js gives the listed outcome for every case"),
    ("C16", "M3-R7", "next pages skip the stale-cursor check", READER,
     "  if (input.cursor) await assertCursorFresh(query, decodeCursor(input.cursor));\n",
     "",
     CR, "[M3-R7] a seen observation moved below the cursor is refused as STALE_CURSOR"),
    ("C17", "M3-R7", "a cursor is accepted with other filters", READER,
     "    if (!sameFilters(c.filters, filters)) {",
     "    if (false && !sameFilters(c.filters, filters)) {",
     CR, "[M3-R7] a cursor is bound to its normalized filters and validated"),
    ("C18", "M3-R7", "the controller appends after a stale cursor instead of restarting", CTRL,
     "        if (code === \"STALE_CURSOR\" || code === \"INVALID_ARGUMENT\") {",
     "        if (false) {",
     CR, "[M3-R7] Show older after a crossing edit restarts the list from the newest"),
    ("N1", "M3-R5", "native: the result subject is not bound to the receipt", NATIVE,
     "    if object.get(subject_key).and_then(|s| s.as_str()) != Some(subject) {",
     "    if false && object.get(subject_key).and_then(|s| s.as_str()) != Some(subject) {",
     "cargo", "shared_validation_contract_native_outcomes"),
    ("N2", "M3-R5", "native: a receipt may name history another operation wrote", NATIVE,
     "            let Some(row) = row.first().filter(|r| text(get(r, \"operation_id\")).as_deref() == Some(id.as_str())) else {",
     "            let Some(row) = row.first() else {",
     "cargo", "shared_validation_contract_native_outcomes"),
    ("N3", "M3-R6", "native: built-in wording is no longer pinned", NATIVE,
     "            if let Some(r) = reference_row.filter(|_| builtin) {",
     "            if let Some(r) = reference_row.filter(|_| false) {",
     "cargo", "shared_validation_contract_native_outcomes"),
    ("N4", "M3-R6", "native: labelKey without NFC", NATIVE,
     "    let nfc: String = label.nfc().collect();",
     "    let nfc: String = label.to_string();",
     "cargo", "shared_validation_contract_native_outcomes"),
    ("N5", "M3-R6", "native: labelKey uses Rust's whitespace set instead of JavaScript's", NATIVE,
     "    for c in nfc.trim_matches(is_js_space).chars() {\n        if is_js_space(c) {",
     "    for c in nfc.trim_matches(char::is_whitespace).chars() {\n        if c.is_whitespace() {",
     "cargo", "shared_validation_contract_native_outcomes"),
]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def copy_tree(scratch):
    if scratch.exists():
        shutil.rmtree(scratch)
    # copytree keeps source mtimes, so a reused cargo target could look newer
    # than the copied sources and serve a previous run's build: start clean.
    shutil.rmtree(scratch.parent / "sensitivity-target", ignore_errors=True)
    scratch.mkdir(parents=True)
    for rel in ["package.json", "tsconfig.json"]:
        shutil.copy2(REPO / rel, scratch / rel)
    shutil.copytree(REPO / "src", scratch / "src")
    shutil.copytree(REPO / "src-tauri" / "migrations", scratch / "src-tauri" / "migrations")
    pack = scratch / PACK_REL
    pack.mkdir(parents=True)
    for rel in ["prototype", "tests", "fixtures", "candidate"]:
        shutil.copytree(PACK / rel, pack / rel)
    shutil.copytree(PACK / "native", pack / "native", ignore=shutil.ignore_patterns("target"))
    shutil.copy2(PACK / "vitest.config.ts", pack / "vitest.config.ts")
    os.symlink(os.path.realpath(REPO / "node_modules"), scratch / "node_modules")


def js_regex_literal(text):
    """Vitest's -t is a regular expression: match the name literally."""
    return re.sub(r"([\\^$.|?*+()\[\]{}])", r"\\\1", text)


def run_named(scratch, test_file, name):
    if test_file == "cargo":
        cmd = ["cargo", "test", "--offline", "--locked", "--manifest-path", f"{PACK_REL}/native/Cargo.toml", "--test", "contract", name]
        env = dict(os.environ, PATH=f"{CARGO_BIN}:/opt/homebrew/bin:/usr/bin:/bin", CARGO_TARGET_DIR=str(scratch.parent / "sensitivity-target"))
        sdk = subprocess.run(["xcrun", "--sdk", "macosx", "--show-sdk-path"], capture_output=True, text=True).stdout.strip()
        if sdk:
            env["SDKROOT"] = sdk
    else:
        cmd = ["node", "node_modules/vitest/vitest.mjs", "run", "--config", f"{PACK_REL}/vitest.config.ts", f"{PACK_REL}/{test_file}", "-t", js_regex_literal(name), "--reporter=verbose"]
        env = dict(os.environ, PATH=f"{NODE_BIN}:{os.environ.get('PATH', '')}")
    proc = subprocess.run(cmd, cwd=scratch, env=env, capture_output=True, text=True, timeout=900)
    return cmd, proc


def ran_tests(test_file, proc):
    """The named test actually ran (a filter that matches nothing must not count as a pass)."""
    if test_file == "cargo":
        return "running 1 test" in proc.stdout
    return re.search(r"Tests\s+\d+ passed", proc.stdout) is not None


def failed(test_file, proc):
    if test_file == "cargo":
        return proc.returncode != 0 and "FAILED" in proc.stdout
    return proc.returncode != 0 and ("FAIL" in proc.stdout or "×" in proc.stdout)


def main():
    scratch = pathlib.Path(sys.argv[1]).resolve()
    OUT.mkdir(parents=True, exist_ok=True)
    copy_tree(scratch)
    originals = [(vid, "original", desc, rel, find, replace, f"tests/{tf.split('/')[-1]}", name, *rest)
                 for vid, desc, rel, find, replace, tf, name, *rest in original.VARIANTS]
    every = originals + [(*v, "caught") for v in VARIANTS]
    summary = []
    # Control: the unmodified copy passes every named test, and each filter selects a test.
    for vid, _, _, _, _, _, test_file, name, *_ in every:
        cmd, proc = run_named(scratch, test_file, name)
        if proc.returncode != 0 or not ran_tests(test_file, proc):
            print(f"CONTROL FAILED for {vid}: {name}\n{proc.stdout[-3000:]}{proc.stderr[-3000:]}")
            return 2
    summary.append({"control": f"all {len(every)} named tests pass on the unmodified corrected copy"})
    for vid, finding, description, rel, find, replace, test_file, name, *rest in every:
        expected = rest[0] if rest else "caught"
        target = scratch / PACK_REL / rel
        original_bytes = target.read_bytes()
        before = sha(target)
        text = original_bytes.decode()
        if text.count(find) != 1:
            print(f"{vid}: reversion pattern must match exactly once in {rel}")
            return 2
        target.write_text(text.replace(find, replace))
        try:
            cmd, proc = run_named(scratch, test_file, name)
        finally:
            target.write_bytes(original_bytes)
        restored = sha(target) == before
        caught = failed(test_file, proc)
        (OUT / f"{vid}.txt").write_text(
            f"$ {' '.join(cmd)}\n# cwd: <scratch copy>\n# variant: {vid} ({finding}) {description}\n# file: {rel}\n"
            f"{proc.stdout[-20000:]}{proc.stderr[-6000:]}\n# exit={proc.returncode}\n# restored-sha-matches={restored}\n"
        )
        as_expected = caught if expected == "caught" else not caught
        summary.append({"id": vid, "finding": finding, "reverts": description, "file": rel, "test": name, "exit": proc.returncode,
                        "caught": caught, "expected": expected, "asExpected": as_expected, "restored": restored})
        print(f"{vid}: {'CAUGHT' if caught else 'NOT CAUGHT'} (exit {proc.returncode}, expected {expected}) by '{name}'; restored={restored}")
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    shutil.rmtree(scratch)
    return 0 if all(s.get("asExpected", True) and s.get("restored", True) for s in summary) else 1


if __name__ == "__main__":
    sys.exit(main())
