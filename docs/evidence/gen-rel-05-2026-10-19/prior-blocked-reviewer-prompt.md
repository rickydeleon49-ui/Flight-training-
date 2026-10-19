# Reviewer assignment — GEN-REL-05 / GENREL04-R12 — 19 October 2026

This is an **incomplete, blocked implementation**, not a GEN-REL-05 acceptance package. Do not mark the feature GREEN or integrate it as completed. All changes remain uncommitted in `/Users/rickymac/code/Flight-training-gen-rel-05`, base `3d50a64976da1c4ab5afca72edaa73f02802d4a6`. Do not commit, push, merge, run a provider, inspect a private profile/key, or use the external network.

Read `CLAUDE.md`, `PRODUCT_SPEC.md`, the top of `STATUS.md` and `ROADMAP.md`, the GEN-REL-05 section of `docs/GENERATION_RELIABILITY_PLAN_2026-10-18.md`, and `docs/GEN_REL_05_IMPLEMENTATION_REPORT_2026-10-19.md`.

## Bounded reviewable change

Inspect the `PendingRetirements` drop guard in `src-tauri/src/gemini_files.rs` and the three added R12 tests in `src-tauri/src/gemini_files_tests.rs`. Verify:

- unsent copies remain owned throughout an outstanding DELETE;
- `Cancellable` dropping either retirement or finish returns those copies to `orphaned`;
- the already dispatched request is not requeued on cancellation;
- each DELETE still receives existing journal-locked admission;
- no cache lock is held across network waits;
- another credential's copies retain the previous expiry-only behavior;
- subsequent cleanup can drain the retained queue without duplicate unsent entries.

The two `r12_dropped_*` tests hold the first DELETE, cancel through `Cancellable`, verify the queued second copy, and then drain it in a later cleanup. The transport-free test only checks ownership/drop behavior. It cannot establish HTTP dispatch ordering.

## Evidence and blocker

`docs/evidence/gen-rel-05-2026-10-19/r12-before.log` records a failed attempt, not a red product regression: the sandbox denies loopback listener binding before either test reaches cleanup. Review the final gate logs and `gate-results.json` without interpreting infrastructure failures as product failures or claiming them green. Verify `SHA256SUMS` and source checksums against the uncommitted worktree. The final gate has two failed checks: native tests (95 permission failures at loopback setup; 575 passed / 6 ignored) and the schema helper (25 passed / 1 failed because sandbox-denied `pgrep` writes diagnostics before its asserted `REFUSED:` prefix). All other requested checks passed, including strict Clippy and the transport-free R12 test. Do not change the frozen schema helper to mask that environment failure.

In a permitted local fixture environment, run the held-DELETE regressions using Node 22 and SDKROOT scoped to Cargo, with Cargo offline. No real key, provider or app launch is needed. Keep any new receipts distinct from this blocked run.

## Outstanding scope

GEN-REL-05 has not been implemented. The report lists all missing acceptance cases and an unimplemented request-cap proposal. There is no larger-count selector, batching/checkpoint/resume implementation, cross-batch validation, or captured batch-request/upload measurement. A reviewer must not infer completion from the R12 correction or unchanged baseline tests. The feature needs implementation and a complete final gate before acceptance.

Do not edit coordinator-owned STATUS/ROADMAP/handoff or the schema-14 manifest. Preserve all failed receipts, dirty work, prior content/history guarantees, the existing journal admission ordering, and the 300-second/three-attempt guarantees until any batching refinement is explicitly implemented and reviewed. Report blockers and findings with file/line evidence; leave integration to the owner's coordinator.
