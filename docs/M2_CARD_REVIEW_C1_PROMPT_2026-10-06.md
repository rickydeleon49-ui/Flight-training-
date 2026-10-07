# M2-3 card reviews, source slice C1 — conditional model-neutral implementation assignment

**Activation condition: do not start until (1) the [card review scope](M2_CARD_REVIEW_SCOPE_2026-10-06.md) has passed independent review, and (2) the owner has explicitly approved its defaults C-D1–C-D8 (or recorded changes) in a dated approval note.** If either is missing, stop and report. Do not ask again for anything that approval already covers. The real-user check-in waiver remains in effect. Any model can execute this prompt. Codex remains independent reviewer and Git coordinator.

## Outcome

In MaterialDetail, she can review a material's saved flashcards:

- flip a card, rate it Again/Hard/Good/Easy, and see when it comes back
- return later to the cards that are due
- suspend, resume, flag and unflag cards
- see recent reviews

It works offline with no Gemini key. Ratings schedule reviews; they are never scores, mastery, FAA results or readiness. Practice tests and their history are unaffected.

## Start

- Use `/Users/rickymac/code/Flight-training-pr70-integration`. Fetch, confirm main contains the approved scope and approval note, and create `codex/m2-card-review-c1` from current main.
- Stop before overwriting unexpected work on affected paths.
- Do not apply old stashes or touch the separate primary clone.
- Allocate migration **0012** only after confirming main's latest migration is 0011. If not, use the next free number and say so.
- One active implementation branch only.

## Contracts to implement exactly (scope sections 4–8)

**1. Pure scheduler, `src/logic/cardScheduler.ts`.** `simple-v1`:

- Again: 10 minutes. Ladder: 1, 3, 7, 16, 35, 75, 150, 180 days. Hard stays on the current rung, Good climbs one, Easy climbs two. New and relearning cards start below the ladder.
- Intervals count from the review time.
- Throws `CLOCK_BEHIND_LAST_REVIEW` and `UNSUPPORTED_SCHEDULER_VERSION`.
- `isDue(state, now, timeZone)`: day-ladder cards by local calendar day in the current zone; Again-step cards by exact instant.
- Port the proof cases from `docs/evidence/m2-card-review-scope-2026-10-06/proof/proof.test.mjs` (pure and identity groups) to Vitest unchanged in meaning.

**2. Identity.** Sorted-key canonical JSON of `[{back, front, sourcePage}]`:

- `content_hash = sha256(canonical)`
- `version_id = sha256(materialId + "\u0000" + content_hash)`
- `item_id = sha256(version_id + "\u0000" + ordinal)`

Implement it in TS and Rust. Both must reproduce `proof/fixtures/identity-golden.json` byte for byte (Rust reads the fixture via `include_str!`).

Card validation: 1–500 cards; trimmed front of 1–1,000 and back of 1–2,000 code points; `sourcePage` null or an integer 1–1,000. Any failure gives `MALFORMED_CARDS` for the whole set.

**3. Migration `0012_card_reviews.sql`.** The scope section 5 tables, indexes and delete trigger, additive only. Register it in `src-tauri/src/lib.rs` `migrations()`, `src/data/migrations.ts` and `src/data/migration-checksums.json`. Raise `CURRENT_SCHEMA_VERSION` to 12. Never edit 0001–0011.

**4. Native module `src-tauri/src/card_reviews.rs`.** Command `save_card_review_atomically(operation: Value)`, registered in `lib.rs`:

- strict two-pass decode (exact keys, 64 KiB, bounded IDs, UUIDv4 operation ID)
- readiness gate (`is_root_ready`)
- a dedicated connection with a 5 s busy timeout, foreign keys on and `BEGIN IMMEDIATE`
- the receipt replay/conflict/tombstone rule; read and validate `ai_study_sets`; compare content hash; materialize and activate the version; revision check
- suspend/flag refusal on `rate`; system-clock `now` inside the transaction; rollback check; scheduler; event insert, projection upsert and receipt
- commit
- `reset` per scope section 6

Errors use the allowlisted codes in scope section 6, with fixed sanitized messages. Tests go in `card_reviews_tests.rs`.

**5. Browser and test path.**

- New `src/data/cardReviewTransaction.ts`, the same semantics on `exec`/`run`/`query` with an injectable timestamp for tests.
- `sqlJsDb.ts`: run through `owner.exclusive` + `durableWrite`.
- `testing/nodeSqliteDb.ts`: run through `owner.exclusive`.
- `tauriDb.ts`: `invoke`, passing through only allowlisted code+message pairs; everything else becomes a transport error.
- `db.ts`: optional `saveCardReviewAtomically?`. The repository refuses with `UNSUPPORTED_DRIVER` when it's missing, with no fallback writes.

**6. Validation.** Add the card invariants (scope section 7) to `backup.rs` (`verify_schema_12_card_semantics`, called from `verify_application_connection` when the schema is 12 or later) and to `practiceStateValidation.ts`. Extend the shared fixture with card accept/refuse cases replayed by both runners, with matching outcomes.

**7. Repository `src/data/repositories/cardReviewRepository.ts`.** Expose:

- `getCardSet(materialId)` (derived identities plus validity, pure over `ai_study_sets`)
- `getStates(materialId)`
- `getDueQueue(materialId, endOfLocalDayIso, limits)`
- `getRecentReviews(materialId, cursor)` (keyset, 20 rows)
- `saveAction(action)`

Do not add review data to `AppDataContext`.

**8. UI.**

- `useCardReview.ts`: owned request IDs; one in-flight write per material with a synchronous lock; the pending operation keeps its ID and exact payload for **Try again**; read failures are consumed, with read-only **Retry card reviews**; stale results refresh and then wait for a new deliberate action.
- `CardReviewPanel.tsx` in MaterialDetail's Flashcards card: a due/new summary, **Review cards** (at most 10 new cards and 20 cards per session), Show answer, four rating buttons with their next-time labels, a done-for-now summary, the suspend/flag menu, flagged list and recent reviews. Use the states and messages table in scope section 3.
- Keyboard: Space/Enter reveals, 1–4 rate. Rating buttons have accessible names.
- Keep the existing browse carousel.
- The delete-material confirmation adds "This also removes its card review history."

## Required tests (fail before the change, pass after)

- **The scope's acceptance cases 1–12, native and browser where both apply:**
  - golden identity
  - first-rating materialization
  - same-ID replay including after reopen
  - changed-payload conflict
  - stale revision and stale content
  - malformed sets
  - suspend/flag
  - clock rollback, local midnight and time-zone change
  - material delete cascade plus tombstone replay refusal
  - reset
  - native failure injection rollback
  - browser storage refusal and failed recovery disabling the adapter
  - validator parity
  - schema-11 backup restore and schema-13 refusal
  - jsdom UI flows with real AppDataProvider and disposable SQLite, including no Gemini call, the duplicate-click lock, lost-acknowledgement retry and read-failure retry
- **The 500-card set and 10,000 paged events** query test.
- Use disposable databases, an injected clock and a deterministic time zone only. No real profile or network.

## Verification and stop

1. Run the focused tests, then one sequential gate with the repository's current commands:
   - `npm run typecheck`
   - `npm test` (zero failed, zero unhandled)
   - `npm run build`
   - locked Rust all-target tests
   - Clippy `-D warnings`
   - `cargo fmt --check`
   - `npm run test:cargo-lock`
   - whitespace hygiene for tracked and new files
   - migration 0001–0011 immutability, plus 0012 registration and checksum
2. Preserve failed attempts.
3. Write a new dated evidence pack: report, case mapping, exact exits and counts, a source manifest rooted at the repository and a separate evidence manifest.
4. Update STATUS and the handoff as **C1 implemented, pending independent review**.

**Stop with everything uncommitted and unpushed.** Excluded: no new dependency (FSRS stays out unless a separate approved exception exists), no provider call, cross-material views (C2/M2-4), installed testing, signing, packaging, version change or release.
