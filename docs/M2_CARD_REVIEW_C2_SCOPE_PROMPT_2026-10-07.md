# M2-4 / card reviews C2 — model-neutral scope and query-proof assignment, 7 October 2026

**Prepare the next complete, reviewable C2 proposal and disposable proof. Do not implement production C2 yet.** C1's single-material card reviews and M2 practice source are accepted through their containing merged PRs. Any owner-selected model can execute this assignment; Codex remains independent reviewer/Git coordinator. The real-user check-in waiver persists. No repeated C1 approval or research survey is required.

## Start and outcome

Use `/Users/rickymac/code/Flight-training-pr70-integration`. Fetch and verify clean main contains the merged [C1 acceptance](M2_CARD_REVIEW_C1_ACCEPTANCE_2026-10-07.md). Create `codex/m2-card-review-c2-scope` from current main; one active implementation/planning branch. Report unexpected work and preserve it. Read ROADMAP section 7C and C1 scope section 11, the C1 repository/transaction/identity contract and existing Study Library routes/global loading. Do not apply preserved submission stashes.

Design Library, Review due and History inside the existing Study Library. She should see which materials have reviewable current cards, choose a material for a short offline session and inspect bounded history with links to the exact frozen version/material context. Start with a concrete example: two synthetic materials, due Again/day cards, new cards, a changed card set and a suspended/flagged item. Explain what changes from C1's material-only view.

## 1. Product scope and owner defaults

Write `docs/M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md` with a concise decision table: decision ID, recommended default, alternative, impact and whether owner approval is needed. Resolve recommendations before presenting decisions, so one owner approval can cover the proposed product defaults.

Cover navigation, default filters/order, empty/loading/read-failure/retry states, material selection/session entry and capped history paging. Recommend material-selected C1 sessions first; distinguish that from user-approved multi-material collections, which need separately explicit semantics if proposed. Keep card ratings and practice-test results distinct; no score/mastery/FAA-readiness inference. Decide whether History includes cards only or also accepted practice sessions, and define clearly separated labels/filters if both.

Explicitly decide **new-card discovery/backfill**. C1 materializes snapshots only on first mutation and derives current identity from raw saved cards. A global query cannot silently treat the last materialized version as current, or miss new B before materialization. Compare bounded on-demand discovery, a rebuildable current-content index and any persistent backfill option. Recommend the smallest design that meets the measured budgets; explain upgrade, old-backup restore, generated/imported replacement, A→B→A, deletion/reset invalidation and schema implications. Do not perform production backfill or infer migration approval.

Retain C1 simple-v1 intervals, current-version identity, per-material reset generations, replay semantics, suspend/flag exclusion and card deletion policy. Do not reopen the accepted scheduler decision, install FSRS or change retention without a concrete new requirement and separately named owner decision. State bounds for library-wide counts/candidate lists and caps for selected sessions. Avoid a separate study application.

## 2. Concrete read/write and compatibility contract

Identify exact routes, current-source components/repositories to extend and the minimal proposed files. Define typed query inputs/results, cursor ownership, filters and tie ordering. Include page/route/filter epochs, synchronous page/session exclusion, reset/delete/regeneration invalidation and sanitized read retry; carry C1's request-ownership lessons forward.

Provide executable candidate SQL plus EXPLAIN QUERY PLAN on representative disposable SQLite tables. A plan must address current saved content **before** snapshot creation, retired versions, reset generations, deleted materials, paused/flagged never-rated cards and clocks/zones. Keep Again at its exact instant and day cards before the exclusive next local midnight. Filter before applying limits, with deterministic ties.

Targeted repository reads only; no full history arrays in AppDataContext. Describe how queries avoid scanning/rehashing every full card set on every keystroke/render. Reads must remain read-only except an explicitly proposed/approved rebuildable cache or migration. Preserve the pool boundary: all multi-statement mutations go through one owned/native connection, never pooled BEGIN/COMMIT calls.

If an additional migration is necessary, provide proposed SQL under evidence, not src-tauri/migrations; identify the next free number (currently 13 after C1) and exact schema/registry/archive/startup compatibility changes. Otherwise explicitly explain why no migration is needed. Old database restores, schema ceilings, Policy A practice retention and C1 card deletion/reset boundaries must remain clear.

## 3. Disposable proof and useful measurements

Create `docs/evidence/m2-card-review-c2-scope-2026-10-07/` with isolated proof scripts/fixtures, README, result JSON, raw receipts/exits and checksums. Use existing SQLite tooling and synthetic data; no production dependency/lockfile changes or network/provider calls.

Exercise 100, 2,500 and 5,000 materials and 10,000 review events/items. Record actual stored current-card counts and changed/unmaterialized versions, not just material labels. Include searchable/filterable views if proposed. Capture query counts, result sizes, rows considered, query plans, repetitions and median/tail timing with host/toolchain identity; distinguish SQL timing from content-hash/JSON-discovery cost and actual UI rendering. Propose budgets from evidence without claiming shipped performance.

Required meaningful assertions:
- New unmaterialized current B is discoverable; old A's due rows stay excluded; returning to identical A reuses its retained schedule.
- Again before/at its exact instant, day boundary/DST/zone changes, deterministic order and limits after paused/flagged/deleted filtering.
- Page cursors under tied timestamps; no duplication or omitted rows in stable data; explicit behavior under concurrent ratings, reset, deletion and replacement.
- History provenance/earlier-version labels, material deletion/reset policy, practice/card result separation and no stale erased page publication.
- Discovery/index/backfill recovery after restore or changed content; malformed versus valid-empty guide-only sets are distinct.
- Bounded output and targeted reads at largest fixture; fail at least representative deliberately wrong current-version, time-boundary and cursor/ownership variants through semantic assertions. Preserve failed attempts and restore scratch files exactly.

Do not rerun unchanged full application/native matrices for this planning task. The disposable proof and documentation hygiene are the relevant gate. No app launch, real profile/account, installed testing, mobile track, signing, installer/version or release work.

## 4. Reviewable delivery and stop

Finish the proposal, default table and proof before asking the owner to approve product choices. Add a complete **conditional model-neutral C2 implementation prompt**, `docs/M2_CARD_REVIEW_C2_IMPLEMENTATION_PROMPT_2026-10-07.md`: outcomes, exact files/contracts, required real-driver/UI/restore/performance tests and stopping point. Clearly require independent scope acceptance and recorded owner default approval before production execution; do not infer those from this planning assignment.

Update STATUS and PROJECT_HANDOFF to “C2 scope prepared, pending independent review and owner defaults.” Include what is finished, exact HEAD/branch, modified paths, proof results and remaining decisions. Preserve existing history and immutable C1 evidence.

Leave all work **uncommitted/unpushed** for Codex review. No new production source/dependency/migration is authorized by this prompt. Continue efficiently: use accepted C1 contracts and existing project conventions instead of rebuilding settled research or repeating irrelevant gates.
