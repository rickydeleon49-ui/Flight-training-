# M2 Card Reviews C2 — Finish state publication and targeted enrichment (7 October 2026)

You are the owner's selected implementation model. Complete this narrow correction assignment in one coherent package. Read [the latest review](M2_CARD_REVIEW_C2_CONTRACT_REVIEW_2026-10-07.md) first. Keep pace by preserving verified work and fixing the precise unfinished contracts below. This is model-neutral; earlier correction prompts are historical.

## Start and preservation

Use `/Users/rickymac/code/Flight-training-pr70-integration`, existing dirty `codex/m2-card-review-c2-scope`, HEAD `9028675475616ce338253ae7e4e46ba6b840b72c`. Fetch origin and read new documents with `git show origin/main:<path>`. Do not pull/reset/stash/switch/rebase/apply main files over the dirty checkout.

Before editing, verify all **45** paths in `origin/main:docs/evidence/m2-card-review-c2-contract-review-2026-10-07/submitted-source-hashes.json` (bare path-to-SHA256 map). Report competing mismatches before touching affected files; preserve legitimate completed work.

Preserve all seven existing submitted evidence packs byte-for-byte: `m2-card-review-c2-scope`, `scope-corrections`, `scope-completion`, `final-corrections`, `read-pipeline-corrections`, `bounded-read-corrections`, `contract-finish` (each suffixed `-2026-10-07/`, under `docs/evidence/`). Create `docs/evidence/m2-card-review-c2-state-publication-2026-10-07/` for the improved proof/tests/receipts. Keep relative production imports and write tool receipts only to the new pack.

Update the four live delivery docs at completion: scope, conditional implementation prompt, STATUS and PROJECT_HANDOFF. Keep C2-D1–D9 proposed until independent acceptance and recorded owner approval. C1 acceptance and the prior waiver persist. No production C2, migration/index/dependency, provider, app/native launch, installed/signing/release/mobile work. Leave changes uncommitted/unpushed for the reviewer.

## Preserve verified fixes

All **67** frozen cases and **46** submitted proof cases pass; baseline/four semantic mutants/survival control work. Preserve exact current-version/C1 parity, filters/ranking, pending consumption, authoritative reset, synchronous/asynchronous operation ownership, Retry, history identity/provenance/reopen/upgrade, reader explicit oversized-content outcomes, absolute history cap, valid mixed-size admission, completed cursor-field and scheduler/date/count fixes. Keep approximate benchmark labels and corrected sibling links. Do not rewrite the controller architecture; add the missing publication/enrichment state coherently.

## 1. Spend attempted work reservations, including failed parses

Current guard checks `cumulativeCards + 500`, but no work is charged when `parseSavedCards` returns malformed. Three 500-object arrays with invalid back fields are all fetched/parsed under a 500-card budget; three reads, zero evaluated cards, terminal cursor. New frozen case 1 fails.

Use a separate attempted-work counter. Before each raw fetch/parse, reserve production `MAX_CARDS` under the remaining card-work budget. Keep that reservation spent if parsing fails; a successful valid set may reconcile the reservation to its known parsed count. Do not refund failed work to zero because it emits no cards. Keep metadata-only oversize/deleted candidates distinct from raw parse attempts.

For example: budget 500, failed first parse charges 500; candidate 2 remains unread and reachable by cursor. Budget 600, valid first set of 400 charges 400 after reconciliation; next set cannot reserve 500, so stop before fetching it. Retain the documented one-set exception when a requested budget is smaller than one legitimate set, admit at most one bounded unit, then stop. Base that exception on actual raw-work admission, not emitted-row count or a preceding metadata-only warning.

Publish counters with precise semantics: attempted/reserved work, valid parsed/derived cards, raw reads/bytes, candidate metadata and emitted rows. Bound malformed/ineligible initial and pending traversal. Promote case 1 and add pending failed parses, oversized/deleted prefixes, small-budget lane, valid reservation reconciliation and full traversal equality tests.

## 2. Publish issues and summaries through the owned controller

`DeferredReadController.loadNextPage` currently ignores `res.issues` and summary. A warning-only terminal reader result becomes empty controller results with no warning. New case 2 requires `controller.issues` to retain the issue.

Add typed state for issues and relevant page/loaded summaries. Publish only under the existing exact generation/operation guard. Retain earlier-page issues while loading more; deduplicate/reconcile using material/code identity. Authoritative reset/filter/content/delete/restore/clock invalidation clears obsolete metadata along with results, and fresh reads rebuild it. Obsolete completions cannot publish warnings or clear a newer lock.

Keep `isComplete` as event/candidate traversal exhaustion if that is its defined meaning. Define a separate caught-up/blocked display rule: terminal empty materials plus issues must display reported unavailable content, not “All caught up.” Tests must exercise the real controller publication path, not just the reader object.

Fix warning inspection targets from `/materials/<id>` to the existing `/study/<id>` route, or a typed existing read-only target. Current production route is `study/:materialId` in `src/App.tsx`; `/materials` reaches NotFound. New case 3 asserts `/study/a`. Use safe path encoding for actual supported IDs. Do not add production routes for this planning fix.

Promote warning publication/route cases and add multi-page issue retention, stale-warning rejection, reset reconciliation, warning-only terminal state and Retry behavior. Preserve all earlier ownership regressions.

## 3. Make history enrichment independent of event pagination

Current `enrichMaterialIds` merely sorts IDs in the already selected event page. Two confirmed failures:

- First page `c,b` (limit 2), b deferred; request next event page with target b => only a is queried, b is unreachable.
- First page b current / a pending; target a => a current / b pending. Returning whole untargeted rows regresses previously resolved provenance on replacement.

New frozen cases 5–6 fail. Implement a bounded target-selection/enrichment stage independent of current event-page membership. Keep the existing public request compatible, but return target-only updates in an explicit `enrichment` array alongside paged `rows`/`next`. Do not insert prior-page events into the new event page to make the test pass.

Recommended design: enrichment records carry material identity, validated current content identity/status and any blocked/deferred reason; or return equivalent bounded per-event patches. Include `currentVersionId` when content identity is available so the controller compares each loaded event's own version ID. Do not mark every historical event “current” merely because the material now has readable cards. Oversize stays unknown/blocked, with explicit reason/action rather than endlessly retryable pending.

Bound and validate requested target IDs, query context and results. Query target headers/raw data directly under the existing absolute byte and work policy; do not fetch all historical events or all materials. Apply topic/material ownership consistently. Distinguish normal page enrichment from explicitly requested patch work and document a single cumulative per-call budget; if requesting both next-page rows and target patches, specify priority and retain unfinished work fairly.

Add a separate controller read action for pending enrichment, callable even when event traversal is complete. Keep cursor/results order and event IDs unchanged. Apply only scoped target patches to loaded events, preserve resolved untargeted fields, and do not append duplicate events. Use the same generation/operation ownership principles: same-turn duplicate exclusion, stale completion rejection, targeted read-only Retry without write replay. Separate event completion and enrichment completion. Authoritative invalidation still clears stale provenance; preserving untargeted fields within a live generation is not permission to retain them across content invalidation.

The frozen test accepts `enrichment` records with `currentVersionId` or a compatible resolved row contract. Verify the real controller action, not a hand-merged array in a test. Add prior-page and terminal-page enrichment, unchanged order/cursor, retired-version events, unavailable/valid-empty/malformed/oversize status, failure→Retry, held old/new generations and fair multi-target completion. Keep the existing standalone same-page enrichment proof working, adapting expectations explicitly to the patch contract where necessary.

## 4. Finish the supported priority domain and input contract

New case 4: due cursor `lp: 2` is accepted although SQL key ranks are only 0/1. Require `lp === 0 || lp === 1` before SQL, otherwise `INVALID_CURSOR`. Preserve kind/version/context/key/ID-size/duplicate/canonical date checks already fixed.

Finish the already requested query normalization: supported status-filter values, typed/bounded topic/material contexts, canonical query clock instants, finite bounded integer options and compatible page-size changes. Reuse production canonical helpers; reject invalid input before SQL. Avoid a second independent validator with divergent accepted values. Add direct negative cases and keep generated cursors consumable.

## 5. Accurate final contracts and evidence

Update typed inputs/results, controller actions, issue/caught-up rules, real routes, target-only enrichment, per-call work counters and pending-versus-blocked behavior in scope and conditional prompt. Keep no-additional-C2-migration statement; schema-11 upgrade still executes shipped 0012.

Actual independent SQL calls on the submitted fixture are due **175 / 150 / 177**, history **22 / 22 / 22**. The pasted handoff's three-statement claim is false; distinguish metadata/state stages from per-set raw executions and report final measured counts. Correct suite descriptions against actual test names/receipts. Preserve legitimate full-reader timings and approximate component labels; desktop IPC/WebKit remain unmeasured.

## Focused gate and handoff

Read/copy `origin/main:docs/evidence/m2-card-review-c2-contract-review-2026-10-07/diagnostic.test.mjs` unchanged. First reproduce **one control pass / six assertion failures**, exit 1, on submitted source. Set `C2_REVIEW_MODEL=/absolute/path/to/new/proof/contractModel.mjs`; run `/opt/homebrew/opt/node@22/bin/node --experimental-strip-types --test <frozen-file>` from repository root.

Run all seven frozen files unchanged under `docs/evidence/`: `m2-card-review-c2-review`, `rereview`, `completion-review`, `final-review`, `pipeline-review`, `bounds-rereview`, `contract-review` (all suffixed `-2026-10-07/diagnostic.test.mjs`). Expected **9 + 12 + 16 + 11 + 8 + 11 + 7 = 74 passes**, zero failures. Preserve origin hashes/relative imports. Do not weaken tests, suppress failures or fabricate work counters.

Run the new focused proof, mutation baseline/four kills/survival control, actual SQL/work accounting and representative final-reader performance only. No unchanged full app/native/Xcode tests. Demonstrate meaningful failure-before/pass-after for promoted regressions and real controller/enrichment flows.

Deliver report/README with exact issue/test mapping, raw commands/cwd/toolchain/stdout/stderr/exits, four live-doc snapshots, source-hashes manifest and SHA256SUMS. Verify all seven previous submitted packs unchanged. State any deliberately updated old test expectation. STATUS/handoff: “corrected, pending independent review,” not accepted. Report exact HEAD/branch/staging/commit state, leave uncommitted/unpushed, and stop for independent review after all work is complete. No new roadmap or redundant owner gate.
