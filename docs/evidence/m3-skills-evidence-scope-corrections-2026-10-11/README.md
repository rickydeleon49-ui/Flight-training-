# M3 scope/prototype corrections M3-R1–R7: evidence (11 October 2026)

**State: corrected, pending independent re-review.** M3-D1–D9 remain PROPOSED. Candidate 0014 is unregistered and unchanged. G1–G3 remain DEFERRED / UNEXECUTED / UNVERIFIED.

- **Report:** [`M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_REPORT_2026-10-11.md`](../../M3_SKILLS_EVIDENCE_SCOPE_CORRECTIONS_REPORT_2026-10-11.md).
- **Corrected code** lives in the [scope pack](../m3-skills-evidence-scope-2026-10-10/README.md). This folder holds only the new receipts, scripts and manifests. The original receipts and the review's frozen diagnostics are untouched.

**Worktree:** `/Users/rickymac/code/Flight-training-m3-skills-scope`, branch `codex/m3-skills-evidence-scope`, base `48fa47d`; uncommitted.

## Contents

| Path | What it is |
| --- | --- |
| `scripts/receipt.sh` | Records command, cwd, UTC time, combined output and exit. |
| `scripts/verify_submission_identity.py` | Verifies the 57 frozen submitted hashes, the 51 original checksums and the 30 anchors from git objects, and lists the corrected paths. |
| `scripts/run_correction_sensitivity.py` | Re-runs the original S1–S8 reversions on the corrected code and adds 23 new ones (C1–C18 in TS, N1–N5 native) on an isolated scratch copy. |
| `diagnostic-equivalents/review-diagnostics-valid-erase.test.ts` | The review's TS diagnostic with one change: R2a's invalid erase request is corrected. Not in any include pattern; copied into disposable copies only. |
| `receipts/` | Every check below. |
| `SHA256SUMS`, `scope-pack-SHA256SUMS`, `changes-from-submission.json`, `document-hashes.json` | Manifests (see the end). |

## Receipts

`(F)` runs on a disposable **frozen** copy: `git archive 48fa47d` plus the 57 submitted files (pre-edit bytes) plus the review pack from `origin/main`, with the review diagnostics copied in exactly as its README says. `(N)` runs on that frozen copy with the corrected new tests and fixtures copied in. `(C)` runs on a disposable copy of the corrected code with the frozen diagnostics copied in. Everything else runs in the worktree.

| Receipt | Check | Result |
| --- | --- | --- |
| `00-submission-identity-and-anchors.txt` | Frozen identity and anchors | 57/57, 51/51, 30/30; exit 0 |
| `01-toolchain.txt` | Versions | exit 0 |
| `02-baseline-production-unchanged.txt` | Production identical to `48fa47d` and `origin/main`; no candidate reference; candidate 0014 byte-identical | exit 0 |
| `03a`/`03b`/`03c` (F) | Submitted Vitest / tsc / native | 102 passed + 2 skipped / clean / 7 passed |
| `04a`/`04b` (F) | Review diagnostics TS/UI / native | 17 failed + 4 passed (exit 1) / 3 failed + 2 passed (exit 101) |
| `05` (N) | New TS regressions and the 72-case contract on the frozen code | 53 failed / 12 passed (the passes are positive controls), exit 1 |
| `06` (N) | The 72-case contract on the frozen native validator | 37 of the 38 new negatives wrongly accepted, exit 101 |
| `07-vitest-corrected.txt` | Full corrected suite, verbose, including the query plans | **162 passed / 2 skipped**, exit 0 |
| `08-tsc-corrected.txt` | Strict typecheck | exit 0 |
| `09-native-corrected.txt` | Native crate | **7 passed**, exit 0 |
| `10` (C) | Review TS/UI diagnostics on the corrected code | 18 passed / 3 failed (R4 ×2 legacy API, R2a setup defect), exit 1 |
| `11a` (F) / `11b` (C) | R2a with only its erase request corrected | frozen: R2a fails, the erased observation is recreated / corrected: R2a passes (only R4 ×2 fail) |
| `12` (C) | Review native diagnostics on the corrected code | **5 passed**, exit 0 |
| `13-fixtures-regenerate-identical.txt` | Generator reproduces both fixtures | exit 0 |
| `14-hygiene.txt` | `git diff --check`, trailing whitespace and final newline on every new or changed file | exit 0 |
| `sensitivity/` | 32 variants and `summary.json`, plus `run.log` | 31 caught; S4a masked as before by `ConnectionOwner`; all restored |
| `bench.txt`, `bench-results.json` | Source-level benchmarks, re-run for the changed read and validation paths | exit 0 |

The worktree needed the primary checkout's `node_modules`, linked only because `package-lock.json` is byte-identical. It was removed after the receipts. The native target directory lives in the session scratchpad, not in the repository.

## Manifests

- **`SHA256SUMS`:** every file in this folder except itself, with paths relative to here. Verify with `shasum -a 256 -c SHA256SUMS` from this folder.
- **`scope-pack-SHA256SUMS`:** every current file of `../m3-skills-evidence-scope-2026-10-10/`, with paths relative to that folder. Verify from there with `shasum -a 256 -c ../m3-skills-evidence-scope-corrections-2026-10-11/scope-pack-SHA256SUMS`.
- **`changes-from-submission.json`:** each of the 57 submitted paths with its submitted and current SHA-256 and status, plus every added file.
- **`document-hashes.json`:** SHA-256 of the corrected scope, implementation prompt, report, ROADMAP, STATUS and handoff.
