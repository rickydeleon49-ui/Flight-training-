# P54-02 phase2 correction re-review

**Decision: REQUEST CORRECTIONS at PR199 head `06f4bf3952edb32d076ec2bee377785110cb900b`.** No application source or production search was introduced. Two reproduced boundary defects remain in the proof/runner; finish them together under [the final correction assignment](P54_02_PHASE2_FINAL_CORRECTIONS_PROMPT_2026-10-17.md). Do not restart the original work or adjust the preregistered budgets.

## What is verified and preserved

- All **58** replacement-evidence checksum members exist and match their actual Git blobs. The original missing twelve logs remain explicitly unrecoverable; separately labeled replacement receipts are an acceptable correction under the prior assignment. Original report, preregistration and original evidence directory are unchanged from9b202c0. R1's replacement publication requirement is satisfied.
- Exact corrected Rust source builds with locked dependencies and scoped SDK26.5. Its **71/71** cases pass independently. The previous EOF-live, done/nonzero, and done/stall cases settle without external intervention and do not index; the normal control indexes once. R2's original reproduced defects are fixed, subject to R5 below.
- All **13** runner regressions pass independently, including measurement nonzero exits and already-dirty content preservation. The revised gates fix the original false-PASS cases. R3's cleanup ownership remains incomplete under R6 below.
- R4's bounded caller hash, pre-spawn input refusal and growth/replacement tests are present, and their suite cases pass. The worker retains its independent limit. No OOM experiment was needed.
- The submitted71-case suite and the13-case runner run do not include the new variants below. Those new diagnostics fail for their intended assertions; their normal controls continue to work.

The author's replacement performance run still reports **8/10** targets, with query latency and whole-process RSS misses. Those measurements were not repeated in this re-review. Hard worker memory isolation, real handbook/CID/Unicode fidelity, release/native interaction and owner adoption decisions remain pending. Source proof acceptance must not become production or installed-app acceptance.

## P54P2-R5 [P2]: success is published before stdout is validated through EOF

**Locations:** `docs/evidence/p54-02-phase2-corrections-2026-10-17/p54_worker_proof.rs:697–705`, `:732–748`, and reader`:281–284`, at the reviewed commit.

The loop stops when `status.is_some() && result.is_some()`. A zero process exit and a `done` frame can therefore bypass queued frames or protocol errors still waiting in the reader channel. The new `frame_after_result` branch does not run in that schedule. The reader also emits EOF without inspecting any unterminated bytes remaining in `FrameReader.line`.

**Deterministic reproduction:** run the real normal worker, append one of (1) another page frame, (2) malformed JSON plus newline, or (3) a partial unterminated JSON frame, and exit0. The adapter observes the child's exit with `try_wait` before calling `settle`, modeling a supervisor scheduled after its child finishes; it uses no fixed wait to create the race. In **all three** cases, the unchanged supervisor reports `checked`, publication `Ok(())`, **indexed1**. The clean normal control also succeeds, as it should.

**Impact:** corrupted or incomplete worker output is treated as a validated extraction and starts indexing. This contradicts the corrected report's explicit claim that extra frames and incomplete streams are rejected. It is a proof acceptance failure, not evidence that the distributed app already performs this search.

**Fix:** keep the existing deadline/watchdog lifecycle, but require the successful child exit **and** fully consumed, validated stdout termination before success. Drain/order all reader messages through a trustworthy terminal event; do not turn a reader disconnect/read error into clean EOF. Reject trailing frames, queued malformed/oversized errors, and an unterminated partial frame at EOF. Preserve the successful-result/exit0 control and bounded failure/reaping behavior. A naive change to the loop condition alone does not validate the reader's partial-line buffer.

## P54P2-R6 [P2]: cleanup compares against mutable source and can delete another writer's example

**Location:** corrected `run-phase2.py:112–128`.

The runner writes `source.read_bytes()` into its temporary example, then reads the source again in `finally` as the ownership check. If another writer changes **both** the proof source and the example to the same new bytes during the build, the comparison passes and the runner deletes that writer's example. Comparing against the current source does not prove the example still holds the bytes this run wrote.

**Deterministic reproduction:** a review-only adapter extends the submitted disposable runner fixture at its mocked cargo-build boundary: it changes both the copied source and the example to `new work from the other writer`. The exact submitted runner removes the changed example (`exampleLeft:false`), deletes scratch and exits0. This fixture intentionally keeps the runner/source outside the tested repository, an accepted layout; with an in-repo source, the later preservation check may detect the source change, but it cannot undo the deletion. The file-loss defect is the cleanup action itself.

**Fix:** capture immutable source bytes/identity once before writing; create the temporary example without overwriting an intervening writer; compare cleanup against the captured bytes this run actually wrote. Preserve a changed example and report the preservation failure, even if the input source has changed to match it. Keep the existing changed-example-only regression. Add source-only and source-plus-example change controls; no real other agent or application file should be edited by these tests.

## Evidence and scope

[Frozen adapters, observations, logs and source hashes](evidence/p54-02-phase2-rereview-2026-10-17/README.md). R5 adapters are appended only to a disposable source copy; Supervisor/reader code is unchanged. R6 uses the author's existing disposable fixture, with one additional mocked build-time event; the Python runner itself is unchanged. All external safety timeouts remained unused in the new stream cases and the original corrected fault-driver controls.

Only proof compilation, synthetic native tests, Python fixtures and read-only Git inspection were performed. No application launch, owner/test profile, key, provider, installer, signing or release operation. Primary `.claude/settings.json` and other agents' checkouts were preserved. Post-report helper regressions26/26 pass. Broader frontend/native application suites are not relevant to these docs/proof-only changes and were not repeated. The earlier error receipts and current implementation remain intact.

PR199 is still draft, based on d080efa rather than current main439ebb3, and had no exact-head check listed at this review snapshot. After R5/R6 pass independent review, reconcile current main while preserving all tracker history and helper bindings; then require normal exact-head CI before merging. PR189's69768bf CI is now green, but current-main reconciliation is still required. PR193's separate independent export acceptance/current-base integration remains pending. No roadmap order or owner scope decision changed.
