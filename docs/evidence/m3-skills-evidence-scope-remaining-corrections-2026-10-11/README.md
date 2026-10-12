# M3 remaining corrections M3-R8–R10: evidence (11 October 2026)

**State: corrected, pending independent re-review.** M3-D1–D9 remain PROPOSED. Candidate 0014 is unregistered and unchanged. G1–G3 remain DEFERRED / UNEXECUTED / UNVERIFIED.

- **Report:** [`M3_SKILLS_EVIDENCE_SCOPE_REMAINING_CORRECTIONS_REPORT_2026-10-11.md`](../../M3_SKILLS_EVIDENCE_SCOPE_REMAINING_CORRECTIONS_REPORT_2026-10-11.md).
- **Corrected code:** in the [scope pack](../m3-skills-evidence-scope-2026-10-10/README.md). This folder holds only receipts, scripts, a diagnostic equivalent and manifests.
- **Worktree:** `/Users/rickymac/code/Flight-training-m3-skills-scope`, branch `codex/m3-skills-evidence-scope`, base `48fa47d`; uncommitted.
- **Preserved:** this pack's first 14 files, written by the interrupted run (receipts `00`–`07`, `scripts/verify_rereview_identity.py`, the diagnostic equivalent), unchanged. Earlier packs and frozen review files are unchanged too.

## Contents

| Path | What it is |
| --- | --- |
| `scripts/verify_rereview_identity.py` | 127 frozen paths, 64/56 checksums, 6 document hashes and 30 anchors, from git objects; lists changed frozen paths |
| `scripts/run_remaining_sensitivity.py` | 18 R8–R10 reversions on isolated copies (fresh cargo target per native variant, hash-checked restore) |
| `scripts/write_manifests.py` | Writes the manifests below |
| `diagnostic-equivalents/review-validation-cases-with-receipt.json` | The first review's validation diagnostic with one change: the built-in retirement control also inserts its owning receipt (M3-R9). The frozen original is unchanged |
| `receipts/` | Every check below; the shared helper is `../m3-skills-evidence-scope-corrections-2026-10-11/scripts/receipt.sh` |

## Receipts

**Copies used:**
- **(F)** is a disposable copy of the **corrected submission** (`git archive 48fa47d` plus the scope pack's pre-edit bytes, verified against the frozen manifest) with the re-review diagnostics copied in.
- **(N)** is that copy with the new tests and fixtures copied in.
- **(C)** is a disposable copy of the **current** source with frozen diagnostics copied in.
- **(B)** is a current-source copy whose `tests/bench.test.ts` differs only in its output path.

| Receipt | Check | Result |
| --- | --- | --- |
| `00` | Re-review identity and anchors | 127/127, 64/64, 56/56, 6/6, 30/30 |
| `01` | Production unchanged; candidate and lockfile identical | exit 0 |
| `02a`–`02c` (F) | Corrected submission: Vitest / tsc / native | 162 passed + 2 skipped / clean / 7 |
| `03a`/`03b` (F) | Re-review diagnostics | 6 failed + 1 passed (exit 1) / 1 failed + 1 passed (exit 101) |
| `04a`/`04b` (N) | New tests on the corrected submission | 24 failed / 10 passed / 1 skipped; native: contract and writer test fail |
| `05`–`07` | Interrupted run's checks on the then-current source | 191 + 3 skipped / clean / 8 |
| `08a`/`08b` (C) | Re-review diagnostics, exact files | 7/7, 2/2 |
| `09a`/`09b` (C) | First review's diagnostics, exact files | 16 + 5 failed / 4 + 1 failed (all explained in the report) |
| `10a`/`10b` (C) | …with the with-receipt equivalent | 10/10 semantic restore; native 5/5 |
| `11` (C) | Valid-erase R2a equivalent | R2a passes; only R4 ×2 (superseded API) fail |
| `12` | Fixtures regenerate byte for byte (validation, constraint, writer library) | exit 0 |
| `13`, `bench-results.json` (B) | Changed-validation benchmark | validation 3–9% slower; pages unchanged |
| `14`/`15`/`16` | **Final gate:** Vitest / tsc / native (fresh target) | **192 passed + 3 skipped** / clean / **8** |
| `17a`/`17b` (C, final) | Exact frozen R8–R10 diagnostics | **7/7**, **2/2** |
| `18` | Hygiene | exit 0 |
| `19` | Final invariants and identity | exit 0 |
| `sensitivity/` | 18 variants, `summary.json`, `run.log` | 17/17 decisive caught; R8-2 equivalent (reported); all restored; exit 0 |

The worktree used the primary checkout's `node_modules` through a temporary link, only because `package-lock.json` is byte-identical; it was removed afterwards. Native targets lived in the session scratchpad.

## Manifests

- **`SHA256SUMS`:** every file here except itself. From this folder: `shasum -a 256 -c SHA256SUMS`.
- **`scope-pack-SHA256SUMS`:** every current file of `../m3-skills-evidence-scope-2026-10-10/`. From that folder: `shasum -a 256 -c ../m3-skills-evidence-scope-remaining-corrections-2026-10-11/scope-pack-SHA256SUMS`.
- **`changes-from-checkpoint.json`:** the 145 checkpoint paths with checkpoint and current SHA-256 and status, plus added files.
- **`document-hashes.json`:** the scope, implementation prompt, both correction reports, ROADMAP, STATUS and handoff.
