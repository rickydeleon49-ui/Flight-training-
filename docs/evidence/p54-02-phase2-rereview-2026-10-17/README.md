# P54-02 phase2 independent correction re-review

Reviewed PR199 head06f4bf3952edb32d076ec2bee377785110cb900b. [Decision/findings](../../P54_02_PHASE2_REREVIEW_2026-10-17.md), [one final correction assignment](../../P54_02_PHASE2_FINAL_CORRECTIONS_PROMPT_2026-10-17.md). All evidence here is independent reviewer output. SHA256SUMS paths are relative to this directory; reviewed-source.json binds five submitted inputs to Git blobs. submitted-git-verification.json verifies58/58 replacement-evidence members against the reviewed commit.

## Passing existing checks

- Exact corrected Rust proof compiled with Cargo --locked and scoped SDK26.5; proof-build.log. No app/installer binary was built or launched.
- Submitted suite71/71, suite.exit0, suite.json and suite.stderr.log (empty).
- Corrected Python runner regressions13/13, runner-regressions.log/.exit.
- original-worker-faults.json: the author's exact fault driver against the exact corrected binary; EOF-live/done-nonzero/done-stall all fail without indexing, no external kill; normal succeeds/indexes once. Driver exit0 alone is not an assertion; the JSON outcomes were inspected.

- Post-report helper regressions26/26, helper-tests.log.

## New failing observations

### R5: stream termination

trailing-stream-adapters.rs is the frozen appended entry point; unchanged corrected Supervisor and FrameReader are the test subject. To reproduce on the reviewed or corrected proof:

1. Refuse an existing src-tauri/examples/p54_stream_review.rs. Copy the proof source from the target Git version, rename its single `fn main() {` to `fn original_main() {`, and append this adapter into that new example.
2. Compile only that example with locked dependencies (SDK26.5 on this lane), recording the actual exit and log. stream-diagnostic-build.log is our successful build.
3. Run `p54_stream_review review-trailing-case MODE NEW-SCRATCH` for review-trailing-frame, review-trailing-invalid, review-trailing-partial and normal. Use a fresh process group and a three-second external safety timeout; needing a forced kill is a test failure. The adapter observes try_wait success before settlement, rather than sleeping to assume the process exited. It gives the request a two-second deadline.
4. The observed negative cases all incorrectly return checked/indexed1; normal correctly returns checked/indexed1. trailing-stream-results.json contains actual stdout, exits and timing. The outer diagnostic exits0 because it records observations: the indexed count/outcome is the failing assertion. Corrected assertions must require failure/no checked retention/no index for all three negatives and successful publication for normal.
5. Remove only the unchanged, owned example and new scratch. No Supervisor/reader code or application source was patched during this reproduction.

### R6: mutable cleanup ownership

Run `python3 cleanup-ownership-diagnostic.py PATH-TO-PROOF-PACKAGE NEW-RESULT.json`. It loads the submitted test_run_phase2.py, adds one mocked cargo-build event to the disposable fixture, and invokes the exact runner. Both copied proof source and temporary example become another writer's matching new bytes. Source/runner originals stay untouched. In the reviewed runner the example disappears and exit0 is reported; cleanup-ownership-result.json records that defect. The fixture intentionally places its copied runner/source outside its disposable repository, an accepted runner layout. The confirmed defect is deletion of the changed example; in-repo preservation checks running later cannot undo it. Corrected tests must preserve the other writer's example and report preservation failure, with source-only and ordinary success controls.

## Evidence boundaries

Author replacement performance measurements were read, not rerun. The prior eight-of-ten outcome and memory/fidelity/installed limitations remain explicit. Primary settings and active implementer checkouts were preserved. No owner profile, credentials, provider, native app launch, installer, signing or release action. Broader app matrices were not repeated for proof/docs-only changes. Original and prior correction evidence remains unchanged.
