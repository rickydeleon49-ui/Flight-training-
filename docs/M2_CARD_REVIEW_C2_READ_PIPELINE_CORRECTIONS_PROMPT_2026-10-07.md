# M2 Card Reviews C2 — Focused read-pipeline corrections (7 October 2026)

Complete the remaining planning contracts in one package. Preserve the verified work and make useful progress; do not restart the feature or add new roadmap scope. This is a model-neutral assignment for the owner's selected model.

## Outcome, start and preservation

Read `docs/M2_CARD_REVIEW_C2_FINAL_REVIEW_2026-10-07.md` first. All three previous frozen diagnostics pass **9/9 + 12/12 + 16/16**, the submitted proof passes **24/24**, actual reads batch correctly, and the mutation verifier detects survivors. Preserve these facts. Remaining work is confined to pending-stream consumption/ownership, authoritative refresh replacement/operation ownership, executable resource budgets, and accurate supporting contracts/evidence.

Use `/Users/rickymac/code/Flight-training-pr70-integration`, existing dirty `codex/m2-card-review-c2-scope`, HEAD `9028675475616ce338253ae7e4e46ba6b840b72c`. Fetch origin, then read new documents/manifests using `git show origin/main:<path>`. Do not pull/reset/stash/switch/rebase/apply tracked main files over the dirty checkout. Verify all **34 submitted hashes** in `origin/main:docs/evidence/m2-card-review-c2-final-review-2026-10-07/submitted-source-hashes.json` before edits. Report competing mismatches before touching affected work.

Preserve all four submitted C2 evidence directories byte-for-byte. Create `docs/evidence/m2-card-review-c2-read-pipeline-corrections-2026-10-07/` with the current scope/prompt snapshot under `submitted/docs/`, then write new proof/tests/receipts there. Update the four live delivery docs (scope, conditional implementation prompt, STATUS and handoff) only as part of the final package. Keep C2-D1–D9 proposed; C1 acceptance/defaults and the check-in waiver persist. Production C2 is not authorized.

## 1. Fix pending-stream consumption and both cursor contracts

Current revalidation filters IDs, slices the filtered rows for the page, then slices the original IDs by `limit`. With `[B,C,D]` pending and B deleted/empty, it returns C but leaves C pending, producing A/C/C/D over the whole traversal.

Implement a clear consumption invariant: each pending identity is either emitted, deliberately discarded as no longer eligible, or retained as unprocessed. Only the last category goes into the next cursor. For that example, after discarding B and emitting C, next pending is `[D]`. Budget stops must retain all unevaluated candidates; do not advance the candidate key past unread work. Preserve ordered, complete, duplicate-free traversal and within-batch urgency behavior. Test full traversal after prefix/middle deletion, empty/content/status change, page-size changes and resource stops; do not assert only the first continuation page.

Require a versioned, kind-specific bounded token for due and history readers. Validate mandatory normalized context, key fields, pending IDs and encoded/decoded sizes; reject missing/wrong context, malformed/wrong-kind tokens and cross-filter use explicitly. History filters already apply correctly in SQL: retain them while binding its cursor to material/topic context. Due clock/filter mismatch checks already work when ctx exists: make ctx mandatory rather than optional. Allow compatible page-size changes. Declare integer resource/page limits and canonical clock ownership in the actual API and final prompt.

New frozen diagnostic cases 1–4 demonstrate these failures. Preserve all earlier forward-progress, tied-keyset, deleted-current-row and A→B→A cases.

## 2. Replace reset traversal and fully own reader invocation

Choose one authoritative refresh rule and implement it coherently. Preferred: reset/delete/content/restore/clock/query invalidation starts a new generation with empty rows/counts/cursor, then its ordered first page replaces the old generation. Existing append/replace-at-old-position cannot remove a surviving no-longer-actionable material or update urgency order. If choosing a more complex reconciliation, prove complete absence/removal/order/count semantics, not only changed field values.

Specify whether the notification itself begins the authoritative read or the caller does, then test through read completion. Keep explicit event-ID history identity, due material-ID identity, same-turn exclusion, terminal completion and read-only Retry at the exact failed cursor. Clear obsolete loading/errors/failed cursor and operation state on invalidation.

Install a synchronous owned operation before calling the injectable reader. A synchronous throw must release/publish only if it still owns the live generation and operation. Reproduce the reviewer boundary: A's reader synchronously invalidates, starts a genuinely held B, then throws. A cannot clear B's loading/lock, and a duplicate activation cannot allocate another B read. Retain normal synchronous throw→Retry and held-A/held-B asynchronous cases.

New cases 5–7 fail on current source; its two controls pass. Promote these behaviors to permanent tests. Route/content/clock/zone/disposal hooks can share one tested invalidation path; avoid a sprawling second controller implementation.

## 3. Make resource budgets real before raw transfer/derivation

The proposed 2,500-card/2-MiB caps are currently prose only. Six 500-card materials are fully derived/returned despite the card budget; two max-ASCII 500-card sets transfer 3,041,002 raw bytes despite the byte ceiling. The reader must accept/enforce valid requested budgets and declare its defaults. The new tests explicitly request 2,500 cards and 2 MiB. Justified default revisions remain possible but cannot silently ignore requested bounds.

Implement the limits in the actual pipeline, including pending revalidation and history where applicable:
- Obtain bounded candidate headers and size/work metadata before requesting large raw payloads. A supported SQLite byte-length preflight, conservative sub-batches or another demonstrated read-only approach is acceptable. Do not add a production migration/index/dependency.
- Stop before the cumulative raw-transfer/card-derivation/work budget is exceeded. Reading/hashing the whole batch and merely limiting output is not enforcement. Add counters to the executed path so tests can inspect actual reads/bytes/evaluated cards/hashes/candidates, not fabricated summaries.
- Retain a valid cursor for all unevaluated candidates and undisplayed evaluated results. Complete a traversal with equality against independently expected IDs, including all-ineligible prefixes, all-new/all-due and varying card sizes.
- Define an explicit policy for a single valid set larger than a normal batch budget. It must be bounded, discoverable and terminating: a carefully bounded single-set lane, explicit deferred/oversize result with a read-only link to review, or a justified revised budget. No silently lost material, repeated empty-page livelock or false caught-up label. Keep C1's 500-card/1000-front/2000-back limits and Unicode rules.
- Declare cursor/retained-summary/IPC-return bounds. Keep page-local versus cumulative loaded counts and incomplete/terminal states precise.

Use small representative fixtures. The published byte case is only ~3 MB and each set individually fits 2 MiB. Also exercise one genuinely max-text/Unicode set and the chosen oversize policy. Do not allocate a multi-gigabyte worst-case fixture. Replace the false 31-MB short-card “upper bound” with honest byte arithmetic/parameters and unmeasured labels. Remove the unsupported parse-time range.

Instrument the actual final read pipeline for component timing/counts or label/remove approximate components. The current benchmark twin differs from the actual `< midnight` boundary and priority-before-due tie-breaker. Keep valid full-call measurements. Re-audit first/continuation/filter SQL statements and rows/estimated UTF-8 bytes after this change; extra bounded metadata queries are acceptable if measured/documented. Do not force a three-call number at the cost of correctness. Desktop/WebKit remain unmeasured.

New cases 8–9 fail. Add stronger permanent work-counter/fairness tests so simply reducing visible rows cannot pass as an implementation.

## 4. Finish owner mutation evidence and the conditional prompt

Retain the working child-process assertion verifier and its survival control. Its owner worker does not actually hold B and fails even with the injected mutation removed. Make the owner baseline and mutant share the same independently held A/B fixture and assertions. Baseline must pass while B is pending; an isolated stale-release change must fail the intended ownership assertion; tooling/import failures and surviving mutants must fail verification. Record actual commands/exits/stdout/stderr. Reuse meaningful version/time/keyset cases rather than redesigning unrelated evidence.

Rewrite the supported scope and conditional production prompt to match the final executable design. Include resource inputs/defaults/counters/cursor schema, oversize behavior, accurate SQL budgets, authoritative refresh and counts, incomplete/loading/error/Retry semantics, library badge reads, and the existing history feature. Provide a concrete typed frozen inspection target (material/version/item/event or a row-backed read-only modal contract), state validation and nullable interval display; reuse C1 scheduling helpers and do not invent intervals for malformed legacy state. Preserve current/earlier/valid-empty/unavailable/malformed provenance and the passing file-backed history/upgrade evidence.

Avoid runtime type placeholders labeled “complete,” file:// links unusable by other agents, and the remaining “completely eliminates migration risk” claim. Say no additional C2 migration; schema-11 upgrade still executes shipped 0012. Clearly identify any justified changed proposed default for later owner approval.

## Gate, deliver and stop

Run relevant proof/controller/cursor/resource/inspection tests, actual query/accounting checks and the reliable mutation gate. Keep proportional verification: no unchanged full app/native/Xcode suites, launches, accounts, providers, signing, release or mobile operations.

Run all four frozen diagnostics **unchanged**, using `C2_REVIEW_MODEL=/absolute/path/to/new/proof/contractModel.mjs` and `/opt/homebrew/opt/node@22/bin/node --experimental-strip-types --test <path>`:

1. `origin/main:docs/evidence/m2-card-review-c2-review-2026-10-07/diagnostic.test.mjs` — 9/9.
2. `origin/main:docs/evidence/m2-card-review-c2-rereview-2026-10-07/diagnostic.test.mjs` — 12/12.
3. `origin/main:docs/evidence/m2-card-review-c2-completion-review-2026-10-07/diagnostic.test.mjs` — 16/16.
4. `origin/main:docs/evidence/m2-card-review-c2-final-review-2026-10-07/diagnostic.test.mjs` — 11/11, including both controls.

Copy/read frozen tests without overwriting existing dirty delivery files. Preserve repository-relative locations/imports and compare origin hashes before/after. An adapter can preserve API names/types but cannot fabricate correct results or resource counters.

Deliver one concise issue-to-fix/test map for R8/R9/R4 and owner-evidence cleanup, runnable modules, failure-before/pass-after receipts, actual exits, final accounting/benchmarks, four live docs, a manifest of every changed delivery path and non-circular rooted evidence checksums. Verify all four older packs unchanged. Leave everything **uncommitted/unpushed on the existing branch**. Stop for independent review; production C2 and C2-D1–D9 approval remain pending. Do not request owner decisions until this package is complete.
