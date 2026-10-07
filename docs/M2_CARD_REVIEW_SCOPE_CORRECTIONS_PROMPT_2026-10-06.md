# M2 card-review scope/proof corrections — model-neutral assignment, 6 October 2026

You are the owner-selected implementer. Complete CRS-R1/R2 in the prepared scope and disposable proof, leaving production files untouched. Any model can execute this prompt. Preserve the good scheduler/identity/research work and finish one approval-ready package. Codex remains reviewer and Git coordinator.

## Authority and starting state

Read [independent review](M2_CARD_REVIEW_SCOPE_REVIEW_2026-10-06.md) and its [frozen evidence](evidence/m2-card-review-scope-review-2026-10-06/README.md). This is the **only active task**. The published C1 prompt remains conditional and must not execute until corrected scope acceptance AND explicit owner approval of C-D1–C-D8 are recorded. Existing practice-session approval/check-in waiver does not authorize new card production persistence or an FSRS dependency.

Use `/Users/rickymac/code/Flight-training-pr70-integration`, branch `codex/m2-card-review-scope`, with uncommitted preparation based on main `df7a130`. Codex published the draft/review in an isolated docs-only branch without altering this checkout. Fetch and inspect status; verify all four proposal/status hashes and 16 original evidence hashes against the frozen submitted manifests before editing. Do not pull/reset/rebase onto the dirty work, apply snapshots/stashes, touch the separate primary clone or launch a competing agent. Stop only before overwriting unexpected competing work on affected files; continue independent research if possible.

The submitted 27 tests already pass independently. Preserve their meaning. No repeated FSRS survey, dependency install, full application gate, stress matrix or new feature is needed. Keep C-D1–C-D8 defaults unless an actual engineering contradiction requires an explained change; do not silently alter retention, intervals or scheduler choice.

## 1. CRS-R1: one precise, version-owned due-query contract

The scope's `due_at <= endOfLocalDay` admits Again before ten minutes. Its material-only filter also returns old-version states. `isDue` already has the right distinction; fix the repository design and prove that boundary rather than rewriting scheduler arithmetic.

Define a query API receiving material/currentContentHash or derivedVersionId, injected nowUtc, current time zone or an exclusive next-local-midnight UTC boundary, and bounded limits. Document exact timestamp format and strict end-boundary behavior. State how the browser and native read path obtain the same current raw card identity without persisting anything during a read.

Required eligibility:

- Only items from the **current raw card set's derived version**. Do not trust the lazy stored `is_active` marker alone: regenerated B can be current while only A is materialized. B's unmaterialized cards are eligible as new; A is retained history, not current due work. If raw text later becomes A again, reuse A's retained schedule as C-D3 specifies, unless it was reset/deleted.
- Again/relearning step: due_at <= nowUtc. Never count or return it at minute nine; it becomes eligible exactly at minute ten.
- Day-ladder step: due_at < nextLocalMidnightUtc (exclusive), preserving the current-calendar-day rule. Compute the boundary using the current zone, including daylight-saving transitions; stored UTC instants remain unchanged.
- Suspended and flagged items excluded before sorting/limits; first-use new cards must also respect these exclusions.
- Required order: eligible Again steps by due instant, other due items by due instant, new items by ordinal. Specify stable ID/ordinal tie-breakers and apply at most 10 new/20 total **after** eligibility. Say whether the session cap counts unique presented cards or acknowledged ratings; choose the smallest coherent rule and ensure same-ID replay does not count twice.
- Recent review history may intentionally include earlier versions, labelled honestly. Do not globally filter it away just to repair the current queue.

Add a bounded query-boundary proof using disposable `node:sqlite` and representative schema rows (not a production migration). Export the proposed query/helper so assertions execute the corrected query. Demonstrate minute-nine/minute-ten, next-midnight exclusion, old A/current B with materialized B, B before first materialization, A→B→A, flagged/suspended new cards, and limits/order with many ineligible old rows preceding eligible current rows. Include one DST boundary case. These are targeted examples, not a large performance matrix.

Update the scope's query/schema sketch, getDueQueue signature, C1 repository/UI/testing instructions and acceptance mapping together.

## 2. CRS-R2: reset has a persistent non-content generation barrier

Tombstones cannot reject an old request that never committed. Deleting projections resets item revision to zero, and later revisions can collide with old requests. The model also crashes on repeated erase by reading result.itemId after result became null.

Use a persistent material review generation, or document/prove an equally safe monotonic design. A generation is an engineering guard for C-D4, not a new product default. The preferred design is explicit:

- A material's current review generation has a read representation even when no item has been rated. Every newly intended item action and reset captures expectedGeneration, in addition to expectedRevision where applicable.
- A reset checks the generation, atomically advances it, deletes that material's projections/events, prunes old snapshots according to the **actual current raw card set**, tombstones old receipts and stores the reset's replay receipt/result. Keep current raw cards and study guide; practice history and unrelated materials remain untouched.
- Same-ID replay is resolved before changing anything. Preserve conflict/erased precedence consistently with the accepted conventions. A retried committed reset never advances the generation again and never erases work created afterward. A new intentional reset with the current generation may apply again.
- An uncommitted pre-reset rating at revision 0 is rejected after reset. A pre-reset revision-1 request remains rejected after a legitimate new-generation rating has reached revision 1. A fresh request after refresh is accepted.
- Keep receipt routing metadata (material, generation, action/hash) separate from nullable result content. An already tombstoned receipt must be skipped/handled safely during later erasures; never dereference null. Preserve enough non-content metadata to reject late replay without retaining card text or ratings.
- Reset is its own strictly typed action branch. It does not have itemId/versionContentHash merely because item actions do. Specify exact payload/result/error fields and native/browser transaction steps, including generation-refusal behavior.

Extend the disposable model with reset generation and the relevant typed request shapes. Prove both rejected stale-request cases above, repeated reset, identical committed-reset replay after a new rating, changed-payload reuse, fresh post-reset work, unrelated-material isolation and safe tombstones. Refusal must leave projection/event/receipt counts unchanged. This remains a simulation; it does not establish native/browser durability.

Revise the schema sketch, read payloads, action/result/error unions, canonical request identity, backup/startup invariants and C1 prompt in lockstep. The future production test list must require real native/browser reset versus queued rating, reopen/replay and rollback proofs. Do not write migration 12 or change CURRENT_SCHEMA_VERSION in this task.

## 3. Complete the handoff details within existing scope

- Add the explicit **Reset card reviews** UI and confirmation to C1. Name what resets, current cards that remain and old backups that are unaffected. Include pending/unknown same-ID retry and read-only reconciliation states; no automatic second reset.
- First suspend/flag must work on never-rated cards. Materialize frozen identity on the first relevant mutation, not only rating, and use timestamps that distinguish snapshot creation from first review. Nullable due/last-review state must be defined without a fabricated rating event.
- After acknowledged write or replay plus failed refresh, the UI may show confirmed acknowledgement, but conflicting editing/advance stays locked until current authoritative reads succeed. Historical replay results cannot stand in for the current generation/revision. Retry refresh sends reads only.
- Make validators check item/version/material ownership, reset generation, typed receipts/tombstones, and event/projection consistency, not just JSON syntax. Describe the required shared accept/refuse fixtures in the conditional C1 prompt.

## 4. Verify once, retain original evidence, stop

The reviewer baseline has **27 submitted passes plus five targeted failures**, all against a planning query/model. The frozen diagnostic embeds the original bad SQL and imports a frozen submitted model. It is meant to preserve the failure; do not demand it turn green unchanged. Promote/adapt the five behaviors to the corrected exported query/model, retaining the failure injection and expected outcomes. If adding generation fields makes an old input invalid, construct the legitimate pre-reset payload with its captured old generation instead of replacing the stale-request test with an invalid-argument assertion.

Keep original receipts, snapshots and manifests unchanged. Write NEW correction evidence under `docs/evidence/m2-card-review-scope-corrections-2026-10-06/` (use a current dated path if the task runs later). Updated proof files may remain in the existing proof directory; keep its earlier receipts and manifest explicitly marked as frozen pre-correction snapshots, and point readers to a new current manifest rather than silently relabeling old receipts. Do not edit frozen reviewer evidence.

Run the corrected proof once after edits settle, then tracked/new-file hygiene and a production-source-unchanged comparison against the reviewed base. Preserve actual failed attempts. Record commands/exits and distinguish pure scheduler, SQLite query proof and in-memory operation model from application/native/installed guarantees. No full app test/build/Rust matrix for this preparation task.

Deliver the corrected scope, all eight recommended defaults together, updated complete conditional C1 prompt, exact CRS-R1/R2 requirement-to-test map, new raw receipts and distinct proposal/evidence manifests. STATUS/handoff should say **scope corrections prepared, pending independent re-review and owner production approval**. PR2 acceptance remains unchanged.

Leave all changes uncommitted/unpushed for Codex. No production dependency, source/schema/config/workflow change, provider/profile/account test, app launch, signing, packaging, version or release work. After review accepts the corrected package, the owner can approve all defaults once and activate C1.
