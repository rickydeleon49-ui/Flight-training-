# Finish P54-02 phase2: P54P2-R5 and R6 together

You are the implementer. Finish these two confirmed proof/runner defects in one bounded correction round, preserve all accepted work and evidence, and stop for independent review. Do not implement production search or start another roadmap feature.

## Starting point and authority

Fetch first. Read `docs/P54_02_PHASE2_REREVIEW_2026-10-17.md`, its evidence README/source manifest, the prior R1–R4 assignment/report, preregistration and project workflow. Read missing review documents with `git show origin/main:path`; do not pull over dirty work.

Reviewed PR199 is `06f4bf3952edb32d076ec2bee377785110cb900b`, branch `claude/p54-02-worker-proof`, based on d080efa. Its corrected implementation is in `docs/evidence/p54-02-phase2-corrections-2026-10-17/`, not the original proof directory. Verify the five frozen inputs in the new review's `reviewed-source.json` before editing. Reconcile any newer work rather than overwriting it. Reuse the agreed available checkout; preserve primary settings and navigation/export worktrees. Codex performs merging and integration; do not self-merge.

R1 replacement publication is verified58/58; original missing logs stay disclosed. Original R2 failure cases, R3 false-PASS gates and R4 caller boundaries now pass. Retain those fixes and tests. The remaining issues are precisely R5/R6 below, not a reason to rewrite the whole proof.

## R5 — Complete stream validation before checked publication

Read the exact source locations and observation in the re-review. `settle` currently stops once exit status and a result exist, before draining later reader events. EOF also discards a partial line. The report claims these cases fail, but all three frozen negative cases publish/index as checked.

1. Reproduce using `trailing-stream-adapters.rs` from the re-review evidence. In a disposable copy of the **current** proof, rename its sole main to `original_main`, append the adapter and compile it as a new temporary example. Leave Supervisor and FrameReader unchanged for the reproduction. The `review-trailing-case MODE NEW-SCRATCH` entry supports `review-trailing-frame`, `review-trailing-invalid`, `review-trailing-partial`, and `normal`. Its `try_wait` observation before settlement makes the completed-child schedule deterministic. Keep an external safety timeout solely to clean up a hung test group; needing it fails the test.
2. Fix lifecycle/reader finalization coherently: success requires exit0 plus validated stdout through a clean terminal event. Consume any queued protocol error or post-result frame. Reader failure/disconnect must not masquerade as clean EOF. A partial nonempty frame at EOF is invalid. Keep the original deadline active while waiting for stream shutdown; do not restore a blocking wait or extend the deadline.
3. Promote meaningful permanent tests for the three negative cases and the normal control. Assert failed outcome, no checked retention and no indexing for failures, and successful bounded publication for normal input. Exercise the already-exited-child schedule, not a timing sleep. Add queued frame/stream-limit error and reader-error controls where needed to prove the terminal gate, without widening into a new protocol/product design.
4. Confirm original EOF-live, done/nonzero and done/stall fixes, cancellation, supersession, limits, privacy and cleanup still pass. Failed outcomes may retain the existing user-visible error semantics; this task requires no checked success or indexing from invalid streams, not a redesign of every failure publication.

## R6 — Cleanup must use immutable ownership evidence

The runner rereads mutable source when deciding whether to delete its example. The frozen `cleanup-ownership-diagnostic.py` adds one build-time event to the author's existing disposable runner fixture, without changing the runner: both source and example become another writer's new matching bytes. The reviewed runner deletes that changed example.

1. Reproduce: `python3 cleanup-ownership-diagnostic.py /path/to/current/corrected-proof-package /new/path/result.json`. Use a new output path; the script calls the submitted test fixture and owns only temporary files.
2. Capture source bytes/identity once before the write. Create the example exclusively so an intervening writer is not overwritten. At cleanup compare against immutable evidence of what this invocation wrote, not a fresh source read. Record that captured source hash as the compiled input identity; a later source edit must not relabel the built binary. If another writer's example differs, preserve it and fail with clear preservation evidence.
3. Add permanent tests for (a) example-only edit (existing), (b) source-only edit while the example still holds this run's bytes, (c) source-plus-example edit to matching new bytes, (d) example appearing before exclusive creation, and (e) ordinary successful creation/cleanup. Make each ownership assertion observable; a later source-preservation failure does not excuse deleting another writer's file.
4. Keep all earlier measurement, failed-suite, already-dirty content, location and failed-cleanup gates. Keep failure receipts and stop measuring on invalid data.

## Verification and delivery

Run new regressions first against06f4bf3 and preserve the meaningful failures plus positive controls. Test adapters belong only in disposable proof/test copies. Then run all corrected runner regressions and the complete preserved native proof suite with new cases. Build only locked-dependency Cargo examples, using scoped SDK26.5 on this Mac if needed. Retain pre-registered datasets, limits, seeds, repeats and targets. Rerun end-to-end measurements only after all correctness/gating tests pass; keep valid budget misses separate from invalid measurements.

Keep the original proof directory, preregistration and prior correction receipts immutable. Put final sources/receipts in a new explicitly labeled directory (or preserve byte-identical prior sources and bind the new version separately). Include a concise R5/R6-to-test map, baseline and final logs/JSON with raw exit codes, complete SHA256SUMS, a machine-readable byte/hash inventory, and verification against actual staged/committed Git blobs. Force-add ignored logs and use exact-path raw-byte attributes; do not weaken hygiene checks. Avoid manifests that claim to include their own attestation recursively.

Prepend current ROADMAP/STATUS/handoff entries while preserving history. Refresh only current tracker bindings and the source manifest's own checksum as required by the frozen helper; run its applicable regressions and diff hygiene. Identify exact source head and any remaining integration prerequisites. Leave reviewable work for Codex; no acceptance claim or self-merge.

Do not launch/build the application or installers, access profiles/keys, call providers, add dependencies, change migrations, sign or publish a release. Compiler runs are solely disposable proof examples. Hard worker memory caps, licensed real-handbook/CID/Unicode fidelity, native interaction and owner adoption decisions remain open. Do not tune away the two reported performance misses. Preserve all other agents' active work and stop after the consolidated correction package is complete.
