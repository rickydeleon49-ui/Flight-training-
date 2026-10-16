# M4 Slice1 partial-checkpoint review — 16 October 2026

**Disposition: incomplete; not accepted for application integration.** No feature PR exists. Preserve the implementation and finish it under the new continuation assignment. The owner has now directly approved all ten defaults, including OD-6; [approval](M4_PRODUCTION_SCOPE_OWNER_APPROVAL_2026-10-16.md).

## Reviewed identity and preserved work

Worktree `/Users/rickymac/code/Flight-training-m4-slice1`, branch `claude/m4-slice1`, base011684e, committed checkpoints ed82811 and **07fdcfa6593898efe9d6a979bae11095ce1fbf80**. The actual worktree additionally contains an uncommitted change in `src-tauri/src/navigation.rs`: importing/using `js_trim` instead of Rust trim for label/text decoder parity. The completion note's “work committed” description is therefore incomplete. No source was edited by this review. All20 changed application paths are frozen in the [submitted snapshot](evidence/m4-slice1-partial-review-2026-10-16/submitted-snapshot.json), with that patch preserved separately.

Main has since advanced to774f730 via the accepted OPENFOLDER PR#187; it does not ship migration15. The partial branch must merge current main without losing either backup.rs change set. It must not silently replace the accepted folder-opening correction.

## Findings to fix while completing Slice1

### M4S1-R1 [P1]: stale read confirmation can confirm replacement content

**Reproduced, not hypothetical.** `src-tauri/src/navigation.rs::Operation::SetRead/set_read` and `src/data/navigationTransaction.ts::setRead` accept only material/page/confirmed. They compare current stored state against current cached identity, but never compare the content identity or owner generation the user actually saw. Sequence: commit content A/page5; hold its confirmation request; replace identity with B and commit B/page5; deliver the old request. It succeeds and marks B read. The exact production TypeScript transaction reproduced this against synthetic SQLite.

**Required:** carry the expected originating hash and exact saved owner generation (or an equivalent documented CAS tuple) through both request contracts, strict decoders, drivers and UI. Check them transactionally against the current tuple and identity before both confirmation and clearing. A rejected stale operation changes nothing. Apply an equivalent content-bound request check to bookmark creation so a held action cannot silently bind to a replacement file. Add native/browser/shared cases for same-page A→B and same-content newer generation, plus normal success.

### M4S1-R2 [P2]: successful native replies are not bound to the requested tuple

**Reproduced.** `src/data/navigationShapes.ts::isNavigationResultFor`, commit branch around116–123, checks shape/material/generation but accepts a “successful” acknowledgement with a different page, hash, label, drifted status and confirmedRead=true. The frozen diagnostic changes those fields while preserving the generation and is accepted.

**Required:** success must agree with the actual request's complete page/hash/label/owner tuple, expected active status and reset confirmation. Validate set_read acknowledgement against its expected identity/generation/page/boolean and bookmark acknowledgement against its requested fields after R1. Reject malformed/mismatched replies as STORAGE_FAILURE. Keep legitimate refusal replies readable; refusal may return a newer tuple and must not be forced to match a stale request. Test each independently corrupted field, not only one combined object.

### M4S1-R3 [P1]: the native commit currently trusts a stale identity cache

**Source-audit finding; no additional native fault-injection reproduction claimed.** `inspect_identity_on` checks a managed PDF twice during inspection, but later `navigation_operation_at` calls `run_operation_on/commit` without reading the current managed file. `commit` only compares the supplied hash/page against material_content_identities. A file removed, relinked or replaced after inspection can therefore leave an old hash/count admissible. The current drift test explicitly re-inspects before checking state; it does not cover this gap. Bookmark creation/read confirmation also use that cache.

**Required:** establish a real native authoritative validation boundary for the file actually used by navigation, and revalidate identity/ownership at the final persistence boundary. Do not treat a separate earlier inspect result or a UI post-await check as authoritative. Refuse stale/missing/relinked content without falsely recording success; reconcile drift consistently. Document exactly which bytes/path a successful open request refers to and any unavoidable external-reader limitation. Add deterministic native tests replacing/deleting/relinking after inspection and before held open/save/retry. No app launch is needed.

### M4S1-R4 [P2]: moving the tamper fixture hides the older-schema refusal case

**Source/test review finding; original older-schema failure was reported by the implementer, not rerun here.** `src/data/skillEvidenceUpgrade.test.ts` now applies migration15 before tampering, so the existing “bytes are untouched” assertion only covers already-current databases. The actual schema14→15 invalid-input case has disappeared. `createNodeSqliteDatabase` applies migrations before validation, which explains the concern; it is a test driver, so do not infer a native production defect without checking that path.

**Required:** retain the genuine tampered schema14 refusal/nonmutation case separately from current-schema tampering. Exercise actual guarded native/browser open/restore behavior. Classify any inherited test-driver defect honestly and repair it in a bounded way where needed; do not change the input schema solely to make the original preservation assertion green. Do not extend scope to an unrelated migration rewrite without a concrete need.

## Verified now

- Typecheck: exit0.
- Existing navigation Rust tests: **22 passed**, exit0, on the actual worktree including the trim patch.
- Existing focused frontend suites: **13 passed / 1 failed**, exit1. The remaining failure is `currentSchemaVerification.test.ts`, which incorrectly compares the frozen schema14 helper against all now-registered migrations and assumes live ceiling14.
- New independent diagnostics: **0 passed / 2 failed**, exit1, reproducing R1 and R2. [Script](evidence/m4-slice1-partial-review-2026-10-16/diagnostics.mjs), [receipt](evidence/m4-slice1-partial-review-2026-10-16/diagnostics.log). The script uses TypeScript's transpiler on the exact source into disposable scratch modules and synthetic node:sqlite, not app data or an alternate implementation. Scratch copies are removed. Its two assertions are expected failures on this checkpoint and are not passing production coverage.
- Full frontend/Rust gates, shared fixture parity, controller/UI and installed behavior are **not independently verified by this review**. The implementer's earlier497-Rust claim is not substituted for a new full gate. Existing22 passing native tests do not cover the findings above.

The schema14 helper must stay frozen to14 and honestly refuse newer-schema input. Compare its pins to migrations1–14 and assert a newer-schema refusal separately. Never “fix” it by making the old helper accept15, deleting pins, bypassing identity gates, or pretending its old installed receipts cover15.

## Remaining delivery

Complete shared native/browser fixtures and tests; local epoch plus durable cancellation across real IPC; held opener/save/retry and failed cross-material reservation cases; accessible source links/bookmarks/manual page guidance/last-requested/read-confirmation/save-only retry; genuine upgrade/rollback/reopen/backup/restore/cascades and safety copies; exact final application gates and requirement map. Source pages without trustworthy provenance remain unresolved and cannot save guessed progress. Preserve the accepted104-case/24-mutant reference without copying harness-only attestation tests into the app.

No app/profile/provider/installer/signing/release operation occurred. The implementation worktree and previous M4 evidence worktree were not edited. [Continuation prompt](M4_SLICE1_CONTINUATION_PROMPT_2026-10-16.md).
