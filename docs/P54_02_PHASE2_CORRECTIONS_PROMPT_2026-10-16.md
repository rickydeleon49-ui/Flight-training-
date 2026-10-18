# P54-02 phase 2: finish the four independent-review correction groups

You are the implementer. Complete P54P2-R1–R4 together on the existing PR199 proof branch, then stop for independent review. This is a proof/evidence correction, not application search implementation or engine adoption.

## Read and establish identity

Fetch first. Read `docs/NAV_WORKER_INDEPENDENT_REVIEW_2026-10-16.md`, its evidence README and `reviewed-source.json` from current origin/main; if missing in your checkout, use `git show origin/main:path`. Read PR199, `docs/P54_02_PHASE2_PREREGISTRATION_2026-10-16.md`, the phase2 report and original worker-proof assignment. Follow the project development/review workflow and approved roadmap order.

Reviewed PR199 head is `9b202c0373c875192fe6425301bb936ba0810048`, branch `claude/p54-02-worker-proof`, based on `d080efa`. Locate/reuse its agreed checkout. Confirm branch, HEAD, tracked/untracked state and the five PR199 proof bindings in the seven-entry review inventory (the two navigation bindings belong to PR198). Other agents may be working: inspect differences before editing; preserve competing changes rather than resetting, stashing, cleaning or overwriting them. The primary clone's settings edit and active navigation/export worktrees are not yours. Do not create another clone without a concrete need.

Keep original preregistration and failed/final evidence immutable. Put correction receipts in a new directory. If a historical raw receipt is missing locally, disclose it and run a separately labeled replacement; do not claim reconstructed bytes are the original.

## Acceptance matrix

### R1 — Publish a complete evidence package

The review's Git-blob inventory lists 12 absent `.log` members out of 42 expected. Recover actual retained logs if available. Force-add ignored manifest members, and use exact-path `-text -diff` attributes for raw logs where needed. Verify all manifest members **from staged or committed Git blobs**, not merely the local filesystem. Include original and new receipts, clear relative path roots, byte/hash manifests and a machine-readable inventory. Preserve historical failures and disclosed limitations.

### R2 — Bounded settlement and successful-exit gate

The unchanged submitted supervisor blocks in `child.wait()` after EOF and accepts valid output from a child that subsequently exits3. Replace the broken lifecycle boundary coherently, rather than adding sleeps or a detached wait. Keep the original deadline and watchdog active until the child is reaped; shutdown must fit the documented deadline allowance. A `done` frame alone is insufficient for success. Nonzero/signal/forced-kill outcomes cannot publish checked results or index anything. Preserve cancellation, supersession, cleanup ownership, current-file identity and privacy behavior.

Promote meaningful regressions using disposable worker fault adapters:

- stdout closes while the child stays alive; bounded failure and kill/reap without external intervention;
- a complete genuine normal result followed by exit3; failed outcome, no success retained/indexed;
- complete result followed by a stall; original deadline still applies, no checked publication after kill;
- a normal complete result plus exit0 succeeds exactly as intended;
- existing no-result, malformed stream, memory/deadline, cancellation and old-request tests remain valid.

The review's `worker-diagnostic-adapters.rs` supplies the first two fault modes and an observation driver. Apply adapters to disposable copies of **current** proof source; do not test an old bundled source or add bypass modes to distributed app code. The old hang was stopped by a review-owned external kill at3s: the corrected proof itself must terminate/reap it. Use a generous external safety timeout only to protect the harness; needing it is a failure.

### R3 — Enforce runner failure and preservation gates

Run the exact-runner `runner-gate-diagnostic.py` against the submitted version to reproduce the two false-PASS scenarios before fixing. It expects sibling `run-phase2.py`; copy it to scratch with the runner being tested. Fault adapters are test-only.

Require successful extraction/index subprocess exits and valid complete measurement receipts before calculating targets. Validate inner extraction worker exits, final completion and exact expected text-page counts as well as outer commands. Missing/invalid RSS and malformed/missing required fields must produce explicit invalid-measurement failure, preserve receipts and exit nonzero. Do not turn failed work into a fast measurement.

Capture and compare scoped application bytes/identities so an already-dirty file changing again is detected. Enforce preservation failures and temporary-example cleanup failures; writing `false` in JSON while printing PASS is insufficient. Refuse unsafe/overlapping scratch/output locations if cleanup could erase evidence. Keep all scratch cleanup inside newly owned paths and preserve failure receipts. Do not remove another agent's example or outputs. Include positive controls so ordinary valid measurements and intact source still work.

Add permanent runner regressions for nonzero extraction, nonzero index, preservation change (including already-dirty content), invalid/incomplete inner worker results, missing measurements, and normal success. Preserve the existing check that measurement collection starts only after the complete correctness suite passes. Record budget misses separately from invalid measurements; keep preregistered limits/targets unchanged.

### R4 — Enforce the caller input boundary

The preregistration requires a caller size check before spawning; the submitted Supervisor never performs it. Its publication recheck and request fixture helper read whole files without a cap. Implement bounded incremental hashing/reading with the existing input limit, including size growth after a metadata check. An oversized initial input must refuse before any child is spawned; an oversized replacement at publication must refuse with no indexing and without reading/allocating the whole file. Retain the worker's independent `take(limit+1)` check and exact-byte hash binding.

Use small injected limits and modest files for tests: initial over-limit, exact boundary, growth between check/read, oversized publication replacement, and a valid current success. Assert both refusal/no-indexing and the bounded bytes/read behavior or equivalent observable mechanism; a final hash mismatch alone does not prove bounded allocation. Do not trigger an OOM. Correct report claims to the implemented boundaries without rewriting preregistration history.

## Verification, evidence and stopping point

Run focused new regressions first and prove they fail on the reviewed implementation for the stated reasons. Then run the preserved correctness suite plus new cases. Rerun valid measurements only after every required correctness/gating case passes; use the same preregistered datasets, seeds, repeats and target values. Retain all failed attempts distinctly. Use SDK26.5 on this Mac if the default SDK still has the recorded linker issue; no global toolchain changes.

This package changes proof/runner/docs only. Do not launch the app, touch profiles or credentials, call providers, add dependencies, change migrations or application code, build an installer, sign, publish a release or start another roadmap feature. Compile disposable proof examples only with existing locked dependencies; remove only owned temporary sources, binaries and scratch. Existing memory-cap, real-document/CID/Unicode fidelity and native painted interaction gaps stay explicit. Owner decisions are not inferred from a successful proof.

Deliver one correction report with R1–R4-to-test mapping, baseline and final receipts, exact counts/exits, source hashes, raw logs, complete Git-verifiable manifests and a reproduction command. Prepend current status to ROADMAP/STATUS/handoff without deleting history. Refresh only the current tracker bindings and manifest self-checksum required by the frozen helper; preserve historical bindings. Run applicable helper/hygiene checks. Reconcile current main without dropping other agents' work, require exact-head CI when ready for review, and leave the package for Codex's independent acceptance. Do not self-merge or advance production adoption.
