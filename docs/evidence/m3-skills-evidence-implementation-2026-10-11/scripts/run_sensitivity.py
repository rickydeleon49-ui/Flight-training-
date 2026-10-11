#!/usr/bin/env python3
"""Targeted reversions for the M3 production slice, each on an isolated copy.

  python3 -I docs/evidence/m3-skills-evidence-implementation-2026-10-11/scripts/run_sensitivity.py <scratch-dir>

1. Copies every tracked and untracked (non-ignored) file of this worktree into
   <scratch-dir>/tree; node_modules is a symlink to this worktree's, and native
   builds use <scratch-dir>/target. Nothing in the worktree is modified.
2. Runs each named test unmodified (control): it must pass.
3. For each variant: replaces one exact snippet (it must occur exactly once),
   runs the named test (it must fail, and the output must name it as failed),
   restores the file and checks its SHA-256 equals the original.

Writes sensitivity/<id>.txt for each variant and sensitivity/summary.json.
Node 22 (the CI version) runs the TypeScript tests: NODE22_BIN names its bin
directory (default /opt/homebrew/opt/node@22/bin).
"""
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[4]
PACK = REPO / "docs/evidence/m3-skills-evidence-implementation-2026-10-11"
OUT = PACK / "sensitivity"
NODE22 = os.environ.get("NODE22_BIN", "/opt/homebrew/opt/node@22/bin")
RUST = str(pathlib.Path.home() / ".rustup/toolchains/stable-aarch64-apple-darwin/bin")

TX = "src/data/skillEvidenceTransaction.ts"
RES = "src/data/skillEvidenceResult.ts"
RD = "src/data/skillEvidenceReader.ts"
VAL = "src/data/practiceStateValidation.ts"
CTL = "src/state/useSkillEvidence.ts"
NR = "src-tauri/src/skill_evidence.rs"
NB = "src-tauri/src/backup.rs"

OPS = ("src/data/skillEvidenceOperations.test.ts", "node:sqlite gives every listed outcome, row count and check")
VALS = ("src/data/skillEvidenceValidationParity.test.ts", "node:sqlite gives the listed outcome for every case")
FAULT = ("src/data/skillEvidenceTransaction.test.ts", "a failure after the first writes rolls everything back")
READS = ("src/data/skillEvidenceTransaction.test.ts", "a date edit crossing the cursor restarts the list")
HIST = ("src/data/skillEvidenceTransaction.test.ts", "cursors bind to their observation")
LABEL = ("src/data/skillEvidenceTransaction.test.ts", "labelKey normalizes like the native label_key")
DRAFT = ("src/state/skillEvidence/corrections-controller.test.ts", "[M3-R1a] an acknowledged save keeps its draft identity")
OWNER = ("src/state/skillEvidence/corrections-controller.test.ts", "[M3-R1b] a late A acknowledgment cannot clear B's saving lock")

N_OPS = "shared_operation_contract_native_outcomes"
N_VALS = "shared_validation_contract_native_outcomes"
N_FAULT = "a_failure_after_the_first_writes_rolls_everything_back"
N_LABEL = "label_keys_match_the_typescript_normalization"
N_CURSOR = "stale_cursors_restart_and_cursors_are_bound_to_their_filters"
N_HIST = "every_revision_is_reachable_past_one_hundred_with_no_gap_or_repeat"

# (id, guard, file, old, new, test) where test is (file, name) for vitest or a native test name.
VARIANTS = [
    ("TS-01", "idempotency conflict check", TX,
     'if (receipt["request_hash"] !== requestHash) refuse(',
     'if (false && receipt["request_hash"] !== requestHash) refuse(', OPS),
    ("TS-02", "tombstoning on erase", TX,
     'SET is_erased = 1, result_json = NULL WHERE subject_id = ? AND is_erased = 0"',
     'SET is_erased = 1, result_json = NULL WHERE subject_id = ? AND 0"', OPS),
    ("TS-03", "attribution decoding", TX,
     'const ATTRIBUTIONS: ReadonlySet<string> = new Set(["self_report", "instructor_transcribed"]);',
     'const ATTRIBUTIONS: ReadonlySet<string> = new Set(["self_report", "instructor_transcribed", "verified_instructor"]);', OPS),
    ("TS-04", "transaction control (a failure commits instead of rolling back)", TX,
     '      await exec("ROLLBACK");\n    } catch {\n      // The original error is the one worth reporting.',
     '      await exec("COMMIT");\n    } catch {\n      // The original error is the one worth reporting.', FAULT),
    ("TS-05", "history append on change", TX,
     '      await appendObservationRevision(run, action.observationId, revision, kind, next, action.operationId, timestamp);\n',
     '', OPS),
    ("TS-06", "validator trigger checks", VAL,
     'for (const trigger of SKILL_EVIDENCE_TRIGGERS) {',
     'for (const trigger of SKILL_EVIDENCE_TRIGGERS.slice(0, 0)) {', VALS),
    ("TS-07", "receipt subject binding (replay and validation)", RES,
     '    if (record["observationId"] !== expected.subjectId) fail("The result names a different observation.");\n    const revision',
     '    const revision', OPS),
    ("TS-08", "history -> receipt ownership (M3-R9)", VAL,
     'if (!owned(r["operation_id"], OBSERVATION_HISTORY_ACTIONS, r["observation_id"], r["revision"])) {',
     'if (false && !owned(r["operation_id"], OBSERVATION_HISTORY_ACTIONS, r["observation_id"], r["revision"])) {', VALS),
    ("TS-09", "pinned built-in catalog wording", VAL,
     'if (ref && pinned.some((k) => m3Str(h[k]) !== m3Str(ref[k]))) refuse(',
     'if (false && ref && pinned.some((k) => m3Str(h[k]) !== m3Str(ref[k]))) refuse(', VALS),
    ("TS-10", "labelKey NFC normalization", TX,
     'return label.normalize("NFC").trim().replace(/\\s+/g, " ").toLocaleLowerCase("en-US");',
     'return label.trim().replace(/\\s+/g, " ").toLocaleLowerCase("en-US");', LABEL),
    ("TS-11", "stale-cursor check", RD,
     '    if (after !== "out" && after !== side(old)) staleCursor();',
     '    if (false && after !== "out" && after !== side(old)) staleCursor();', READS),
    ("TS-12", "cursor filter binding", RD,
     'if (!sameFilters(c.filters, filters)) {',
     'if (false && !sameFilters(c.filters, filters)) {', READS),
    ("TS-13", "history-cursor binding", RD,
     'if (id !== observationId) throw new SkillEvidenceError(',
     'if (false && id !== observationId) throw new SkillEvidenceError(', HIST),
    ("TS-14", "draft-identity retention after acknowledgment", CTL,
     '    record.pending = null;\n    return { kind: "stored", revision: result.revision, replayed: outcome.status === "replayed" };',
     '    record.pending = null;\n    for (const [key, value] of drafts) if (value === record) drafts.delete(key);\n'
     '    return { kind: "stored", revision: result.revision, replayed: outcome.status === "replayed" };', DRAFT),
    ("TS-15", "write ownership by list (skill)", CTL,
     'active && record.lifetime === lifetime && state.scope === record.scope;',
     'active && record.lifetime === lifetime;', OWNER),
    ("NA-01", "idempotency conflict check", NR,
     "        if stored_hash != hash {\n            return Err(Code::OperationConflict);\n        }\n",
     "", N_OPS),
    ("NA-02", "tombstoning on erase", NR,
     "SET is_erased = 1, result_json = NULL WHERE subject_id = ?1 AND is_erased = 0\"",
     "SET is_erased = 1, result_json = NULL WHERE subject_id = ?1 AND 0\"", N_OPS),
    ("NA-03", "attribution decoding", NR,
     '        .filter(|a| *a == "self_report" || *a == "instructor_transcribed")\n',
     "", N_OPS),
    ("NA-04", "strict decoding (deny_unknown_fields)", NR,
     '    rename_all_fields = "camelCase",\n    deny_unknown_fields\n)]',
     '    rename_all_fields = "camelCase"\n)]', N_OPS),
    ("NA-05", "transaction control (no immediate transaction)", NR,
     "    let tx = connection\n        .transaction_with_behavior(TransactionBehavior::Immediate)\n        .map_err(storage)?;\n"
     "    let outcome = execute_skill_evidence_transaction(&tx, request, hash)?;\n    tx.commit().map_err(storage)?;\n",
     "    let _ = TransactionBehavior::Immediate;\n    let outcome = execute_skill_evidence_transaction(connection, request, hash)?;\n",
     N_FAULT),
    ("NA-06", "history append on change", NR,
     "            append_observation_revision(tx, observation_id, revision, kind, &next, op, now)?;\n",
     "", N_OPS),
    ("NA-07", "validator trigger checks", NB,
     "    for trigger in SKILL_EVIDENCE_TRIGGERS {\n",
     "    for trigger in SKILL_EVIDENCE_TRIGGERS.iter().take(0) {\n", N_VALS),
    ("NA-08", "receipt subject binding (replay and validation)", NR,
     "    if object.get(subject_key).and_then(Value::as_str) != Some(subject) {\n"
     "        return Err(\"The result names a different subject.\".into());\n    }\n",
     "", N_OPS),
    ("NA-09", "history -> receipt ownership (M3-R9)", NB,
     "        if !owned(\n            m3_get(&r, \"operation_id\"),\n            &OBSERVATION_HISTORY_ACTIONS,\n",
     "        if false\n            && !owned(\n            m3_get(&r, \"operation_id\"),\n            &OBSERVATION_HISTORY_ACTIONS,\n",
     N_VALS),
    ("NA-10", "pinned built-in catalog wording", NB,
     '                    return Err(format!("Built-in skill {id} changed its catalog wording."));\n',
     "                    let _ = &id;\n", N_VALS),
    ("NA-11", "label_key JavaScript whitespace set", NR,
     "    for c in js_trim(&nfc).chars() {\n        if is_js_space(c) {\n",
     "    for c in nfc.trim().chars() {\n        if c.is_whitespace() {\n", N_LABEL),
    ("NA-12", "stale-cursor check", NR,
     '        if after != "out" && after != side(&pair[0]) {\n            return Err(Code::StaleCursor);\n        }\n',
     "", N_CURSOR),
    ("NA-13", "cursor filter binding", NR,
     "            if cursor.filters != filters {\n                return Err(Code::InvalidArgument);\n            }\n",
     "", N_CURSOR),
    ("NA-14", "history-cursor binding", NR,
     "            if items[1].as_str() != Some(observation_id) {\n                return Err(Code::InvalidArgument);\n            }\n",
     "", N_HIST),
]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def copy_tree(scratch):
    tree = scratch / "tree"
    if tree.exists():
        shutil.rmtree(tree)
    listed = subprocess.run(
        ["git", "ls-files", "-co", "--exclude-standard", "-z"], cwd=REPO, capture_output=True, check=True
    ).stdout.decode().split("\0")
    for rel in filter(None, listed):
        src = REPO / rel
        if not src.is_file():
            continue
        dst = tree / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    (tree / "node_modules").symlink_to(REPO / "node_modules")
    (tree / "dist").mkdir(exist_ok=True)
    return tree


def run(tree, scratch, test):
    env = dict(os.environ)
    if isinstance(test, tuple):
        env["PATH"] = f"{NODE22}:{env.get('PATH', '')}"
        cmd = ["npx", "vitest", "run", test[0], "-t", re.escape(test[1])]
        shown = f"npx vitest run {test[0]} -t {re.escape(test[1])!r}"
    else:
        env["PATH"] = f"{RUST}:{env.get('PATH', '')}"
        env["CARGO_TARGET_DIR"] = str(scratch / "target")
        sdk = subprocess.run(["xcrun", "--sdk", "macosx", "--show-sdk-path"], capture_output=True, text=True).stdout.strip()
        if sdk:
            env["SDKROOT"] = sdk
        cmd = ["cargo", "test", "--locked", "--manifest-path", "src-tauri/Cargo.toml", f"skill_evidence::tests::{test}", "--", "--exact"]
        shown = " ".join(cmd)
    done = subprocess.run(cmd, cwd=tree, env=env, capture_output=True, text=True)
    return done.returncode, shown, done.stdout + done.stderr


def ran_and_failed(test, output):
    if isinstance(test, tuple):
        return bool(re.search(r"Tests\s+\d+ failed", output)) and test[1] in output
    return f"skill_evidence::tests::{test} ... FAILED" in output


def ran_and_passed(test, output):
    if isinstance(test, tuple):
        return bool(re.search(r"Tests\s+\d+ passed", output)) and not re.search(r"\d+ failed", output)
    return f"skill_evidence::tests::{test} ... ok" in output


def name_of(test):
    return f"{test[0]} > {test[1]}" if isinstance(test, tuple) else f"skill_evidence::tests::{test}"


def main():
    scratch = pathlib.Path(sys.argv[1]).resolve()
    scratch.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    tree = copy_tree(scratch)
    summary = {"controls": [], "variants": []}
    failures = 0

    for test in {name_of(v[5]): v[5] for v in VARIANTS}.values():
        code, shown, output = run(tree, scratch, test)
        ok = code == 0 and ran_and_passed(test, output)
        failures += 0 if ok else 1
        summary["controls"].append({"test": name_of(test), "exit": code, "passed": ok})
        print(f"control {'pass' if ok else 'FAIL'}  {name_of(test)}")

    for vid, guard, rel, old, new, test in VARIANTS:
        target = tree / rel
        original = target.read_text()
        before = sha(target)
        if original.count(old) != 1:
            raise SystemExit(f"{vid}: the snippet must occur exactly once in {rel} (found {original.count(old)})")
        target.write_text(original.replace(old, new))
        try:
            code, shown, output = run(tree, scratch, test)
        finally:
            target.write_text(original)
        restored = sha(target) == before
        caught = code != 0 and ran_and_failed(test, output)
        failures += 0 if (caught and restored) else 1
        tail = "\n".join(output.strip().splitlines()[-40:])
        (OUT / f"{vid}.txt").write_text(
            f"# {vid}: {guard}\n# file: {rel}\n# test: {name_of(test)}\n$ {shown}\n# cwd: {tree}\n"
            f"--- removed\n{old}\n+++ added\n{new}\n--- output (last 40 lines)\n{tail}\n"
            f"# exit={code}\n# caught={caught}\n# restored={restored}\n"
        )
        summary["variants"].append(
            {"id": vid, "guard": guard, "file": rel, "test": name_of(test), "exit": code, "caught": caught, "restored": restored}
        )
        print(f"{vid} {'caught' if caught else 'NOT CAUGHT'} {'restored' if restored else 'NOT RESTORED'}  {guard}")

    summary["result"] = "all controls pass; every variant caught and restored" if failures == 0 else f"{failures} problem(s)"
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(summary["result"])
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
