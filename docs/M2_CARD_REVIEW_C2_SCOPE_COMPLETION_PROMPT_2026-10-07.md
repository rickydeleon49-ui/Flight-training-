# C2 scope completion — one model-neutral assignment, 7 October 2026

Finish the remaining C2 planning corrections precisely and efficiently. This is the active assignment, superseding the first correction prompt. Preserve the fixed R2/R3/version/progression cases and accepted C1; do not restart research or production implementation. Any owner-selected model may execute it. C2 owner defaults remain proposed, and the real-user check-in waiver persists.

## Establish reviewed identity

Use `/Users/rickymac/code/Flight-training-pr70-integration`, existing dirty branch `codex/m2-card-review-c2-scope` at `9028675475616ce338253ae7e4e46ba6b840b72c`. Fetch origin and read this prompt, `docs/M2_CARD_REVIEW_C2_SCOPE_REREVIEW_2026-10-07.md` and `docs/evidence/m2-card-review-c2-rereview-2026-10-07/submitted-source-hashes.json` via `git show origin/main:<path>` if absent locally. Verify all **25 reviewed corrected delivery paths** before editing. Do not switch/pull/reset over the dirty submission. Report competing changes, preserve them and continue unaffected authorized work.

Preserve both prior evidence directories byte-for-byte, including original failed and corrected receipts. Create `docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/` for the final model/tests/benchmark/controller/restore proofs and raw receipts/exits. Save the currently reviewed proposal/prompt copies there before editing. The 25-path manifest is rooted at the dirty clone and includes the four docs omitted from the model's nineteen-file evidence hash list. Do not claim every original eighteen path still matches after intentionally editing four docs.

## 1. Fix proof parity first (new R6)

Read/reuse `src/logic/cardIdentity.ts`, `cardScheduler.ts` and `localDay.ts`. Node 22 can import the standalone TypeScript modules with `--experimental-strip-types`; no dependency or production edit is needed. Prefer direct imports over another hand-written twin. Preserve exported model names through thin wrappers where necessary for diagnostics.

Restore accepted limits front/back/page = **1000/2000/1000**, ECMAScript trim/code-point checks, lone-surrogate rejection and correct absent/valid-empty versus malformed behavior. Remove invented control-character restrictions. Preserve the exact `simple-v1` ladder **[1,3,7,16,35,75,150,180]** and every rating/reps/lapses rule. Prove parity at boundaries/Unicode and across all steps/ratings against production, including golden identity vectors. Do not change production to match the prototype.

## 2. Finish discovery contract and real batching (R1/R4)

Keep raw current-version lookup, retired-state isolation, retained A schedule recovery and forward candidate continuation intact. Resolve the ranking/cursor tension before further code:
- C2-D3 currently promises urgency ranking within candidate batches; the model doesn't sort at all. Evaluate a bounded batch then sort/continue without losing its undisplayed results, or explicitly recommend discovery-order display and revise D3 with its tradeoff. Do not combine an early metadata-order cutoff with a claimed urgency sort. No unsupported global urgency claim.
- Hard-validate maximum **250 candidates**, result/history caps, filter/clock/zone ownership and input/cursor shape. Bind continuation to its query epoch/context; define stale/invalid cursor rejection and fresh read behavior.
- Define page-local summaries versus cumulative discovery totals. A last page's `isComplete` must not make its local counts appear to be whole-library totals. Specify aggregation, dedup, incomplete/empty/caught-up states and reset/filter invalidation.
- Implement concrete bounded batched metadata/raw/version/state reads. Looping `.get` per candidate or distinct history material is not a batch. Demonstrate SQL with existing driver select/parameter limits and native/browser read semantics; count actual queries, returned rows and UTF-8 bytes. State explicit worst-case budgets for 250 candidates/500-card sets and fifty actionable results. Remain read-only.

Initialize disposable databases by executing actual shipped migrations 0001–0012, not hand-written DDL with the nonexistent `idx_materials_priority_updated`. Include a genuine schema-11 fixture upgraded by 0012. Add any optional index only in a labeled comparison variant under evidence, with a distinct proposed approval/migration impact; never silently put it into the no-migration baseline.

## 3. Make the controller proof genuinely asynchronous (R5)

Build a small injectable asynchronous reader with deferred promises. Its state transitions must reflect the intended UI controller:
- Synchronous owned busy lock excludes two same-turn page activations; terminal completion blocks repeat loading.
- Capture requested cursor/filter/query generation and operation ID. Resolve/reject/finally may publish or release only when still owning the live request.
- Filter/route/reset/delete/content/clock/zone/disposal invalidation clears or explicitly reconciles rows, cumulative counts and cursors. Old rows must not survive a filter change, duplicate after reset or reappear after erasure.
- An acknowledged mutation is followed by authoritative read only. Read retry retains the failed request cursor and cannot replay writes.

Use actual held read promises: hold old A; invalidate; start B; settle/reject/finally A; B remains owned and current. Cover deleted/reset rows, filter failure, unmount/disposal, same-turn activation, terminal-page repeat and reset fresh-page dedup. The prior `generation !== 0` boolean is not a deferred-read proof. Add bounded history cursor concurrent-rating semantics and complete expected ordered ID traversal, retaining the existing good oracle/deletion tests.

## 4. Finish restore/provenance/prompt contracts (R5)

Exercise real disposable file-backed close/reopen or backup-copy restore, then repeat content discovery and history. Prove a schema-11 database gains only shipped schema 12 and discovers current cards without a production backfill. Preserve accepted deletion/reset/tombstone and practice separation policies. Mark native archive/installed testing as unverified where this proof doesn't execute it.

Provide explicit current/earlier/unavailable/malformed/valid-empty history context, an inspectable frozen-version destination and complete minimum interval/state/source payload. Keep existing practice history/attempt routes compatible. Write all typed query/controller/result contracts and exact UI loading/error/incomplete/empty/retry behavior into the scope and conditional implementation prompt. Avoid asks for intervals or historical inspection that the declared API cannot supply.

## 5. Correct evidence and budgets (R4)

Instrument the actual final read pipeline, including every SQL call/result row, raw UTF-8 bytes, validation/canonical/content/version/item hashes, batching, ranking and controller-preparation costs. Separate sampled component measurements from complete-call instrumentation. Use 100/2500/5000 materials and exactly 10000 large-fixture events; exercise mixed sets, all-due, 250 ineligible prefixes and maximum card/text/Unicode bounds. Record actual current versus retained card counts and repetitions/tail labels. EXPLAIN the exact executed first/continuation queries.

Keep synchronous SQL/runtime and desktop IPC/WebKit rendering costs distinct. The current submission still takes 124 SQL calls for fifty results and 21 calls for a twenty-row history page; the goal is an explicit bounded read architecture, not another fast in-memory timing alone. Resolve the history 5-ms JSON target versus proposed 15-ms document change: propose a justified revision with actual pass/fail/unmeasured statuses in every artifact. Remove unsupported numeric predictions for unimplemented cache/backfill and “instantaneous restore”; qualitative comparisons suffice.

Run representative wrong-version/time/cursor-or-owner mutants against the same assertions in isolated copies, preserve failing exits/receipts and verify restored proof hashes. Do not simply write `0` into an exit file for a narrative. No error suppression, skipped coverage or timeout increases.

## Frozen diagnostics and proportional gate

Prior frozen diagnostic is `origin/main:docs/evidence/m2-card-review-c2-review-2026-10-07/diagnostic.test.mjs` and must keep **9/9 passing**. New frozen diagnostic is `origin/main:docs/evidence/m2-card-review-c2-rereview-2026-10-07/diagnostic.test.mjs`: reviewed baseline **1 pass/11 fail**, all assertions. Run it unchanged against final model and require **12/12 pass**.

Both use `C2_REVIEW_MODEL=/absolute/path/to/final/proof/contractModel.mjs`. Place identical test copies at their repository-relative evidence paths so the new test's production TypeScript/migration imports resolve. For the new diagnostic use `/opt/homebrew/opt/node@22/bin/node --experimental-strip-types --test <path>`. Compare frozen SHA-256 with origin before/after. If final API changes, a documented semantic-preserving adapter may expose old names; it must not fabricate counts, rows, scheduling or results.

Run final proof/controller/restore/production parity tests, both frozen diagnostics, semantic mutations, actual-schema benchmarks and authored-doc hygiene. Do not rerun unchanged app/native matrices. No new application source/dependency/lockfile/migration, app launch, user account/profile/provider, installed/signing/mobile/release work.

## Delivery and stop

Rewrite the scope/default table and complete conditional implementation prompt for the final supported recommendation. Keep C2-D1–D9 proposed until independent scope acceptance and recorded owner choice. State any changed recommendation clearly; preserve accepted C1 defaults and existing scope. Update STATUS/handoff by new entries with corrected claims, never by deleting old receipts.

New evidence includes concise R1/R4/R5/R6 issue-to-test map, all runnable modules, raw receipts and actual exit files, exact baseline failures/final passes, benchmarks/counters and a rooted manifest for **every changed delivery path**, including proposal/prompt/STATUS/handoff. Checksum evidence separately without circular hashes; verify both older evidence packs unchanged. Leave work uncommitted/unpushed on the existing branch for independent re-review. Finish this one package before asking for owner approval; production C2 is not activated.
