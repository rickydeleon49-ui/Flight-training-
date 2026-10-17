# Independent NAV-UI-01 / P54-02 phase2 review receipts

Review decisions and source references: [report](../../NAV_WORKER_INDEPENDENT_REVIEW_2026-10-16.md). One correction assignment: [R1–R4](../../P54_02_PHASE2_CORRECTIONS_PROMPT_2026-10-16.md).

`reviewed-source.json` binds seven inputs to their exact reviewed Git commits (two NAV inputs and five proof inputs). `proof-git-evidence-check.json` inventories the 42 expected proof members against PR199 Git blobs: 30 verify, 12 absent. `nav-evidence-git-check.json` verifies the root-relative helper checksums. The separate 20-entry helper source manifest was independently checked against Git too. This directory's SHA256SUMS is relative to this directory.

Independent local checks use Node22.23.3, rustc/cargo1.99.0, SDK26.5. `local-checks.json` records commands/outcomes. Navigation tests/build/types/helper ran on cb4afba; the exact proof build and original suite ran on 9b202c0 with the same existing locked dependencies. No native app or installer was built or launched. The compiled Cargo examples were disposable proofs, not application builds. Performance measurements in the author report were not rerun or independently accepted.

## Frozen worker-exit diagnostics

`worker-diagnostic-adapters.rs` is the exact appended review-only entry point used for the observations in `worker-exit-diagnostics.json`. The original Supervisor implementation was unchanged. To reproduce in a review-owned checkout:

1. Read the exact reviewed `p54_worker_proof.rs` from Git9b202c0 (or current corrected proof when reviewing a fix). Replace the single `fn main() {` with `fn original_main() {`, append this adapter, and write a **new, absent** `src-tauri/examples/p54_review_diagnostic.rs`. Refuse any existing example.
2. Build only that example with locked dependencies and a scoped SDK26.5 on this lane. Save its actual exit/log. Invoke the binary with `review-case review-eof-stall NEW-SCRATCH` and `review-case review-done-nonzero OTHER-NEW-SCRATCH`.
3. Apply an external three-second safety timeout to the original hanging case. Our driver used a fresh process group and killed only that owned group on timeout. Needing that external kill is failure of the proof's own 200ms deadline, not a passing kill/reap result. The second case runs the genuine normal worker then exits3; its `indexed:1` is the defect.
4. Remove only the byte-matched owned example and clean owned test processes/scratch. Never write adapters into production code. For corrected code, assert bounded failure/no indexing and keep a normal-success control.

The native source file used for baseline `proof-suite.json` was the exact unmodified Git blob, not the adapter copy. Its JSON case counts were checked in addition to command exit0. The original63 cases pass; new diagnostic observations remain failing acceptance criteria. `proof-suite.stderr.log` is genuinely empty.

## Frozen runner gate diagnostics

`runner-gate-diagnostic.py` uses only Python standard-library mocks and new temporary directories. It invokes the **exact submitted** Python runner with controlled subprocess receipts. Copy the runner under test beside it as `run-phase2.py`, then run the diagnostic. The reviewed invocation used PR199's unchanged runner. It does not compile or run an app, mutate application files or measure performance. Controlled failures: extraction17/index23 with parseable JSON; separately a changed source-preservation result. Both incorrectly print PASS/exit0 in the submitted runner, as captured in `runner-gate-diagnostic.json`.

On corrected code adapt the assertion harness to require nonzero invalid-measurement/preservation exits, preserved failure receipts and normal-success controls. A missing field/parse failure is not a substitute for checking nonzero exits. Capture additional scenarios specified by the correction assignment.

Original author receipts, including the63-case result and two reported performance misses, remain on PR199; this review does not overwrite them. No real profiles, credentials or provider services were accessed.
