# M2-3 card reviews, source slice C1 — conditional model-neutral implementation assignment (corrected)

**Activation condition: do not start until (1) the corrected [card review scope](M2_CARD_REVIEW_SCOPE_2026-10-06.md) has passed independent re-review, and (2) the owner has explicitly approved defaults C-D1–C-D8 (or recorded changes) in a dated approval note.** If either is missing, stop and report. Do not ask again for anything that approval already covers. The real-user check-in waiver remains in effect. Any model can execute this prompt. Codex remains independent reviewer and Git coordinator.

[Independent planning acceptance](M2_CARD_REVIEW_SCOPE_ACCEPTANCE_2026-10-06.md) closes CRS-R1/R2. The owner approval condition above still applies; no production approval is inferred from this acceptance.

## Outcome

In MaterialDetail, she can review a material's current saved flashcards:

- flip a card, rate it Again/Hard/Good/Easy, and see when it comes back
- return later to exactly the cards that are due
- suspend, resume, flag and unflag any current card, including never-rated ones
- see recent reviews, with earlier versions labelled
- reset that material's card reviews behind a clear confirmation

It works offline with no Gemini key. Ratings schedule reviews; they are never scores, mastery, FAA results or readiness. Practice tests and their history are unaffected.

## Start

- Use `/Users/rickymac/code/Flight-training-pr70-integration`. Fetch, confirm main contains the corrected scope and the owner approval note, and create `codex/m2-card-review-c1` from current main.
- Stop before overwriting unexpected work on affected paths. Do not apply old stashes or touch the separate primary clone.
- Allocate migration **0012** only after confirming the latest migration on main is 0011. Otherwise use the next free number and say so.
- One active implementation branch only.

## Implement exactly (scope sections 4–7)

**1. Pure logic in `src/logic`.**

- `cardScheduler.ts` (`simple-v1`, unchanged arithmetic).
- `cardIdentity.ts` (canonical JSON, `content_hash`, `version_id`, `item_id`, card validation; 1–500 cards, trimmed front 1–1,000 and back 1–2,000 code points, `sourcePage` null or 1–1,000).
- `localDay.ts` (`nextLocalMidnightUtc`: the first instant whose local date is after today's in an IANA zone; exact across daylight saving).
- Port the pure, identity, query-boundary and model cases from `docs/evidence/m2-card-review-scope-2026-10-06/proof/` (`proof.test.mjs`, `corrections.test.mjs`) to Vitest with unchanged meaning.
- A valid empty saved card array (including a guide-only imported packet) is the normal `none` state, with no damaged-content warning or zero-item snapshot. Invalid JSON/nonempty invalid cards are `malformed`. Preserve the guide.
- Rust identity must reproduce `proof/fixtures/identity-golden.json` via `include_str!`.

**2. Migration `0012_card_reviews.sql`.**

- Add exactly the scope section 5 tables, constraints, indexes and the delete trigger: `card_review_generations`, `card_versions` with `created_at` and nullable `first_reviewed_at`, `card_items`, `card_review_state` with nullable never-rated instants, `card_review_events` with `generation`, and `card_review_operations` with routing metadata and nullable `result_json`.
- Register it in `lib.rs` `migrations()`, `src/data/migrations.ts` and `migration-checksums.json`, and raise `CURRENT_SCHEMA_VERSION` to 12.
- Never edit 0001–0011.

**3. Native `src-tauri/src/card_reviews.rs`.** Command `save_card_review_atomically(operation: Value)`, following the scope section 6 transaction:

- Strict two-pass decode of the typed union (exact keys per branch; reset has no item fields), 64 KiB, UUIDv4 operation ID.
- Readiness gate. A dedicated connection with a 5 s busy timeout, foreign keys on and `BEGIN IMMEDIATE`.
- **Replay first** (conflict, then erased, then stored result), then the **generation barrier**, then the item or reset branch.
- System-clock `now` inside the transaction. Allowlisted error codes with fixed sanitized messages.
- Tests go in `card_reviews_tests.rs`.

**4. Browser and test path.**

- New `src/data/cardReviewTransaction.ts` with identical semantics (injectable timestamp for tests).
- `sqlJsDb.ts` runs it through `owner.exclusive` + `durableWrite`; `testing/nodeSqliteDb.ts` through `owner.exclusive`.
- `tauriDb.ts` passes through only allowlisted code+message pairs.
- `db.ts`: optional `saveCardReviewAtomically?`. The repository refuses with `UNSUPPORTED_DRIVER` when it's missing, with no fallback writes.

**5. Repository `src/data/repositories/cardReviewRepository.ts`.**

- `getCardReviewSnapshot(materialId)`: generation (0 if absent), the current version derived from `ai_study_sets` (`ok`/`none`/`malformed`), and states for the current items.
- `getDueQueue({ materialId, currentVersionId, currentItemIds, nowUtc, nextLocalMidnightUtc, maxNew: 10, maxTotal: 20 })`: the exact scope SQL (version join, `due_at <= nowUtc` for step < 0, `due_at < nextLocalMidnightUtc` for step ≥ 0, exclusions before ORDER BY/LIMIT), plus new cards from current derived items (no row, or a row that's never rated, not suspended and not flagged), ordered by ordinal and capped after eligibility.
- `getRecentReviews(materialId, cursor)`: keyset, 20 rows, earlier versions labelled.
- `saveAction(action)`.
- Reads never write. Nothing goes into `AppDataContext`.

**6. Validation.**

- `verify_schema_12_card_semantics` in `backup.rs` (called from `verify_application_connection` when the schema is 12 or later) and the TS twin in `practiceStateValidation.ts` enforce every invariant in scope section 7: ownership, recomputable identity, generation bounds and post-reset receipt/event generations, typed live receipts and NULL-result tombstones with routing metadata, events consistent with the projection, and timestamp format.
- Add `src-tauri/fixtures/card-validation/cases.json` with a valid baseline (rated, never-rated suspended, flagged, old version, post-reset generation 1, tombstones) and refuse cases for each invariant: wrong-material item, unrecomputable `item_id`, two active versions, live receipt with a NULL result, tombstone with content, receipt or event with a generation above the current one, live pre-reset item receipt, `reps` not matching events, never-rated row with an event, `due_at` without `last_reviewed_at`, malformed timestamp, missing generation-table FK.
- Both runners must give identical outcomes.

**7. UI.**

- **`useCardReview.ts`:**
  - owned request IDs
  - one in-flight write per material, under a synchronous lock
  - pending operations keep their ID and exact payload for **Try again**
  - read failures consumed, with read-only **Retry card reviews**
  - after an acknowledged or replayed write followed by refresh failure, show the confirmation but lock conflicting actions until an authoritative snapshot read succeeds; replay results never supply the current generation or revision
  - stale refusals refresh, then wait for a new deliberate action
- **`CardReviewPanel.tsx`** in the Flashcards card:
  - summary, then **Review cards** (session membership fixed at start: at most 20 unique cards, at most 10 new; it advances only on an acknowledged result for the shown card)
  - Show answer, then four ratings with next-wait labels
  - done-for-now, the suspend/flag menu, flagged list and recent reviews
  - the states and messages table in scope section 3
- **`ResetCardReviewsDialog.tsx`:**
  - the scope section 3 confirmation text: what resets, what stays (cards, study guide, practice tests) and that existing backups don't change
  - default focus on Cancel
  - locked while pending
  - an unknown outcome offers **Try again** (same ID and payload) and read-only **Check again**, never an automatic second reset
- **Keyboard:** Space/Enter reveals, 1–4 rate. Accessible names on every control. Keep the browse carousel.
- **Delete-material confirmation** adds "This also removes its card review history."

## Required tests (fail before, pass after)

- **The scope section 10 table, on both the native and browser drivers wherever it names them.** Specifically, real-transaction proofs of:
  - **Queue boundaries:** Again at minute nine versus ten; the exclusive next-midnight boundary and daylight saving with an injected zone; old A versus current B before and after materialization, and going back to A; suspended/flagged new cards; order and caps behind 200+ ineligible old rows.
  - **Reset versus a queued rating:** a rating prepared before the reset is refused afterwards (generation 0 at revision 0, and at revision 1 after a new rating reaches revision 1).
  - **Reset replay and isolation:** committed reset replayed after reopen and after new work (no second advance, nothing erased); repeated reset with tombstones skipped; changed-payload conflict; a stale-generation reset refused; unrelated-material and practice-data isolation.
  - **Rollback:** native failure injection in the event, receipt or generation write leaves nothing committed; browser storage refusal restores durable bytes; failed recovery disables the adapter.
- **Also:**
  - golden identity
  - first suspend before any rating (snapshot `created_at` set, `first_reviewed_at` NULL, no event)
  - same-ID replay after reopen
  - stale content and malformed sets
  - clock rollback
  - material-delete cascade plus tombstone replay refusal
  - validator parity on `card-validation/cases.json`
  - schema-11 backup restore and schema-13 refusal
- **jsdom UI with real AppDataProvider and disposable SQLite:**
  - full session and done-for-now
  - due-tomorrow return with an injected clock and zone
  - duplicate-click lock
  - lost-acknowledgement retry
  - the acknowledged-then-refresh-failure lock
  - Reset confirmation, pending, unknown Try again and Check again
  - Check again remains read-only and cannot infer acknowledgement of a particular reset merely from a changed generation. Retain the pending operation until same-ID replay, an authoritative operation receipt read, or a definitive refusal resolves it; never allocate an automatic new reset.
  - a guide-only imported packet with an empty card list retains its guide and shows the normal empty card state
  - no Gemini or network call
  - keyboard
- **500-card set and 10,000 paged events.**
- Use disposable databases, an injected clock and deterministic zones only. No real profile or network.

## Verification and stop

1. Run the focused tests, then one sequential gate:
   - `npm run typecheck`
   - `npm test` (zero failed, zero unhandled)
   - `npm run build`
   - locked Rust all-target tests
   - Clippy `-D warnings`
   - `cargo fmt --check`
   - `npm run test:cargo-lock`
   - tracked and new-file whitespace hygiene
   - migration 0001–0011 immutability, plus 0012 registration and checksum
2. Preserve failed attempts.
3. Write a new dated evidence pack: report, requirement-to-test map, exact exits and counts, a source manifest rooted at the repository and a separate evidence manifest.
4. Update STATUS and the handoff as **C1 implemented, pending independent review**.

**Stop with everything uncommitted and unpushed.** Excluded: no new dependency (FSRS stays out unless a separate approved exception exists), no provider call, cross-material views (C2/M2-4), installed testing, signing, packaging, version change or release.
