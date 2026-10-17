# Independent review: panel notices and P54-02 phase 2

## Decision and exact scope

**PR198: ACCEPT** the bounded NAV-UI-01 correction at `cb4afba67c7bb7e7c886f5f42438e7c48f985d1d`, against navigation base `b5e6b99`. It merged into PR189 as `69768bf5978a027d2e6382de8c303b785d01df87` after independent checks and successful exact-head CI39004376950. This is integration into the navigation feature branch; PR189 is still open against main. No new defect found in this correction. Do not reopen accepted R11/R12.

**PR199: REQUEST CORRECTIONS** at `9b202c0373c875192fe6425301bb936ba0810048`, base main `d080efa`. Four bounded correction groups below block accepting this as a validated proof. No production search or dependency adoption is authorized. The six-second green documentation CI39005193946 did not execute the proof.

The primary checkout's existing settings change and all implementer checkouts were preserved. Tests used the reviewer's existing worktree and fresh task scratch. No app, real profile, key, provider, installer, signing or release operation occurred.

## P54P2-R1 [P2]: twelve manifest members are not published

At the reviewed Git head, SHA256SUMS lists 42 members: **30 Git blobs verify, 12 are absent**, with no hash mismatch among present members. Missing:

- `final/build.log`
- `final/index-100-1.stderr.log`, `final/index-100-2.stderr.log`, `final/index-100-3.stderr.log`
- `final/index-1000-1.stderr.log`, `final/index-1000-2.stderr.log`, `final/index-1000-3.stderr.log`
- `final/index-10000-1.stderr.log`, `final/index-10000-2.stderr.log`, `final/index-10000-3.stderr.log`
- `final/measure-extract.stderr.log`, `final/suite.stderr.log`

Paths are relative to `docs/evidence/p54-02-worker-proof-2026-10-16/`. The missing stderr logs contain the raw time/RSS evidence for reported measurements. Root `*.log` ignore rules explain how local verification could pass without publication. Restore/publish the actual retained bytes, explicitly force-add ignored members, and verify every member from Git blobs. Preserve original missing-evidence history; do not manufacture old receipts. Use exact-path raw-log attributes, preserving bytes rather than weakening whitespace checks.

## P54P2-R2 [P2]: worker exit and stream completion do not form a bounded success gate

In `p54_worker_proof.rs:611–618`, EOF calls blocking `child.wait()` inside the deadline loop. A child can close stdout and remain alive: with a 200 ms request deadline, the independent fault adapter still needed an external process-group kill at **3.005 s**. The deadline/watchdog cannot run while blocked.

In `p54_worker_proof.rs:603–638`, a `done` frame fixes the outcome before the exit status is known; the reaped status never revises that outcome. An adapter runs the genuine normal worker, emits its complete valid result, then exits **3**. The supervisor reports `checked`, `reaped:true`, `exit:3`; publication returns `Ok(())` and **indexed becomes 1**. A done-then-stall also takes a separate five-second wait and can retain a checked outcome after being killed.

Fix this as one lifecycle boundary: preserve the original deadline/watchdog across EOF, done, shutdown and reap; success requires a valid complete result and a successful process exit. A nonzero exit, signal, forced kill or incomplete stream must not retain a checked result or start indexing. Add deterministic regressions for EOF-while-alive, complete-result/nonzero-exit, complete-result/stall, and normal zero-exit success. Retain the existing kill/reap and obsolete-publication tests.

## P54P2-R3 [P2]: proof runner can report PASS after failed measurements or preservation

`run-phase2.py:92–104` records measurement exit codes but does not reject them. Lines 132–139 record `applicationFilesUnchanged:false` but still print PASS and exit 0. The independent disposable subprocess adapters ran the **exact submitted Python runner**, without editing it:

- Extraction exit **17** and every index measurement exit **23**, each with parseable JSON: runner exit **0**, PASS printed.
- Changed before/after status: `applicationFilesUnchanged:false`, runner exit **0**, PASS printed.

Status-string equality also misses byte changes to an already-dirty file. Compare bounded scoped source content identities, not only status strings, and enforce preservation as a gate. Validate measurement exits, required fields, RSS presence, expected extracted page counts and successful completion before computing a valid summary. Inside `measure_extract` (`p54_worker_proof.rs:1631–1641` and the spawn/first-frame loop), the actual child status/completion must be checked too: a failed inner worker cannot become a successful outer measurement. Distinguish a **valid measured budget miss** from an **invalid measurement**. Keep invalid raw receipts and exit nonzero with a clear stage/reason.

This finding does not claim the published final runs had nonzero exits; their exit files say 0. It proves that the current runner does not enforce its stated gate under failure.

## P54P2-R4 [P2]: caller-side hard input limit is absent

The frozen preregistration says the caller checks size before spawn and prevents arbitrary whole-file reads. `Supervisor::start/pump` (`p54_worker_proof.rs:402–482`) does not check the limit before starting the process. The proof's own over-limit case spawns a real worker and only then refuses. The worker's `take(limit+1)` correctly bounds that worker read, but does not implement the caller promise.

More seriously, publication at `p54_worker_proof.rs:687` uses unbounded `fs::read` on the current path. Replacing the small parsed file with a large file makes the supervisor allocate the replacement before discovering the hash mismatch. The `request` helper at line1195 also hashes by reading the whole input before the worker limit applies. These paths bypass the intended parent/process allocation boundary. This is confirmed source inspection; no large-file/OOM experiment was run.

Use a bounded, incremental caller hash/read with the same limit, including a growth race after a metadata check. Refuse oversized initial input before spawning and oversized replacement at publication without indexing. Preserve the worker's independent read/hash check. Tests should use small injected limits and modest fixtures; no memory exhaustion is needed. Correct the hard-limit wording to describe the actual resulting boundaries without changing the preregistered values.

## Independent checks and evidence

- **Panel:** 234 navigation tests pass; separate panel run 36 pass including the two original frozen diagnostics copied verbatim, then removed. Typecheck and web production build pass. Helper tests 26/26. Twenty helper source-manifest entries and 21 checksum members verify from Git. Diff hygiene clean.
- **Proof:** exact submitted source built with locked dependencies and SDK26.5 in the reviewer's own target cache. Its original suite reproduced **63/63**, exit0. The new fault adapters expose missing coverage; passing those 63 does not close R2–R4.
- **Worker diagnostics:** only test-mode adapters and a renamed entry-point were added to a disposable copy; the reviewed Supervisor/publish code stayed unchanged. EOF test's forced group kill was owned diagnostic cleanup, not the proof meeting its own deadline. No test worker was left intentionally running.
- **Runner diagnostics:** exact runner plus stand-in subprocess results in fresh disposable directories; these test its failure gate, not real extraction performance.
- Full frontend/native matrices and all performance measurements were not repeated: the panel had green exact-head full CI, and the proof's reproduced defects already require corrections. The author's **8/10 targets**, RSS overshoot, unsupported `ulimit`, folding gaps and untested real-document/native interaction remain disclosed author evidence; they are not independently remeasured or accepted production defaults.

[Receipts, frozen adapters, source bindings and missing-member inventory](evidence/nav-worker-independent-review-2026-10-16/README.md). [One model-neutral correction assignment](P54_02_PHASE2_CORRECTIONS_PROMPT_2026-10-16.md).

## Integration and next task

1. NAV-UI-01 is merged into PR189. Reconcile main and require green exact-head CI on the final combined navigation branch before main integration. This review does not silently accept an untested later head.
2. PR193 still needs the independent export acceptance record and current-main retarget/reconciliation identified in the earlier review, then exact-head CI. PR195's merge into that feature branch is not main acceptance.
3. Correct PR199 under the linked single assignment. Preserve prior receipts and immutable preregistration; do not tune away the two measured misses or call the memory watchdog a hard cap. Continue the approved roadmap order after these integrations and decisions, without release/profile work.
