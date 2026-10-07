# M2-3 card review — scope, recommended defaults and scheduler evaluation (6 October 2026)

**Status: scope and proof prepared, pending independent review and owner production approval.** This is planning plus an isolated research proof. No application code, migration, dependency, lockfile, workflow or capability changed. Existing M2 practice approval does not cover card persistence, scheduling defaults, migration 12 or a new dependency. Assignment: [card review scope prompt](M2_CARD_REVIEW_SCOPE_PROMPT_2026-10-06.md). Evidence: [docs/evidence/m2-card-review-scope-2026-10-06](evidence/m2-card-review-scope-2026-10-06/README.md).

Prepared on branch `codex/m2-card-review-scope` from clean main `df7a130` (PR #106). PR2 is confirmed merged:

- the [source acceptance](M2_PRACTICE_SESSION_PR2_SOURCE_ACCEPTANCE_2026-10-06.md)
- `usePracticeMetadata.ts`
- `PracticeMetadataReadRecovery.test.ts`
- `PracticeHistory.tsx`
- `erasePracticeHistoryAtomically`

The two recoverable stashes left by earlier syncs were not touched.

## 1. Owner decision table

Approving every recommended default below is enough to start source slice C1 (section 11) once this scope is independently reviewed. No other question is open.

| # | Decision | Recommended default | Main alternative |
| --- | --- | --- | --- |
| C-D1 | **Scheduler** | **Deterministic `simple-v1`** (section 8). Each state stores a scheduler version so FSRS can be added later as a reviewed, versioned upgrade. | Adopt `ts-fsrs` 5.4.2 now. This needs an explicit owner/reviewer exception replacing the roadmap's deterministic-first rule, plus an application-side interval clamp (section 9). |
| C-D2 | **Intervals** | Again: 10 minutes. First exposure: Hard 1 day, Good 1 day, Easy 3 days. Review ladder: 1, 3, 7, 16, 35, 75, 150, 180 days. Hard repeats the current rung, Good climbs one rung, Easy climbs two. **Maximum 180 days; minimum 10 minutes**, and at least 1 day for any rating other than Again. Intervals count from the review time, so overdue cards don't jump. No per-user configuration in C1. | A longer maximum (365 days), or configurable intervals later. |
| C-D3 | **Card identity and replacement** | Content-addressed versions (section 4). Regenerated or edited cards are a new version that starts with new cards. Old reviews stay attached to the frozen text actually studied. Identical text, including going back from text B to text A, maps to the same version and history. No fuzzy carry-over. | Carry the schedule forward for identical single cards across versions (deferred, low value: Gemini rarely reproduces identical text). |
| C-D4 | **Retention and erasure** | **Card policy D** (deliberately not practice Policy A): deleting a material deletes its card versions, frozen card text, schedule state and rating events in the same SQLite statement. Only non-content operation tombstones remain, so late replay is refused. A per-material **Reset card reviews** action erases that material's card state and events, keeps the current cards, and prunes inactive versions. Regeneration keeps old versions until reset or deletion. | Retain frozen card text after deletion (Policy A style); not recommended, because cards have no cross-material history view yet and "delete" should mean delete. |
| C-D5 | **Due ordering and time zone** | Absolute UTC due instants are stored. Cards on the day ladder are due on their local calendar day, in the time zone the computer is in now; cards waiting after Again are due only at their exact instant. Queue order: Again-step cards first, by due instant; then other due cards, oldest due first; then new cards in card order, at most **10 new cards per session**. A session stops after **20 cards**. A clock earlier than the card's last review refuses the rating with a message, and nothing is written. | Snap day-cards to local 4 a.m. (more state, more time-zone edge cases). |
| C-D6 | **Suspended and flagged** | Both stay visible in the material's card list and keep their history. Both are excluded from the due queue and refuse ratings until resumed or unflagged. "Flag" means *questionable content* (with an optional choice: wrong answer / unclear / not in my source); "Suspend" means *I don't want this card now*. Neither changes the schedule. | Flagged cards stay reviewable with a warning badge. |
| C-D7 | **Navigation** | C1 works inside MaterialDetail: due count, Review cards session, compact recent-review history and flagged list. The Library-wide **Review due** and **History** views belong to M2-4 with paged cross-material queries. | Add a cross-material Review due list in C1 (needs a materialization or backfill decision; see section 4). |
| C-D8 | **Dependency** | No new production dependency. The `ts-fsrs` evidence is research only. | — |

## 2. What exists today (verified on main `df7a130`)

- **Card storage:** `ai_study_sets` (migration 7) holds one row per material. Its `flashcards_json` stores `{ front, back, sourcePage }` items with no item IDs. Provenance is `gemini` or `import`.
- **How saves replace cards:** `documentRepository.saveAiStudySet` replaces the whole row with one upsert. Gemini (`gemini.rs`) asks for 10–20 cards. The atomic Slice B import (`study_packet.rs`, `structuredImportTransaction.ts`) creates a new material with up to 500 cards, fronts of at most 1,000 characters and backs of at most 2,000.
- **Malformed data reads as empty:** `jsonArray` turns malformed or non-array `flashcards_json` into `[]`, and item shapes are not validated when read.
- **Current card UI:** `MaterialDetail` shows an in-memory carousel (`cardIndex`, `cardRevealed`) that persists nothing.
- **Material deletion:** `deleteWithUndo` eventually runs one `DELETE FROM study_materials`; `ai_study_sets` cascades with it.
- **Practice precedent (migration 11, `practice_sessions.rs`):**
  - five-second busy timeout, `BEGIN IMMEDIATE`, foreign keys on
  - SHA-256 of canonical JSON for request hashes, with stored receipts for replay and conflict
  - `is_erased` tombstones, and a readiness gate on direct commands
  - the browser and test path runs through the connection owner and `durableWrite`
  - startup validation in `backup.rs` (`verify_application_connection`, `verify_schema_11_semantics`) and `practiceStateValidation.ts`, held equal by `src-tauri/fixtures/practice-validation/cases.json`
- **Schema version:** `CURRENT_SCHEMA_VERSION = 11`, so the **next migration is `0012`**. Migration 11 is practice sessions; the 27 September design's "future migration 11" is historical.

## 3. The user's smallest useful flow

The example uses a synthetic imported material, "Synthetic airspace letters", with three cards (the fixture in the evidence).

**Before:** MaterialDetail shows "Card 1 of 3" with Previous/Next and click-to-reveal. Nothing is remembered, and the next visit starts at card 1.

**After (C1):**

1. **First exposure.** The Flashcards card shows "3 new cards · none due" and a **Review cards** button. The existing browse carousel stays.
2. **Flip and rate.** The session shows one card front. **Show answer** reveals the back. Four buttons appear: **Again** ("see it again in 10 minutes"), **Hard**, **Good** and **Easy**. Each shows the plain next-review time it would set, for example "in 1 day" or "in 3 days".
   - Rating writes once, then advances. While the write is pending, the buttons are locked.
   - Copy: "Your rating only decides when this card comes back. It isn't a score."
3. **Same day.** After rating all three (Good, Again, Easy), the session shows "Done for now · 1 card back in 10 minutes · next review tomorrow". Ten minutes later, the Again card is due.
4. **Return later.** The next day, MaterialDetail shows "1 card due". **Review cards** starts with due cards, then any unseen new cards (at most 10 per session, 20 cards in all).
5. **History.** A compact "Recent reviews" list (paged, 20 rows) shows card front, rating and time. Old versions are labelled "earlier version of these cards".
6. **Suspend / resume.** The card's "…" menu has **Suspend card** and **Resume card**. A suspended card disappears from due counts and stays in the list with its history.
7. **Flag.** **Flag as questionable** (wrong answer / unclear / not in my source) removes the card from review until it's unflagged. The flagged list sits under the card list with **Unflag**.

Everything above reads saved local content. It needs no Gemini key, network or provider call, and practice tests and their results are untouched; ratings are not practice results.

**States and messages**

| Situation | What she sees |
| --- | --- |
| No cards saved | Existing empty state (Gemini or import invitation); no review button |
| Malformed saved cards | "These saved cards can't be reviewed because they're damaged. Your study guide is still here. Regenerating or re-importing creates a fresh set." The browse view keeps today's behavior, and nothing is converted to empty. |
| All cards suspended or flagged | "Nothing to review — all cards are paused or flagged." with links to the lists |
| Nothing due, all seen | "All caught up. Next review: Thu 8 Oct." (local date) |
| Read failure | Fixed text "Card reviews couldn't be loaded just now. Your cards are still here to browse." with **Retry card reviews**, which only repeats the reads (the R14 pattern) |
| Write unconfirmed | "Saving your rating…", then on an unknown outcome "We couldn't confirm that rating. **Try again** resends the same rating; it won't be counted twice." |
| Write refused, stale | "These cards changed since you opened them. **Refresh**" (read-only), followed by a new deliberate rating |
| Clock behind last review | "Your computer's clock is earlier than this card's last review, so this rating wasn't saved. Check the date and time, then try again." |

## 4. Identity, versioning and legacy cards

**Content-addressed versions.** For material `m` with ordered cards `C` (only `front`, `back`, `sourcePage`):

- `content_hash = sha256(canonical_json(C))`, using the sorted-key canonical JSON the app already uses for practice hashes
- `version_id = sha256(m + "\u0000" + content_hash)`
- `item_id = sha256(version_id + "\u0000" + ordinal)`

Golden vectors for the fixture are in `fixtures/identity-golden.json`, computed independently in Python and matched by the proof. Both native and TypeScript implementations must reproduce them.

- **No array index or `updatedAt` identity.** Different text always means a different version, so reviews cannot attach to new text. Duplicate identical cards inside one set stay distinct by ordinal.
- **Stable across restart, backup and restore.** It's derived only from stored text and the material ID.
- **No write path changes and no startup conversion.** Today's Gemini and import saves keep writing `ai_study_sets` as they do. The frozen card snapshot (`card_versions` + `card_items`) is written **inside the first rating transaction** for that content, which also marks it active for the material and deactivates the previous version. Until then, the review screen derives the IDs in pure code, a read with no write.
- **Collisions:** the same `(material, content_hash)` pair maps to the same version. A version for another material is a different ID. A materialized item ID whose stored text doesn't match the derived text is refused as `INVALID_STATE` and flagged by validation.
- **Legacy and malformed sets:** a set is reviewable only if every card validates (1–500 cards; trimmed `front` of 1–1,000 and `back` of 1–2,000 code points; `sourcePage` null or 1–1,000). Otherwise the whole set is refused as `MALFORMED_CARDS`, consistent with practice D4; nothing is silently dropped or converted to empty. Imported sets already satisfy these limits.
- **Never invented:** no past ratings from quiz totals or practice results. Practice question IDs are not card IDs.
- **C-D7 trade-off:** an unseen new card has no row, so a cross-material "new cards" count needs either reading each material's set or a later backfill. That is acceptable for single-material C1 and is an explicit M2-4 input.

## 5. Schema sketch (migration `0012_card_reviews.sql`; not SQL to apply verbatim)

```sql
card_versions(
  id TEXT PRIMARY KEY,                         -- version_id (64 hex)
  source_material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  card_count INTEGER NOT NULL CHECK (card_count BETWEEN 1 AND 500),
  provider TEXT NOT NULL CHECK (provider IN ('gemini','import')),
  first_reviewed_at TEXT NOT NULL,
  is_active INTEGER NOT NULL CHECK (is_active IN (0,1)),
  UNIQUE (source_material_id, content_hash))
UNIQUE INDEX uq_active_card_version ON card_versions(source_material_id) WHERE is_active = 1

card_items(
  id TEXT PRIMARY KEY,                         -- item_id
  version_id TEXT NOT NULL REFERENCES card_versions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  front TEXT NOT NULL, back TEXT NOT NULL, source_page INTEGER,
  UNIQUE (version_id, ordinal))

card_review_state(                             -- current projection, one row per touched item
  item_id TEXT PRIMARY KEY REFERENCES card_items(id) ON DELETE CASCADE,
  source_material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  scheduler_version TEXT NOT NULL,             -- 'simple-v1'
  step INTEGER NOT NULL CHECK (step BETWEEN -1 AND 7),
  due_at TEXT,                                 -- UTC ISO; NULL only before the first rating
  last_reviewed_at TEXT,
  reps INTEGER NOT NULL DEFAULT 0 CHECK (reps >= 0),
  lapses INTEGER NOT NULL DEFAULT 0 CHECK (lapses >= 0),
  suspended INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0,1)),
  flag TEXT CHECK (flag IN ('wrong_answer','unclear','not_in_source')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0))
INDEX idx_card_state_due ON card_review_state(source_material_id, suspended, due_at)

card_review_events(                            -- immutable ratings only
  id TEXT PRIMARY KEY,                         -- = operation_id
  item_id TEXT NOT NULL REFERENCES card_items(id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK (rating IN ('again','hard','good','easy')),
  reviewed_at TEXT NOT NULL,
  scheduler_version TEXT NOT NULL,
  prior_state_json TEXT NOT NULL, next_state_json TEXT NOT NULL)
INDEX idx_card_events_item ON card_review_events(item_id, reviewed_at)

card_review_operations(                        -- receipts; deliberately no FK, so tombstones survive deletion
  operation_id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('rate','suspend','resume','flag','unflag','reset')),
  source_material_id TEXT NOT NULL,
  request_hash TEXT NOT NULL, result_json TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  is_erased INTEGER NOT NULL DEFAULT 0 CHECK (is_erased IN (0,1)))
INDEX idx_card_ops_material ON card_review_operations(source_material_id)

TRIGGER trg_card_ops_material_delete AFTER DELETE ON study_materials
  -> UPDATE card_review_operations SET is_erased = 1, result_json = 'null' WHERE source_material_id = OLD.id
```

The recent-reviews page uses `card_review_events` joined to `card_items` and `card_versions` for one material, ordered by `reviewed_at DESC, id`, with keyset paging of 20 rows. The due query is `card_review_state WHERE source_material_id = ? AND suspended = 0 AND flag IS NULL AND due_at <= ?`. The upper bound is the end of the local day, computed by the client from its current time zone, and the query uses `idx_card_state_due`. Nothing is loaded into `AppDataContext`.

## 6. Contracts

**Write payload** (strict decode with exact keys, bounded IDs and 64 KiB maximum, like practice):

```ts
type CardReviewAction =
  | { action: "rate"; operationId: string; materialId: string; versionContentHash: string;
      itemId: string; expectedRevision: number; rating: "again" | "hard" | "good" | "easy" }
  | { action: "suspend" | "resume" | "unflag"; operationId: string; materialId: string;
      versionContentHash: string; itemId: string; expectedRevision: number }
  | { action: "flag"; /* same keys */ reason: "wrong_answer" | "unclear" | "not_in_source" }
  | { action: "reset"; operationId: string; materialId: string };

type CardReviewResult =
  | { action: "rate" | "suspend" | "resume" | "flag" | "unflag"; itemId: string; revision: number;
      dueAt: string | null; suspended: boolean; flag: string | null; reviewedAt: string | null }
  | { action: "reset"; materialId: string; reset: true };

type CardReviewErrorCode =
  | "INVALID_ARGUMENT" | "OPERATION_CONFLICT" | "OPERATION_ERASED" | "STALE_REVISION"
  | "STALE_CONTENT" | "MALFORMED_CARDS" | "CARD_SUSPENDED" | "CARD_FLAGGED"
  | "CLOCK_BEHIND_LAST_REVIEW" | "NOT_FOUND" | "INVALID_STATE" | "NOT_READY"
  | "STORAGE_ERROR" | "UNSUPPORTED_DRIVER";
```

**Transaction rules** (one native command `save_card_review_atomically`, one browser/test `executeCardReviewAction`):

1. Refuse before any write if the driver lacks the atomic method (`UNSUPPORTED_DRIVER`) or the root isn't ready (`NOT_READY`).
2. Use a dedicated native connection: busy timeout 5 s, foreign keys on, `BEGIN IMMEDIATE`. The browser uses the connection owner plus `durableWrite`.
3. Look up the receipt by `operationId`:
   - identical canonical request hash: return the stored result, with no new event
   - different hash: `OPERATION_CONFLICT`
   - tombstone: `OPERATION_ERASED`
4. Read the material's `ai_study_sets` row and validate it (`MALFORMED_CARDS`). Recompute `content_hash`, which must equal `versionContentHash` (else `STALE_CONTENT`). `itemId` must be one of the derived IDs.
5. Materialize the version and items if absent, and make that version active. Read the projection; its `expectedRevision` must match (else `STALE_REVISION`).
6. For `rate`: refuse if suspended or flagged. Take `now` from the system clock inside the transaction (the client never supplies time). Refuse `CLOCK_BEHIND_LAST_REVIEW` if needed. Run `simple-v1`, insert the event, upsert the projection with `revision + 1`, and store the receipt.
7. Commit. Event, projection and receipt commit together or not at all.

`reset` deletes the material's state, events and inactive versions, keeps the current cards, turns that material's receipts into tombstones and stores its own receipt.

**Client recovery.** Reuse the accepted practice principles in a small hook, not a copy of the practice controller:

- **One write at a time per material**, under a synchronous lock. A duplicate click is ignored, and a queued second rating waits for the first to settle.
- **Lost acknowledgement:** keep the pending `operationId` and its exact payload, and offer **Try again**, which resends it unchanged.
- **Acknowledged write, then refresh fails:** show the acknowledged result; the read-only refresh retries reads only.
- **Restart without pending IDs:** the card simply reloads from storage. If the rating committed, the revision has advanced and the card's new schedule shows; she makes a new deliberate choice.
- **Stale refusal:** refresh, then wait for a new deliberate action.
- **Route change or unmount:** owned request IDs, as in `usePracticeMetadata`, so a late result can't publish into another material.

## 7. Retention, deletion and backup compatibility

- **Material deletion** (C-D4 policy D): `ON DELETE CASCADE` removes versions, frozen text, state and events in the same `DELETE`. The trigger converts that material's receipts to non-content tombstones (operation ID, hash, material ID, timestamp), so a late replay returns `OPERATION_ERASED` and can't recreate state. The delete confirmation must say: "This also removes its card review history."
- **Regeneration / re-save:** `ai_study_sets` is overwritten as today. The old version and its events stay, and the next rating materializes the new version and deactivates the old. The recent-reviews history labels old-version rows.
- **Reset card reviews:** described in section 6. It is explicit, confirmed, and local to one material.
- **Not affected:** practice attempts, practice receipts and Policy A history.
- **Backups:**
  - Format v2 still fits (the database plus documents).
  - A schema-11 or older backup restores into the new app; migration 12 adds empty tables, and no conversion is needed because identity is derived.
  - A schema-12 backup is refused by older apps through the existing ceiling check.
  - Restoring an older backup over newer card history replaces the whole database, as today, and the restore confirmation already warns about that. Tombstones in a restored older database cannot know about later operations, the same disclosed boundary as practice erasure.
- **Startup and archive validation:** `CURRENT_SCHEMA_VERSION` becomes 12. Add `verify_schema_12_card_semantics` to `backup.rs` and the TypeScript twin to `practiceStateValidation.ts`, extending the shared contract fixture with card cases:
  - the reference column, FK, CHECK, index and trigger comparison
  - one active version per material
  - `card_count` equal to the item count, with contiguous ordinals
  - item bounds
  - `item_id` and `version_id` recomputable from stored text and the material
  - `due_at` present after a rating, with step in range
  - event rating, scheduler version and JSON well-formed
  - receipts typed, with tombstones null
- **Immutability:** shipped migrations 1–11 and their checksums don't change; `0012` is added with registration in `lib.rs` `migrations()`, `src/data/migrations.ts` and `migration-checksums.json`.

## 8. The recommended deterministic scheduler, `simple-v1`

A pure function `(prior | null, rating, nowUtc) → next`, with no randomness, clock read or I/O. The intervals and ladder are as in C-D2, and lapses count only when a card on the ladder is rated Again. The state shape `{ schedulerVersion, step, reps, lapses, lastReviewedAt, dueAt }` serializes to JSON. Unknown scheduler versions are refused, never guessed.

It is meant to be explainable to her ("Good moves the card to the next wait: 1 → 3 → 7 → 16 days…"). It's **review scheduling only**: not measured mastery, an FAA result, flight readiness or a prediction of test success, and not a validated aviation training method.

## 9. Open-source scheduler evaluation: `ts-fsrs` (primary sources retrieved 7 October 2026 UTC)

| Fact | Evidence |
| --- | --- |
| **Candidate** | `ts-fsrs` **5.4.2**, npm `latest`, published 2026-09-01. A `6.0.0-beta.13` exists and was not evaluated, since betas are out of scope. |
| **Source** | github.com/open-spaced-repetition/ts-fsrs (`packages/fsrs`), not archived, pushed 2026-10-07, 809 stars, 5 open issues, GitHub release v5.4.2 |
| **License** | **MIT**, "Copyright (c) 2026 Open Spaced Repetition", in both the package and the repository. Attribution obligation: include the copyright and permission notice in distributed copies, for example in a third-party notices file. |
| **Integrity** | Tarball SHA-512 `z4qop4pz…F+v2g==` matches the registry integrity, and SHA-1 matches the shasum. The registry lists an SLSA provenance attestation, which was not cryptographically verified here. 13 files, 150,324-byte tarball. |
| **Dependencies** | **None** (no dependencies, peer or optional). No install lifecycle scripts. `engines.node >= 20`. ESM, CJS and UMD builds. |
| **Network and globals** | No `fetch`, XHR, WebSocket, dynamic import, `require`, `eval`, `localStorage`, `navigator` or `process.env` in `dist/index.mjs`. `console.debug`/`warn` appear only for parameter auto-fill messages. `new Date()` is used only when the caller omits a time (we always inject one). `Date.now()` is used only to seed fuzz when no seed is given. |
| **Bundle** | Built with the repository's esbuild 0.28.2, `--target=safari15` (macOS 12 WebKit 15): **21,277 bytes minified / 6,721 gzip**, against `simple-v1` at 1,289 / 780. Plain ES2015+ with no Node APIs, so it is expected to run in the Tauri WebKit webview and jsdom. Installed WebKit behavior is not verified. |
| **Defaults** | Request retention 0.9; **maximum interval 36,500 days**; fuzz **off**; short-term on; learning steps 1 and 10 minutes; relearning 10 minutes; FSRS-6 weights `w` (21 values) |
| **First exposure (observed)** | Again 1 minute, Hard 6 minutes, Good 10 minutes (Learning); Easy goes to Review in 8 days |
| **Determinism** | Fuzz off: identical input gives identical output. Parameters round-trip through JSON. Fuzz on is reproducible for an identical card and review time, because it uses a seeded Alea PRNG derived from the review time, repetitions and memory state, not `Math.random`. |
| **Maximum interval** | **Not a hard ceiling (observed 182 days with `maximum_interval: 180`).** The source clamps first, then enforces `good ≥ hard + 1` and `easy ≥ good + 1`. Also, `maximum_interval: 0` falls back to the default because of `||`. An app would need its own clamp. |
| **Overdue** | Rewards a delayed successful recall: on time 11 days, 20 days late 34 days |
| **Clock rollback** | Throws `Invalid delta_t "-1"` instead of scheduling, so the app must catch it and refuse with its own message |
| **Upgrade path** | Card state is `{ due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review }`. History-based rescheduling exists (`reschedule`), so future `simple-v1` → FSRS migration from stored events is feasible but would need its own tests. |
| **Optimization** | None in this package. Per-user parameter optimization would mean a separate binding or service; it's excluded, and no history upload. |

**Recommendation: keep deterministic `simple-v1` for C1.** `ts-fsrs` is credible: MIT-licensed, dependency-free, offline and reproducible with injected time. Its observed behavior still argues against adopting it first:

- it introduces minute-scale learning steps and an unbounded-by-default 100-year maximum
- it overruns a configured maximum
- it changes intervals based on overdue time in ways that are harder to explain to one learner
- its main advantage, retention modeling tuned from a personal review history, needs data she doesn't have yet

Storing `scheduler_version` plus immutable events keeps a later, separately reviewed FSRS exception open. That exception would need: an explicit owner/reviewer decision, an application-side clamp, rollback handling, a dependency-review entry in `docs/OPEN_SOURCE_ADOPTION_PLAN_2026-10-01.md`, a third-party notice, and versioned upgrade tests.

## 10. Acceptance cases for C1

1. **Golden identity:** native and TS reproduce `identity-golden.json`. Changed text gives new item IDs; going from text B back to text A returns the same version.
2. **First rating:** materializes exactly one version, three items, one event and one projection, and makes that version active. A second rating on another card reuses the version.
3. **Same `operationId` and payload, retried:** one event, identical result (native and browser), including after restart.
4. **Same ID with a changed payload:** `OPERATION_CONFLICT`, no write. A stale revision gives `STALE_REVISION`, and a later deliberate rating applies.
5. **Changed stored cards** (regeneration between opening and rating): `STALE_CONTENT`, no write. After refresh, a rating materializes the new version, and the old version's events and text remain.
6. **Malformed `flashcards_json`, or one invalid card:** `MALFORMED_CARDS`, no write. The UI shows the damaged-cards message and the guide stays.
7. **Suspend and flag:** the card leaves the due count, refuses ratings, keeps its history, and comes back when resumed or unflagged.
8. **Clock:** a clock behind the last review refuses without writing. Local midnight and time-zone change use injected clock and zone on the queue (stored instants unchanged). An Again card is due only at its instant.
9. **Material delete:** cascades every card row in one statement, tombstones receipts, and a late replay returns `OPERATION_ERASED`. Reset card reviews behaves likewise and keeps the current cards.
10. **Native failure injection:** an event-insert failure rolls back projection and receipt. **Browser storage refusal:** restores the last durable bytes. **Failed recovery:** disables the adapter.
11. **Startup and archive validators** refuse each corrupted card invariant from the shared fixture, natively and in the browser, with matching outcomes. Schema-11 backups restore; schema-13 is refused.
12. **UI (jsdom, real AppDataProvider and disposable SQLite):**
    - first exposure, rate all four, done-for-now summary
    - due-tomorrow return with an injected clock
    - duplicate-click lock, lost-acknowledgement retry with the same ID, read failure with Retry card reviews
    - no Gemini or network call
    - keyboard: Space/Enter reveals, 1–4 rate
13. **Performance:** 500-card set; 10,000 events paged through recent reviews without loading them globally. The full benchmark stays M2-4.

## 11. Proposed slices

- **C1 (one active branch): card reviews in MaterialDetail.** Migration 0012, native module and command, browser and test transaction, validator extension, repository, pure `simple-v1` in `src/logic`, a small `useCardReview` hook and review UI, all with tests. It's end to end: she can review, return and see due cards. Conditional prompt: [M2_CARD_REVIEW_C1_PROMPT_2026-10-06.md](M2_CARD_REVIEW_C1_PROMPT_2026-10-06.md).
- **C2 (later, M2-4):** Library-wide Review due and History views with cross-material paged queries, the new-card backfill decision, and benchmarks at 100 / 2,500 / 5,000 materials and 10,000 review items. It depends on C1 being merged.

**Narrow production files for C1:**

- `src-tauri/migrations/0012_card_reviews.sql`
- `src-tauri/src/lib.rs` (registration, schema version, command)
- new `src-tauri/src/card_reviews.rs`, plus its tests file
- `src-tauri/src/backup.rs` (schema-12 semantics)
- `src-tauri/fixtures/practice-validation/cases.json`, or a new card fixture
- `src/data/migrations.ts`, `src/data/migration-checksums.json`
- `src/data/db.ts` (optional atomic method and types)
- new `src/data/cardReviewTransaction.ts`
- `src/data/sqlJsDb.ts`, `src/data/testing/nodeSqliteDb.ts`, `src/data/tauriDb.ts`
- `src/data/practiceStateValidation.ts`
- `src/data/persistenceErrors.ts`
- new `src/data/repositories/cardReviewRepository.ts`, plus `src/data/repositories/index.ts`
- `src/domain/types.ts`
- new `src/logic/cardScheduler.ts`
- new `src/pages/StudyLibrary/useCardReview.ts` and `CardReviewPanel.tsx`
- `MaterialDetail.tsx`, `studyLibrary.css`
- the material delete confirmation copy
- tests next to each file

## 12. Exclusions

The following are out of scope for this increment:

- multi-material or collection sessions, and the cross-material Review due and History views (M2-4)
- quiz generation from cards, and any provider or Gemini call for review
- FSRS or any new dependency, parameter optimization, and history upload
- FAA or weather APIs, a source viewer, editing cards in place, mobile or iOS, and release, signing or packaging
- installed testing

The four installed Mac observations, signing credentials and lane, version decisions and release gates remain unresolved and are not affected by this scope.
