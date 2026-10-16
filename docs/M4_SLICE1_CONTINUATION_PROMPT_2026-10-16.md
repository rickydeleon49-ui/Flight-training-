# Continue and finish M4 Slice1 — model-neutral assignment

## Goal and authority

Finish the saved M4 production implementation as one coherent source PR, including the four review findings. Codex remains the independent reviewer/integrator. Do not self-merge. All ten production defaults are now directly approved by the owner, including OD-6 refuse-and-explain; do not ask for those same decisions again. This is source implementation/testing authorization, not release or app/profile authorization.

Read current origin/main versions of:
- `docs/M4_PRODUCTION_SCOPE_OWNER_APPROVAL_2026-10-16.md`
- `docs/M4_SLICE1_PARTIAL_REVIEW_2026-10-16.md` and its frozen evidence/diagnostics
- `docs/M4_SLICE1_CURRENT_HANDOFF_2026-10-16.md`
- `docs/M4_PRODUCTION_SCOPE_DECISIONS_2026-10-16.md`
- `docs/M4_ROUND6_ACCEPTANCE_2026-10-16.md`
- Latest STATUS, ROADMAP and PROJECT_HANDOFF.

Use the accepted round6 prototype in `docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/`; the old conditional three-table draft is historical and superseded.

## Resume the actual saved work

Worktree: `/Users/rickymac/code/Flight-training-m4-slice1`
Branch: `claude/m4-slice1`
Saved base:011684e; local checkpoints ed82811 and **07fdcfa6593898efe9d6a979bae11095ce1fbf80**.

Fetch first. Inspect branch/status and verify all20 file hashes from `docs/evidence/m4-slice1-partial-review-2026-10-16/submitted-snapshot.json` before editing. The worktree has one intentional uncommitted `navigation.rs` change: use `card_reviews::js_trim` for native/ECMAScript string-decoder agreement. Preserve it; its exact patch is in `preserved-uncommitted.patch`. Report any identity mismatch and inspect it before touching that path. Never apply the saved patch over already-matching code.

Do not reset, stash, clean, force-push, discard the checkpoints or replace the implementation with a new prototype. If there is no competing change, checkpoint the reviewed trim patch in its own small commit, then merge current origin/main into this branch. The owner-approval documents will arrive through that merge; do not recreate them from an agent's earlier claimed approval. Main includes PR#187's accepted `backup.rs` folder-opening fix: preserve both that correction and the schema15 additions when resolving conflicts. Recheck migration15 is still available; if another source change consumed it, stop that dependent migration edit and report the actual collision rather than overwriting a shipped migration.

Use only this implementation worktree for feature code. Leave the primary clone, the preserved M4 prototype worktree, released installers, test builds and all app profiles untouched. Use synthetic scratch databases/PDFs only.

## First close the concrete findings

Read the review's precise code locations and sequences. Do these coherently before layering UI on top:

**M4S1-R1 — content-bound actions.** Add expected content hash and exact saved owner generation, or a demonstrated equivalent CAS tuple, to read-confirmation requests. Reject stale confirmation and clearing transactionally, even when old and replacement content have the same physical page. Bind bookmark creation to the content the user saw as well. Keep native and TypeScript decoders/results/driver interfaces in sync. Add positive cases plus held A→B same-page and same-content/newer-generation regressions in both backends/shared fixtures. Refusals leave complete tuples unchanged.

**M4S1-R2 — exact acknowledgements.** Strengthen success adapters to validate all request-bound fields, not only material and generation. A successful commit must match page/hash/label/owner and expected active/unconfirmed state. Read-confirmation and bookmark success must match their request semantics. Corrupt each relevant field independently and require STORAGE_FAILURE. A legitimate refusal may return current/newer state and must remain representable. Promote both frozen diagnostics to permanent tests. Preserve the original failing receipts; if request shapes change, adapt the test setup transparently and retain the same failure scenario rather than weakening the assertions.

**M4S1-R3 — real-file validation.** The current inspector's two reads only protect the inspection call; later commit trusts the cache. Establish an authoritative native check covering the managed file actually opened and the final persistence boundary. Reject deletion, replacement or relinking after inspection; do not let a cached identity authorize a different/missing file. Cover held open, held commit and save-only retry with deterministic native faults. Reconcile drift atomically. State the guarantee precisely around actual native operations; do not claim control over the external reader's future file reads or automatic native page jumps. An earlier inspect call, caller-provided hash/count or UI-only after-await guard is insufficient.

**M4S1-R4 — honest invalid-input preservation tests.** Restore the genuine tampered-schema14 case alongside current-schema tampering; do not move the only specimen to15 merely to recover green tests. Check real native/browser guarded open/restore behavior separately from the test-driver path. If a pre-existing test-driver defect is confirmed, make a bounded correction where necessary or clearly track it with evidence; do not silently rewrite unrelated migration infrastructure. Prove refusal does not damage the original library or discard its safety copy. Keep all prior useful cases.

## Complete the feature

1. **Shared contract and domain tests.** Finish `src-tauri/fixtures/navigation/` (or the actual agreed location) and run the same cases through native and browser/test operations. Include strict shape/numeric/Unicode limits, null originating hashes, page bounds, printed labels bound to exact content, unknown provenance, first-level nullable lineage, child/root/parent coordinate translation, deleted ancestors, claim rollback/postconditions and drift. Relevant production behaviors from the104-case prototype must map to tests; runner attestation/install checks stay in their evidence harness.
2. **Controller and actual asynchronous boundary.** Retire old work at new intent entry before any new ownership read/reservation can fail. Separate local epochs from durable tokens. Preserve increasing exact reservation/read-back semantics. Cover newer intent on a different material failing its ownership lookup, held old opener/native commit/save-only retry, abort/unmount and save failure. Define and test the actual native cancellation/commit ordering; a JavaScript cancellation closure cannot be serialized through Tauri. Do not claim UI suppression prevents a write that already occurred. Provide visible save-only retry without reopening the PDF; failed or obsolete operations cannot publish success or advance read progress.
3. **Accessible UI.** Add clickable source badges in the existing four study views and a material pages panel with bookmark add/list/jump/delete, explicit physical-page entry, last-requested page, separate mark-as-read control and retry. Follow current components/modal/focus behavior. Unknown Gemini/source numbering opens the existing document with clear guidance and saves no guessed position. Invalid/out-of-range/unverified references are refused and explained, never clamped. Keep missing-file restore/locate actions reachable. Keep the default system reader and be honest when a page jump is guidance only.
4. **Persistence and compatibility.** Complete all four navigation tables across native/browser validation, backup/restore and cascades. Prove populated14→15 retention, exact ledgers/checksums, failed-upgrade rollback, reopening, all-four-table round trip, malformed schema refusal, prior safety copies and older-binary refusal. Do not edit migrations1–14 or their checksum records. Only an as-yet-unshipped migration15 can be adjusted coherently in this feature.
5. **Frozen helper compatibility.** The schema14 helper remains pinned to14, its original migration bytes and its identity guards. Update `currentSchemaVerification.test.ts` to compare the historical pins only with the registered1–14 prefix, while retaining byte/checksum assertions; check the current application ceiling separately. Add an explicit newer-schema refusal/alarm case. Run the helper's own26-case suite and change expectations only where the documented later-schema alarm requires it. Do not repin the old helper to15, broadly relax guards or rewrite old installed evidence. Refresh only current manifest bindings affected by actual edits, leaving historical receipts intact.

## Work and verification order

Work through these stages without waiting for another owner check-in between routine steps. Run focused regressions as each boundary is completed. Then run one final sequential application gate on final source, using the repo's Node22 tooling and scoped SDK26.5 where needed:

```bash
npm run typecheck
npm test
npm run build
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npm run test:cargo-lock
node --test scripts/mac-schema14-profile-snapshot.test.mjs
git diff --check origin/main...HEAD
```

Before committing, use `git diff --check origin/main` to cover both committed and working changes. Verify relevant checksum manifests with their actual paths. Preserve original failed runs separately from the final corrected gate. Do not add suppressions, broad timeout increases, retries, expectation weakening or production bypasses to obtain green results. Do not count prototype tests as production tests or source tests as installed tests.

Do not repeatedly rerun the complete suite on identical source. Repeat affected checks after real changes or new failures, and ensure the final exact PR head passes normal CI. If provider/auth infrastructure or a new scope decision blocks one part, finish independent authorized work and report the concrete blocker rather than fabricating success or expanding scope.

## Deliver and stop

- One coherent source PR with the completed feature and fixes; do not push a knowingly incomplete/red source package merely to hand it to another model.
- A concise report with exact head/base, all source hashes, R1–R4 issue-to-test mapping, native/browser parity, scope coverage, raw gate exits, failed-versus-final receipts and remaining limitations.
- Reconcile current ROADMAP/STATUS/PROJECT_HANDOFF by adding current entries while preserving history. Refresh only necessary current helper bindings and checksum manifests.
- Confirm no leftover temporary diagnostics, altered app data, native builds or unrelated changes. Preserve original checkpoint/failure evidence.
- Push and open the PR, wait for exact-head CI, and stop for Codex review. No self-merge, new roadmap feature, new dependency, version bump, provider call, app launch, test-account operation, native installer build, signing or release publication.
