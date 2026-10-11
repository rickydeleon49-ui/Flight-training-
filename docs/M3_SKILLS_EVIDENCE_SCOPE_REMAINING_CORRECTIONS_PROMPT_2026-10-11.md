# M3 scope/prototype — remaining corrections M3-R8–R10

You are the implementation model. Finish **M3-R8–R10 together** in the corrected M3 scope/prototype. Preserve the substantial verified R1–R7 work. Do not start production M3 or reopen settled requirements without new evidence.

Read the complete [independent re-review](M3_SKILLS_EVIDENCE_SCOPE_REREVIEW_2026-10-11.md), its [frozen evidence README](evidence/m3-skills-evidence-scope-rereview-2026-10-11/README.md), the corrected scope, conditional implementation prompt and correction report. The re-review withdraws the original R2a diagnostic's invalid setup claim and independently confirms your valid-argument equivalent: it fails on original source and passes on corrected source. Keep that distinction; the old unpaged R4 diagnostics also remain historical API evidence.

## Start safely

- Worktree: `/Users/rickymac/code/Flight-training-m3-skills-scope`, branch `codex/m3-skills-evidence-scope`, HEAD/base `48fa47d9d035b2636b72fd6692930d85f4992bb9`. Fetch first, inspect branch/HEAD/status, and read repository workflow instructions.
- Read absent re-review files from origin/main without pulling/resetting/stashing/cleaning the dirty worktree. Leave `/Users/rickymac/code/Flight-training-` and its separate pending Mac preflight package untouched.
- Verify all **127 frozen correction-submission paths**, the corrections pack's **64 checksums**, current scope pack's **56 checksums**, six submitted document hashes and 30 production anchors before editing. Report competing changes before touching affected files. Published ROADMAP/STATUS/handoff have an added re-review entry; their original submitted bytes are in the re-review pack's `submitted-documents/`. For an integrated-publication checkout, compare the other 124 paths directly and those three snapshots against the frozen manifest.
- Reproduce the new frozen diagnostics in a disposable copy: TS/UI **6 failed / 1 temporary-outage control passed**; native **1 failed / 1 valid control passed**. The corrected submission baseline is **162 passed / 2 opt-in skipped**, strict typecheck clean, native **7 passed**. Preserve original outputs and diagnostics.

## R8: acknowledge the entire draft, not just its wording

`ObservationForm` currently captures/computes only a wording string for afterSave. A date, attribution or instructor-name edit during a held save is therefore silently treated as saved, although storage contains the original metadata.

1. Capture the canonical complete ObservationDraft fingerprint for each submitted intent. Compare against the complete current draft and form/operation ownership before clearing fields or resetting its controller identity.
2. Apply the same logic to create, replace-saved and save-as-new paths. Preserve changed wording, date, attribution and instructor name together, plus the acknowledged record identity.
3. Offer accurate explicit follow-up to apply the changed draft to that record or save a new observation. Ensure old callbacks cannot clear a newer form/draft; update live state reliably even with immediate completion after a field edit.
4. Promote the three metadata diagnostics. Extend with stored-row assertions, multiple metadata changes, metadata plus wording, all three submission paths, unchanged-draft controls and held refresh. Preserve existing StrictMode and uncertain-save tests. Disabling editing while pending is not the requested fix.

## R9: require history → receipt ownership as well

The validators currently iterate only existing receipts. Removing a legitimate create receipt leaves its operation-owned history accepted on both TS engines and native.

1. Require a matching live receipt for each user catalog revision, observation revision and assessment. Verify operation identity, action/kind, subject and revision/sequence in both directions.
2. Prevent one operation claiming multiple unrelated history changes. Preserve initial catalog seeds with their legitimate null operation ids, earlier receipts after later edits, cleared assessments, deleted source/action snapshots, and erased observations with non-content tombstones.
3. Expand the shared fixture generator and contracts with deleted receipts for every history family, reused operation identities and mismatched owners/kinds. Supply valid controls written by the real writer where practical.
4. Correct incomplete hand-written “valid” controls by adding their actual matching receipts. Do not loosen the guard to preserve a misleading fixture expectation. Preserve historical fixtures/receipts in frozen evidence; disclose their correction.
5. Promote the new native and TS diagnostics. Run shared outcomes across node:sqlite, sql.js and rusqlite, strict replay tests and affected upgrade/restore proofs. No production dependencies or schema changes are anticipated.

## R10: evict content when erasure is confirmed

On an older-history read returning ERASED, the controller retains loaded items and cursor and the main list keeps rendering that observation.

1. Clear that observation's revision cache/cursor/current revision and invalidate its pending history requests when ERASED is known. Remove the same observation from visible evidence items and refresh/invalidate summary through reads only.
2. Cover opening history, paging it and other confirmed-erased recovery paths. Keep a useful erased message; ensure held late replies cannot republish content.
3. Preserve unrelated observations. Temporary storage/read failures must retain safe loaded history for retry; do not conflate outages with erasure or resubmit writes during cleanup.
4. Promote the controller diagnostic, add an actual rendered UI test and late-page/route-change tests, and retain the supplied temporary-outage positive control.

## Verification and stopping point

Edit only candidate prototype/proof/tests/fixtures, scope/conditional prompt, a new correction report/evidence pack and historical tracking entries. Candidate 0014 remains unchanged/unregistered. Existing migrations 1–13, application source/dependencies, registry/checksums, installers, versions and release configuration remain unchanged.

Run focused regressions first, corrected prototype suite/typecheck/native proof, new frozen diagnostics and affected shared contracts. Add targeted sensitivity checks for decisive new guards, with valid controls. Reuse earlier valid evidence for unchanged areas; no unchanged whole-app matrix, installer build or repetitive preparation audit is needed. Benchmark only changed validation/read paths where warranted.

Write one issue-to-fix report with exact test names, before/after results, commands/exits/counts, API choices and complete source/evidence manifests. Preserve all earlier receipts and frozen files; add new logs to a distinct directory. Update scope, conditional implementation prompt, ROADMAP/STATUS/handoff accurately, keeping all prior entries and saying **corrected, pending independent re-review**.

Leave changes **uncommitted and unpushed**, then stop for senior review. M3-D1–D9 remain proposed pending owner approval. Native writer/readers remain unbuilt; jsdom remains the UI proof boundary. G1–G3 remain deferred/unexecuted/unverified and post-receipt recovery blocked/source-covered. No login, live-library operation, provider call, app install/build/signing or public release is requested.
