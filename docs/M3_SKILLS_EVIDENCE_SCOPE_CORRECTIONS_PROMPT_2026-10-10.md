# M3 skills evidence — consolidated scope/prototype corrections

You are the implementation model. Finish **M3-R1–R7 together**, using the independent [review](M3_SKILLS_EVIDENCE_SCOPE_REVIEW_2026-10-10.md) and its [frozen evidence](evidence/m3-skills-evidence-scope-review-2026-10-10/README.md). Deliver a corrected, reviewable scope/prototype package. **Do not start production M3.** The reference has real defects; passing its original tests is not acceptance.

## Starting point and safe ownership

Preferred worktree: `/Users/rickymac/code/Flight-training-m3-skills-scope`, branch `codex/m3-skills-evidence-scope`, submitted base `48fa47d9d035b2636b72fd6692930d85f4992bb9`. The primary `/Users/rickymac/code/Flight-training-` has a separate pending Mac preflight package; leave it untouched.

1. Fetch first; inspect HEAD, branch and status. Read `CLAUDE.md`, `docs/PROJECT_DEVELOPMENT_REVIEW_WORKFLOW.md`, the scope, this assignment, the review and both evidence READMEs. Fetching is not pulling. Read new review documents from `origin/main` if absent locally. Do not pull/reset/stash/clean or overwrite dirty work.
2. Verify all **57 frozen submitted paths** in the review's `submitted-hashes.json`, the original **51-entry SHA256SUMS**, and **30 base anchors**, before editing. Report mismatches before touching affected files. The publication prepends review entries to ROADMAP/STATUS/handoff; their original bytes are in `submitted-documents/`. If starting from the integrated publication instead of the original dirty worktree, compare the 54 unchanged submitted paths directly and the three submitted document snapshots to the frozen manifest; preserve current review/history entries. If another implementation is active, stop overlapping edits and report it.
3. Reproduce the frozen diagnostics on a **disposable copy**, following the review README. Baseline: submitted Vitest **102 passed / 2 skipped**, strict typecheck clean, native **7 passed**; new reviewer TS/UI **17 failed / 4 passed**, native **3 failed / 2 passed**. Preserve those baseline receipts and diagnostic sources unchanged.

## Authorized correction work

Edit only the M3 scope, conditional implementation prompt, candidate SQL/prototype/native proof/test/fixture files, new correction evidence and append-only status/handoff/roadmap entries. Existing migrations 0001–0013, production source, registry/checksums, identifiers, versions, capabilities, installers, dependencies and release configuration remain unchanged. Candidate 0014 remains unregistered under evidence. A narrowly justified candidate-only dependency needed to prove native normalization must be documented with licensing; do not add production dependencies.

### R1 — Own writes, draft completion and paging separately

- Retain a draft's operation identity after acknowledgment while refresh is pending. Same-draft repeated submits must join/reuse its settled result rather than allocate another operation. Clear/reset through an explicit new-draft transition, not acknowledgment alone.
- Capture draft, operation and view-generation ownership. A late A success/refusal/cleanup cannot change B's saving lock, notices, errors or read generation. Account for A→B→A and multiple draft keys; a single global boolean is insufficient.
- Clear/invalidate older-page locks on every first-page generation change. Refresh and failed post-write refresh recovery are read-only. Keep Saved versus saved-but-stale accurate.

### R2 — Resolve the original uncertain operation and preserve text

- Keep the exact original request as well as its ids/fingerprint. Replay that identical idempotent request through the serialized writer to resolve the earlier intent, or prove an equally authoritative status protocol. An empty observation history is not proof of absence/refusal.
- A changed draft after unknown+erase cannot silently allocate fresh ids and recreate content. Pending original writes cannot coexist with a duplicate changed create. ERASED/OPERATION_CONFLICT must retain an intelligible refusal/recovery path.
- Replace boolean success with explicit outcomes distinguishing current submitted draft saved, earlier draft saved, still unknown, erased and refused. Preserve different unsaved wording; clear only the fingerprint actually acknowledged. Offer an explicit next step to edit the existing record or start a genuinely fresh intent after reconciliation. Do not automatically reinterpret earlier-save success as saving the new words.
- Cover lost acknowledgment, held pending commit, failed reconciliation, tombstone after erase, changed draft while save/refresh is pending, and ordinary definitive validation refusal.

### R3 — Survive the application's real StrictMode lifecycle

Use symmetric mount setup/cleanup, with lifecycle restoration before loading. Drop replay-generation reads and real-unmount callbacks, but allow the live replay generation to publish. Keep StrictMode and meaningful cleanup. Test the specimen with real `React.StrictMode`, including held reads, actual unmount and client/controller changes.

### R4 — Make all retained revisions reachable with bounded pages

Replace the history lifetime visibility cap with a strict revision-page contract (maximum 100 per page). Provide observation-bound cursor validation and Show older; traverse more than 100 versions without missing or duplicating revision 1. Preserve all stored revisions and the fixed skill/source rules. Update all types/readers/store/client/UI and the conditional native command contract.

The frozen diagnostic uses the submitted legacy history API. If its return shape deliberately changes, retain that original failing diagnostic/receipt unchanged and document the API change; promote an equivalent permanent test that reaches earliest wording through bounded pages. Do not weaken the meaning to “only latest 100 visible” or add an unapproved edit cap.

### R5 — Validate receipt shape and operation ownership in TS and native

Decode action-specific exact result schemas. Require correct subject identity and valid revision/sequence/value types; bind the result to the history owned by that operation. Validate erase receipts and non-content tombstones separately. Preserve valid historical replays after later edits, cleared assessments and source/action deletion. Add shared fixtures for wrong subjects, missing/extra fields, invalid counts and mismatched/orphan operation ownership, plus valid controls. Require identical outcomes across node:sqlite, sql.js and rusqlite. Remove reliance on unchecked replay-result casting.

### R6 — Enforce catalog semantics on restored state

Require every built-in revision/head to preserve pinned label, description, topic and catalog version, allowing legitimate retire/restore status transitions. Enforce origin/version consistency and active normalized-label uniqueness across the complete catalog, with parity to the write path's NFC/whitespace/case normalization. Keep retired-name reuse allowed and collision-on-restore refused. Shared native/TS fixtures must cover valid retirement, reuse and unicode normalization, not only ASCII.

### R7 — Handle date edits during paging coherently

Specify a bounded chronological paging strategy that detects relevant edits and rejects/resets stale cursors, or prove another stable strategy. Bind cursors to normalized filters and validate their components. Never append a duplicate or silently omit an unseen observation after an edit crosses the cursor. A deduplication set alone does not solve omission. Test both crossing directions, ties, insert/erase, filter changes and late pages. Update scope/UI recovery, index/query-plan proof and relevant source-level benchmarks consistently; explain any changed ordering.

## Verification and delivery

- Preserve the original submission pack/receipts; write new correction logs under a distinct evidence directory. Promote every reviewer behavior as a meaningful permanent regression and add the extensions above. Demonstrate named new regressions fail on the frozen submitted code where applicable.
- Re-run original focused suites, strict prototype typecheck, corrected reviewer diagnostics/equivalents, native proof and expanded shared contract fixtures. Record exact commands, exits, counts, skipped cases and any unhandled errors. Keep positive controls, rollback, erasure, replay, retained-row upgrade and cross-engine restore proofs green.
- Check sensitivity for new decisive guards; keep the S4a masked-by-ConnectionOwner explanation accurate. Re-run benchmarks/query plans only for changed read/validation paths. Do not run an unchanged whole-app matrix, rebuild installers or repeat physical-preparation audits. If production anchors unexpectedly change, report it and do not treat this as authorized production work.
- Correct the scope's claims and conditional implementation prompt to match the final contracts. Keep M3-D1–D9 **PROPOSED**, pending owner approval; technical corrections do not grant that approval. Preserve the explicit native-writer-not-built and jsdom-only limitations.
- Deliver one issue-to-fix report with exact test names, before/after results, API/schema choices, new raw receipts, full source/evidence hash manifests and reproduction steps. Update ROADMAP/STATUS/handoff, preserving previous entries and saying **corrected, pending independent re-review**.
- Leave changes **uncommitted and unpushed**. No PR/merge by the implementer; stop for senior review. G1–G3 remain DEFERRED/UNEXECUTED/UNVERIFIED; post-receipt recovery remains BLOCKED/source-covered. No hfdtest login or physical test is requested.
