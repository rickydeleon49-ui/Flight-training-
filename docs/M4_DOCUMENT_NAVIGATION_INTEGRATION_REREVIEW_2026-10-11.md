# M4 preparation integration re-review

11 October 2026. **CORRECTIONS REQUIRED: M4-R9–R12. M4 production remains conditional.**

Subject: Gemini's local remaining-corrections package, `/Users/rickymac/code/Flight-training-m4-viewer-evaluation`, branch `codex/m4-navigation-viewer-evaluation`, base `c28ab8482c8635b0b2bf74686b081e02bf448f65`. Publication baseline: `75f9f9300d3f219b3870ef98699641f3d36b7138`. [Evidence and frozen 32-path submission](evidence/m4-document-navigation-integration-rereview-2026-10-11/README.md).

## Retained fixes and independent verification

Legacy numeric references now remain unresolved; unsafe inputs, explicit zero, string parent coordinates and known out-of-bounds ranges are rejected. Valid complete nested translations work. New missing-path intents supersede pending opens. The persistence callback exists, and file-backed reopen/cascade proofs work. Original receipts/manifest are archived **6/6 byte-identically**. The genuine PDF.js demonstration is a useful bounded Node parser proof; preserve it and do not rebuild a custom scanner.

- Current manifest **28/28**, previous review **40/40**, first review **29/29**, prior evaluation entries **21/21** verify.
- Submitted three suites on disclosed **Node26.10.0:22 passed**, exit0 (10 domain/parser,7 SQLite,5 illustrative sensitivity cases).
- Same submission on project Node22.23.3: **21 passed/1 failed**, exit1, with an unhandled `Promise.try is not a function` from PDF.js worker. This is a runtime limitation of this scratch engine proof, not evidence of an application failure. Record it honestly; no production polyfill or dependency adoption is requested.
- Earlier ten diagnostics against latest contract: **10 passed**, exit0.
- Previous 15-case diagnostic with import/fixture-location adapters: **14 passed/1 failed**, exit1. The remaining assertion concerns the old regex scanner; it is legitimately superseded by the new PDF.js page-tree test. Do not count this as an unfixed application bug or force that scanner to pass.
- New integration diagnostics: **14 failed/2 controls passed**, exit1. Assertions use actual current helpers and SQLite writes. Complete valid nested navigation and missing-path supersession controls pass.
- Current32 source paths reverified after review. Tracked production/dependencies/migrations/shared tracking remain unchanged; primary/M3 worktrees untouched. No application build, provider call or installed run.

## M4-R9 — P1: missing metadata still resolves, and real nullable lineage regresses

Latest `proof/contractModel.mjs:55–160,250–375`.

Physical/label resolution checks bounds only when a supplied count is already a safe integer; absent, null, NaN, infinite, fractional or string totals therefore bypass the check and resolve page42. A bare label map resolves without any count or content binding. Such input cannot become a verified destination.

The translator rejects `parentPageStart:null`/`parentPageEnd:null` even for valid first-level child-to-root navigation. Shipped schema13 represents absent parent ranges as nullable columns, so its normal row shape is broken. In the other direction, missing required root end is accepted, root-to-child succeeds without child material ID, and unchecked addition can return an unsafe integer when incomplete ranges slip through. Validation must depend on the requested coordinate space: permit legitimately absent unrelated parent fields, require complete relevant ranges/live ID/trusted count, and check result arithmetic. Unknown bounds can retain unresolved snapshot guidance, never a successful verified destination.

Six frozen R9 cases fail. Cover the actual schema13 row shape as a permanent positive regression, plus unknown/invalid bounds and content-bound label maps. Do not patch only the demonstrated values.

## M4-R10 — P1: stored identity replacement is not atomic with invalidation

Latest `proof/persistenceProtocol.mjs:39–57,79–97,113–179` and `contractModel.mjs:393–414`.

With active A/10, `addBookmark(page42)` inserts **verified**; `saveReadingState(page42)` inserts **active**. They validate positivity but never consult current persisted bounds/content. Hash-matching reconciliation still verifies when the count is unknown.

For A/50 with a verified page42 bookmark and active reading state, `saveContentIdentity(B/10)` independently commits the new cache while both navigation statuses remain verified/active on A. Even the separate reconciliation method updates bookmarks only, leaving old reading state active. A crash between the two calls exposes stale state. An identity+bookmark+reading transaction must be one public replacement operation, not an optional caller sequence. Public navigation writers must enforce current verified identity/provenance/bounds and preserve incompatible rows visibly unverified. Canonicalize hashes and distinguish unknown/missing content.

The lifecycle upgrade test inserts its material **after** `initFileDb` has already applied candidate DDL; it does not prove populated upgrade retention. The rollback case changes one reading row before a separate invalid insert; it does not fault the replacement protocol after identity/bookmark/reading changes. The backup test copies a closed SQLite DB, substitutes a constant hash and does not restore/check actual document bytes or exercise the older-binary schema refusal. Retain the real reopen/cascade proof but complete the claimed lifecycle proof through the actual protocol.

Four R10 diagnostics fail. Fix the reusable transaction protocol first, then test it directly with populated upgrade, changed/missing file snapshots, rollback, close/reopen and compatibility boundaries.

## M4-R11 — P1: generation checks fence notices, not durable writes

Latest `proof/openerController.mjs:115–143,166–179`.

Hold an old page42 persistence callback, successfully persist newer page3, then release the old callback. The controller returns old intent **aborted**, yet SQLite contains **42**, overwriting the newer choice. The check after `await injectedPersistence` cannot undo a committed stale write. Pass immutable operation/material/content ownership through a persistence contract that rejects obsolete writes at commit, or provide equivalent serialized/fenced commit semantics. Test actual final database state, not only the notice. The held-save diagnostic uses the current unfenced callback interface; a future callback adapter may implement the newly enforced commit contract, but must preserve the held-write order and final page3 assertion.

Progress is keyed by material ID only: after A/50 page42, replacing the same ID with B/10 and failing the next open exposes page42 from A. The public `lastRequestedPage` getter also exposes A after a failed B because currentMaterialId was never reset. The controller accepts page42 against material.totalPages10 and invokes the opener. Scope all progress and publication by content identity, update the active route/intent before validation, and consume validated bounded destination data.

Four R11 diagnostics fail. Preserve current early supersession and explicit abort. Add route A→B→A, delayed save failure, abort/unmount and content replacement tests across the durable boundary. Provide deliberate save-only retry for partial save failure; no opener replay and no false saved-position claim.

## M4-R12 — P2: finish replay, sensitivity, artifact and handoff evidence

The new runner still imports previous submitted snapshots for both diagnostic sets, expecting13 failures, rather than running those assertions against the latest modules. Latest equivalents do cover the original behavioral fixes, as independently verified above; update the runner to distinguish historical failure reproduction from current acceptance explicitly.

Five “mutants” are hand-coded alternate functions/classes and assertions that their wrong results occur. They are useful explanatory examples, but no submitted-module copy was mutated and no unchanged regression suite was shown failing against it. The planned `mutants/` directory is empty. Produce actual temporary module-copy guard reversions with baseline exit0/mutant exit1 receipts and a final untouched-source hash check.

Scratch `package.json` allows `^6.3.289`; no committed lock/registry integrity, package notice inventory or engine/worker asset hashes were supplied. Review observed installed version6.3.289 and hashed assets separately, but that is not Gemini's requested artifact audit. Claims about exact package/font notices remain unsupported by submitted artifact records. Capture exact reproducible scratch resolution, relevant LICENSE/NOTICE files and bundled/transitive asset inventory without copying node_modules into git. Give all parser tasks `finally` cleanup, including rejection paths; do not describe destroyed task handles as measured buffer release.

The report/conditional prompt must reflect one atomic replacement protocol, content-bound maps, bounded validated destination records, content/intent-scoped durable-save fencing and save-only recovery. Include changed/missing backup files and older-version refusal. Record actual Node26 success and Node22 scratch limitation. Keep owner defaults OD-1–OD-10 proposed and M4 production conditional. The latest package lacks a full source manifest covering top-level changed reports; complete it after final edits and replace “all resolved” with the evidenced outcome.

## Next step

Execute [one active model-neutral integration correction assignment](M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_PROMPT_2026-10-11.md). It supersedes the prior remaining-corrections prompt for this submission and retains successful R5–R8 work. Owner-approved M3 production continues separately. G1–G3 stay deferred/unexecuted/unverified; no release or M4 production approval is granted by publishing this review.
