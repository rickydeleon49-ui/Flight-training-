# M2 Card Reviews C2 — Complete bounded enrichment and read ownership (7 October 2026)

You are the owner's selected implementation model. Complete this single narrow correction package with precise work and good pace. Read [the latest independent review](M2_CARD_REVIEW_C2_STATE_PUBLICATION_REREVIEW_2026-10-07.md) and the frozen diagnostic before editing. This is model-neutral. Earlier correction prompts are historical.

## Starting state and preservation

Use `/Users/rickymac/code/Flight-training-pr70-integration`, existing dirty `codex/m2-card-review-c2-scope`, expected HEAD `9028675475616ce338253ae7e4e46ba6b840b72c`. Fetch origin; read reviewer documents with `git show origin/main:<path>`. Do not pull/reset/stash/switch/rebase or copy main files over the dirty checkout.

Verify all **39** paths in `origin/main:docs/evidence/m2-card-review-c2-publication-rereview-2026-10-07/submitted-source-hashes.json` before edits. Report competing mismatches before touching affected files and preserve legitimate completed work.

Keep all **eight** submitted packs byte-identical: `m2-card-review-c2-scope`, `scope-corrections`, `scope-completion`, `final-corrections`, `read-pipeline-corrections`, `bounded-read-corrections`, `contract-finish`, `state-publication` (each under `docs/evidence/`, suffixed `-2026-10-07/`). Create `docs/evidence/m2-card-review-c2-enrichment-corrections-2026-10-07/`. Write improved proof, tests and new receipts only there; retain production pure-module imports.

All **74** frozen cases and **57** submitted proof cases pass. Preserve those demonstrated fixes, mutation controls, failed due parse reservations, warning publication, authoritative resets, pending traversal, ranking/filters, canonical clocks, priority domain, independent prior-page targets and version-aware resolved patches. Do not rewrite verified architecture.

C2 scope remains unaccepted; D1–D9 proposed. C1 acceptance and existing owner decisions persist. No production C2, schema/index/dependency, app/native launch, installed/signing/release/mobile work. Finish all requirements here, leave uncommitted/unpushed, and stop for independent review.

## C2-E1: One bounded, filter-owned enrichment pipeline

Four frozen failures demonstrate unfinished requirements:

1. Target b outside `materialId: a, topic: one` still resolves and reads raw b. Apply active material/topic predicates in target selection before raw fetch. Target publication must remain owned by that query and loaded view. Validate history material/topic context before SQL (material nullable string <=64; topic nullable string <=256), consistent with generated contexts.
2. 251 distinct targets are accepted with no bound. Validate target-array shape/elements; IDs must be nonempty strings <=64. Deduplicate; reject >250 distinct targets with `INVALID_INPUT` or `INVALID_TARGET` before SQL. Reject malformed request shapes instead of silently dropping invalid members. A controller with more pending loaded materials must choose a bounded batch and retain the rest fairly.
3. History ignores `maxBatchCardsBudget`: three malformed 500-object targets all parse under budget 500. Add the already requested history attempted-work policy to its typed input. Use one cumulative per-call ledger across explicit targets AND normal event-page enrichment. Reserve MAX_CARDS before every raw parse, retain charge on failed parsing, reconcile valid successful sets to actual card count. Keep byte preflight and absolute 8 MiB per-set ceiling. Report real raw reads/bytes and attempted/evaluated cards. Default card work 2,500; honor smaller supplied budgets. Unread valid or malformed targets stay reachable as pending. Shared admission must not double charge/read a material appearing as both target and page member.
4. Controller `limit:0` is clamped to 1, still scans events and can read unrelated content. Add explicit typed `enrichmentOnly: true` or a dedicated bounded read entry point; controller enrichment must use it. In enrichment-only mode perform no event query, no raw reads for unrelated page members, return no paged events and do not move cursor/order. Preserve the existing combined page-plus-target reader API for frozen tests and callers.

Use actual rawAttempts, not target position or emitted patches, to determine the one-set forward-progress exception. Missing/deleted/oversize metadata cannot consume it. Avoid retry livelock after a metadata-only prefix. Explicitly document target-vs-page priority and fair pending continuation. Default controller enrichment should select only still-retryable pending targets, not repeat already resolved or permanently blocked ones.

Promote cases 1–4. Extend with context/topic-only/material-only filters, malformed inputs rejected before SQL, bounded 251+ loaded pending rows, failed/valid work reconciliation, metadata prefixes, combined cumulative caps, no duplicate raw reads, terminal/prior-page targets and repeated multi-target completion. Measure the real reader path.

## C2-E2: Complete status-aware patches and actions

`_applyEnrichment` currently treats null currentVersionId as proof of an earlier version, leaves old block reasons on successful resolution, and drops inspectionTarget.

Use a coherent discriminated patch contract:
- For readable current identity, compare each loaded event.versionId with patch.currentVersionId. Keep known earlier/current behavior already passing.
- For unread budget-deferred or oversized content, preserve `isEarlierVersion: null`; do not manufacture an Earlier version badge. Distinguish retryable pending from permanent blocked reason.
- A resolved patch clears obsolete blockedReason and inspection action even when the reader did not explicitly send a reason field.
- A blocked patch publishes its reason AND actual read-only inspectionTarget through the same ownership boundary.
- Preserve resolved untargeted fields within a live generation; authoritative invalidation clears stale provenance across generations.

Use one helper producing `/study/${encodeURIComponent(materialId)}` for every due issue/history blocked action. Existing templates interpolate directly despite README's encoding claim. Preserve existing registered routes; do not add a production route. Freeze case 9 requires `a/b` -> `/study/a%2Fb`.

Promote cases 5–7 and 9. Add end-to-end real reader→controller coverage for pending→current, pending→earlier, malformed/empty/missing, budget and permanent oversize, with unknown identity, reason/action reconciliation and unchanged event order/cursor. Retain the new known-version control.

## C2-E3: Retry the most recent owned failed read

Reproduction: enrichment A fails, page B fails, Retry resends A because `lastFailedEnrichTargets` survived. Fix both directions and intervening successes.

Replace independent mutable failure markers with one discriminated failed-read descriptor (page/enrichment, cursor or targets, owned options/query snapshot). Record only live generation+operation failures. Clear on live success and authoritative invalidation; supersede on a new live failure. Retry dispatches exactly that descriptor without writes. Install the synchronous operation lock before reader invocation and retain all old ownership guards.

Promote case 8. Add synchronous/asynchronous page→enrichment and enrichment→page failures, success between failures, held old/new generations, reset/filter changes, same-turn duplicate exclusion and synchronous re-entry. Obsolete callbacks cannot poison Retry or clear a newer lock. Tests must inspect actual reader calls and resulting controller state.

## Correct delivery contracts and claims

Align scope, conditional implementation prompt, STATUS and PROJECT_HANDOFF with executed inputs/results/actions. Include top-level due issues, currentVersionId/blockedReason/inspectionTarget, nullable-vs-array enrichment behavior, shared work counters and explicit enrichment-only mode. Remove required type fields that records do not supply or actually supply them. Avoid a misleading independent isEarlierVersion on material patches; event comparison belongs to the controller.

Align oversize status descriptions with the chosen executed pending+blocked or unavailable representation and exclusions from automatic Retry. Clarify page summary versus loaded cumulative summary; implement cumulative counts if still promised, or explicitly scope summary as the latest page without claiming whole-library totals.

Correct historical C1 source PR reference to #111, not #70. Correct the 177-call audit label to `due_today`, not `new_only`. Preserve benchmark approximate-component labels and unmeasured IPC/WebKit caveat. Resolve report/README suite names and traversal page counts against raw receipts. Update snapshots after final live-document edits.

## Focused verification and handoff

Read/copy `origin/main:docs/evidence/m2-card-review-c2-publication-rereview-2026-10-07/diagnostic.test.mjs` unchanged. Reproduce submitted baseline: **1 control pass / 9 assertion failures**, exit 1.

Use `/opt/homebrew/opt/node@22/bin/node --experimental-strip-types --test <file>` from repository root; `C2_REVIEW_MODEL` points to the new pack's `proof/contractModel.mjs`. Run all eight frozen files unchanged: review, rereview, completion-review, final-review, pipeline-review, bounds-rereview, contract-review, publication-rereview. They live under `docs/evidence/m2-card-review-c2-<name>-2026-10-07/diagnostic.test.mjs`. Expected **84 passes**, zero failures.

Run the improved focused proof, mutation baseline/four assertion-killed mutants/survival control, actual SQL/work accounting including enrichment-only and combined calls, and representative final-reader timing. Do not rerun unchanged application/native/Xcode suites. Keep all old guards meaningful; disclose any justified expectation change. Do not weaken tests, suppress errors, fabricate counters, or treat shell-loop final exit as proof every child passed.

Deliver a complete report/README mapping all findings to exact tests and evidence; raw commands/cwd/toolchain/stdout/stderr/exit receipts; four live-doc snapshots; source-hashes and SHA256SUMS. Verify all eight prior packs unchanged and new manifest/checksums correct. Mark “corrected, pending independent review,” never accepted. State exact HEAD/branch/staging/commit state and leave uncommitted/unpushed. Complete this entire package before stopping; do not start another roadmap item or request redundant owner permission.
