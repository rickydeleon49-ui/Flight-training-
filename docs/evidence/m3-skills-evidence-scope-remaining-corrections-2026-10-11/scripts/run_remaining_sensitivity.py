#!/usr/bin/env python3
"""Targeted reversions for the remaining corrections M3-R8-R10. Each removes
one decisive guard in an isolated scratch copy and must make named
BEHAVIOUR assertions fail (rendered content, stored rows, cache/cursor,
unrelated observations, late pages, restore outcomes). The worktree is never
edited. Vitest does not typecheck, and no reversion changes an interface, so a
failure is an assertion about behaviour, not a compile error.

  python3 -I docs/evidence/m3-skills-evidence-scope-remaining-corrections-2026-10-11/scripts/run_remaining_sensitivity.py <scratch-dir>

- Control: every named test passes on the unmodified copy (and each filter
  selects at least one test).
- Each native variant uses its own fresh CARGO_TARGET_DIR, so no stale build
  can serve a variant.
- Every reverted file is restored and its SHA-256 re-checked.
Writes receipts/sensitivity/<id>.txt and receipts/sensitivity/summary.json.
"""
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
REPO = pathlib.Path(__file__).resolve().parents[4]
PACK_REL = "docs/evidence/m3-skills-evidence-scope-2026-10-10"
PACK = REPO / PACK_REL
OUT = REPO / "docs/evidence/m3-skills-evidence-scope-remaining-corrections-2026-10-11/receipts/sensitivity"
NODE_BIN = "/opt/homebrew/opt/node@22/bin"
CARGO_BIN = "/opt/homebrew/opt/rustup/bin"

UI = "prototype/SkillEvidenceSpecimen.tsx"
CTRL = "prototype/evidenceController.ts"
VALID = "prototype/skillEvidenceValidation.ts"
NATIVE = "native/src/lib.rs"
RUI = "tests/remaining-ui.test.tsx"
RCTRL = "tests/remaining-controller.test.ts"
RVAL = "tests/remaining-validation.test.ts"
CONTRACT = "tests/contract.test.ts"

# (id, finding, what is reverted, file, find, replace, [(test file or "cargo:<test>", name pattern), ...][, expected])
# expected defaults to "caught". "equivalent" marks a reversion that cannot change
# observable behaviour under React 19 + jsdom: React flushes a discrete input's
# commit and passive effects synchronously, so an effect-published live draft
# is up to date before any save answer is handled. It is reported, not counted.
VARIANTS = [
    ("R8-1", "M3-R8", "the form compares only the wording before clearing", UI,
     "canonicalJson(draftOf(live.current)) === submitted",
     "live.current.wording === (JSON.parse(submitted) as ObservationDraft).wording",
     [(RUI, "during the save keeps the complete draft"), (RUI, "several changes at once"), (RUI, "Replace: a change made while the replacement is saving")]),
    ("R8-2", "M3-R8", "the live draft is published from an effect (delayed), not in the change handler", UI,
     "  const change = (patch: Partial<Fields>) => {\n    live.current = { ...live.current, ...patch };\n    setFields(live.current);\n  };\n",
     "  const change = (patch: Partial<Fields>) => {\n    setFields((f) => ({ ...f, ...patch }));\n  };\n  useEffect(() => {\n    live.current = fields;\n  });\n",
     [(RUI, "a change made in the same turn as the acknowledgment is still compared")], "equivalent"),
    ("R8-3", "M3-R8", "answers for an earlier draft (or a gone form) are not ignored", UI,
     "    if (!mounted.current || mine !== epoch.current) return;\n", "",
     [(RUI, "a joined duplicate submit's answer cannot raise a follow-up")]),
    ("R8-4", "M3-R8", "one draft key shared by every form instance for a debrief and skill", UI,
     "  const draftKey = `${debrief.journalId}:${skillId}:${ids}`;",
     "  const draftKey = `${debrief.journalId}:${skillId}`;",
     [(RUI, "an answer for a form that was replaced")]),
    ("R9-1", "M3-R9", "TS: observation revisions need no receipt", VALID,
     "    if (!owned(r[\"operation_id\"], OBSERVATION_HISTORY_ACTIONS, r[\"observation_id\"], r[\"revision\"])) {",
     "    if (false && !owned(r[\"operation_id\"], OBSERVATION_HISTORY_ACTIONS, r[\"observation_id\"], r[\"revision\"])) {",
     [(CONTRACT, "node:sqlite gives the listed outcome for every case"), (RVAL, "losing any receipt that owns history is refused"), (RVAL, "receipt removal cannot leave")]),
    ("R9-2", "M3-R9", "TS: user catalog revisions need no receipt", VALID,
     "    if (!owned(r[\"operation_id\"], SKILL_ACTIONS, r[\"skill_id\"], r[\"revision\"])) {",
     "    if (false && !owned(r[\"operation_id\"], SKILL_ACTIONS, r[\"skill_id\"], r[\"revision\"])) {",
     [(CONTRACT, "sql.js gives the listed outcome for every case"), (RVAL, "losing any receipt that owns history is refused")]),
    ("R9-3", "M3-R9", "TS: self-assessments need no receipt", VALID,
     "    if (!owned(r[\"operation_id\"], action, r[\"skill_id\"], r[\"sequence\"])) {",
     "    if (false && !owned(r[\"operation_id\"], action, r[\"skill_id\"], r[\"sequence\"])) {",
     [(CONTRACT, "node:sqlite gives the listed outcome for every case"), (RVAL, "losing any receipt that owns history is refused")]),
    ("R9-4", "M3-R9", "TS: a receipt may own any revision of its subject (operation reuse)", VALID,
     "    return familyOk && receipt.subject === String(subject) && receipt.n === Number(n);",
     "    return familyOk && receipt.subject === String(subject);",
     [(CONTRACT, "sql.js gives the listed outcome for every case")]),
    ("R9-N1", "M3-R9", "native: observation revisions need no receipt", NATIVE,
     "        if !owned(get(&r, \"operation_id\"), &OBSERVATION_HISTORY_ACTIONS, get(&r, \"observation_id\"), get(&r, \"revision\")) {",
     "        if false && !owned(get(&r, \"operation_id\"), &OBSERVATION_HISTORY_ACTIONS, get(&r, \"observation_id\"), get(&r, \"revision\")) {",
     [("cargo:contract", "shared_validation_contract_native_outcomes"), ("cargo:contract", "writer_library_requires_the_receipt_of_every_history_row")]),
    ("R9-N2", "M3-R9", "native: user catalog revisions need no receipt", NATIVE,
     "        if !owned(get(&r, \"operation_id\"), &SKILL_ACTIONS, get(&r, \"skill_id\"), get(&r, \"revision\")) {",
     "        if false && !owned(get(&r, \"operation_id\"), &SKILL_ACTIONS, get(&r, \"skill_id\"), get(&r, \"revision\")) {",
     [("cargo:contract", "shared_validation_contract_native_outcomes"), ("cargo:contract", "writer_library_requires_the_receipt_of_every_history_row")]),
    ("R9-N3", "M3-R9", "native: self-assessments need no receipt", NATIVE,
     "        if !owned(get(&r, \"operation_id\"), &[action], get(&r, \"skill_id\"), get(&r, \"sequence\")) {",
     "        if false && !owned(get(&r, \"operation_id\"), &[action], get(&r, \"skill_id\"), get(&r, \"sequence\")) {",
     [("cargo:contract", "shared_validation_contract_native_outcomes"), ("cargo:contract", "writer_library_requires_the_receipt_of_every_history_row")]),
    ("R9-N4", "M3-R9", "native: a receipt may own any revision of its subject (operation reuse)", NATIVE,
     "Some(s.clone()) == text(subject) && *number == int(n)",
     "Some(s.clone()) == text(subject) && (*number == int(n) || true)",
     [("cargo:contract", "shared_validation_contract_native_outcomes")]),
    ("R10-1", "M3-R10", "an ERASED older-history page keeps the loaded versions and cursor", CTRL,
     "        if (codeOf(error) === \"ERASED\") {\n          evictErased(view.observationId);\n          return;\n        }\n",
     "",
     [(RUI, "Show older versions after an erasure clears the versions and the list item"), (RCTRL, "confirmed erased history discards loaded text and cursor")]),
    ("R10-2", "M3-R10", "eviction leaves the erased observation in the visible list", CTRL,
     "    publish({ items: visible(state.items), history: showingIt ? erasedView(observationId) : state.history });",
     "    publish({ history: showingIt ? erasedView(observationId) : state.history });",
     [(RCTRL, "opening the history of an observation erased elsewhere evicts it"), (RCTRL, "a save whose earlier request turns out erased evicts")]),
    ("R10-3", "M3-R10", "a late older-history page for an erased observation is still published", CTRL,
     "        if (mine !== historyGeneration || !state.history || erased.has(view.observationId)) return;",
     "        if (!state.history) return;",
     [(RUI, "a held older page that lands after the erasure is known"), (RCTRL, "a held older history page that arrives after the erasure is known")]),
    ("R10-4", "M3-R10", "later evidence pages are not filtered for erased observations", CTRL,
     "  const visible = (items: EvidenceItem[]) => (erased.size === 0 ? items : items.filter((item) => !erased.has(item.id)));",
     "  const visible = (items: EvidenceItem[]) => (erased.size === -1 ? [] : items);",
     [(RCTRL, "a held evidence page read before the erasure cannot put the erased observation back")]),
    ("R10-5", "M3-R10", "the summary is not re-read after an eviction", CTRL,
     "    if (!skillId || !wasListed) return;",
     "    return;",
     [(RCTRL, "opening the history of an observation erased elsewhere evicts it"), (RUI, "Show older versions after an erasure clears the versions and the list item")]),
    ("R10-6", "M3-R10", "a temporary older-history failure is treated as erasure (control guard)", CTRL,
     "        if (codeOf(error) === \"ERASED\") {\n          evictErased(view.observationId);",
     "        if (true) {\n          evictErased(view.observationId);",
     [(RCTRL, "a temporary older-history read error preserves loaded history for retry"), (RUI, "a temporary failure loading older versions keeps the loaded versions on screen")]),
]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def copy_tree(scratch):
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
    shutil.copytree(PACK / "native", pack / "native", ignore=shutil.ignore_patterns("target"))
    shutil.copy2(PACK / "vitest.config.ts", pack / "vitest.config.ts")
    os.symlink(os.path.realpath(REPO / "node_modules"), scratch / "node_modules")


def js_regex_literal(text):
    return re.sub(r"([\\^$.|?*+()\[\]{}])", r"\\\1", text)


def run(scratch, target, pattern, cargo_target):
    if target.startswith("cargo:"):
        cmd = ["cargo", "test", "--offline", "--locked", "--manifest-path", f"{PACK_REL}/native/Cargo.toml", "--test", target.split(":", 1)[1], pattern, "--", "--exact"]
        env = dict(os.environ, PATH=f"{CARGO_BIN}:/opt/homebrew/bin:/usr/bin:/bin", CARGO_TARGET_DIR=str(cargo_target))
        sdk = subprocess.run(["xcrun", "--sdk", "macosx", "--show-sdk-path"], capture_output=True, text=True).stdout.strip()
        if sdk:
            env["SDKROOT"] = sdk
    else:
        cmd = ["node", "node_modules/vitest/vitest.mjs", "run", "--config", f"{PACK_REL}/vitest.config.ts", f"{PACK_REL}/{target}", "-t", js_regex_literal(pattern), "--reporter=verbose"]
        env = dict(os.environ, PATH=f"{NODE_BIN}:{os.environ.get('PATH', '')}")
    proc = subprocess.run(cmd, cwd=scratch, env=env, capture_output=True, text=True, timeout=1800)
    return cmd, proc


def selected(target, proc):
    if target.startswith("cargo:"):
        return re.search(r"running [1-9]\d* tests?", proc.stdout) is not None
    return re.search(r"Tests\s+(\d+ failed \| )?[1-9]\d* passed|Tests\s+[1-9]\d* failed", proc.stdout) is not None


def failed(target, proc):
    if target.startswith("cargo:"):
        return proc.returncode != 0 and "FAILED" in proc.stdout
    return proc.returncode != 0 and ("FAIL" in proc.stdout or "×" in proc.stdout)


def main():
    scratch = pathlib.Path(sys.argv[1]).resolve()
    targets = scratch.parent / "remaining-sensitivity-targets"
    shutil.rmtree(targets, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    copy_tree(scratch)
    summary = []
    control_target = targets / "control"
    for variant in VARIANTS:
        vid = variant[0]
        for target, pattern in variant[6]:
            cmd, proc = run(scratch, target, pattern, control_target)
            if proc.returncode != 0 or not selected(target, proc):
                print(f"CONTROL FAILED for {vid}: {target} :: {pattern}\n{proc.stdout[-3000:]}{proc.stderr[-3000:]}")
                return 2
    checks = sum(len(v[6]) for v in VARIANTS)
    summary.append({"control": f"all {checks} named checks pass on the unmodified final copy, each selecting at least one test"})
    for vid, finding, description, rel, find, replace, checks_for, *rest in VARIANTS:
        expected = rest[0] if rest else "caught"
        target_file = scratch / PACK_REL / rel
        original = target_file.read_bytes()
        before = sha(target_file)
        text = original.decode()
        if text.count(find) != 1:
            print(f"{vid}: reversion pattern must match exactly once in {rel}")
            return 2
        target_file.write_text(text.replace(find, replace))
        results = []
        log = [f"# variant: {vid} ({finding}) {description}\n# file: {rel}\n"]
        try:
            for target, pattern in checks_for:
                cargo_target = targets / vid  # fresh per variant
                cmd, proc = run(scratch, target, pattern, cargo_target)
                caught = failed(target, proc)
                results.append({"check": f"{target} :: {pattern}", "exit": proc.returncode, "caught": caught})
                log.append(f"$ {' '.join(cmd)}\n# cwd: <scratch copy>\n{proc.stdout[-15000:]}{proc.stderr[-4000:]}\n# exit={proc.returncode} caught={caught}\n")
        finally:
            target_file.write_bytes(original)
        restored = sha(target_file) == before
        log.append(f"# restored-sha-matches={restored}\n")
        (OUT / f"{vid}.txt").write_text("".join(log))
        caught_any = any(r["caught"] for r in results)
        as_expected = caught_any if expected == "caught" else not caught_any
        summary.append({"id": vid, "finding": finding, "reverts": description, "file": rel, "checks": results, "caughtBy": sum(r["caught"] for r in results),
                        "caught": caught_any, "expected": expected, "asExpected": as_expected, "restored": restored})
        print(f"{vid}: {'CAUGHT' if caught_any else 'NOT CAUGHT'} by {sum(r['caught'] for r in results)}/{len(results)} checks (expected {expected}); restored={restored}")
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    shutil.rmtree(scratch)
    shutil.rmtree(targets, ignore_errors=True)
    return 0 if all(s.get("asExpected", True) and s.get("restored", True) for s in summary) else 1


if __name__ == "__main__":
    sys.exit(main())
