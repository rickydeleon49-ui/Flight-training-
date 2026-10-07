# M2-3 card review — scope, recommended defaults and scheduler evaluation (6 October 2026, corrected)

**Status: independently accepted for planning; owner production approval remains pending.** See [acceptance](M2_CARD_REVIEW_SCOPE_ACCEPTANCE_2026-10-06.md). This revision closes CRS-R1 (version-owned due queue with exact boundaries) and CRS-R2 (a persistent reset generation) from the [independent review](M2_CARD_REVIEW_SCOPE_REVIEW_2026-10-06.md). The assignment is the [corrections prompt](M2_CARD_REVIEW_SCOPE_CORRECTIONS_PROMPT_2026-10-06.md).

This is still planning plus an isolated research proof. No application code, migration, dependency, lockfile, workflow or capability changed. Existing M2 practice approval does not cover card persistence, scheduling defaults, migration 12 or a new dependency.

Evidence:

- **Original research and proof:** [docs/evidence/m2-card-review-scope-2026-10-06](evidence/m2-card-review-scope-2026-10-06/README.md). Its receipts and manifest are frozen pre-correction snapshots.
- **Corrections:** [docs/evidence/m2-card-review-scope-corrections-2026-10-06](evidence/m2-card-review-scope-corrections-2026-10-06/README.md).

Prepared on branch `codex/m2-card-review-scope` from main `df7a130` (PR #106, PR2 accepted). The recoverable stashes from earlier syncs were not touched.

## 1. Owner decision table (unchanged defaults; one approval)

Approving every recommended default below, once this corrected scope passes re-review, is enough to activate source slice C1 (section 11). The corrections add engineering guards, the review generation and the exact query boundaries, needed to honor these defaults. They are not new product choices.

| # | Decision | Recommended default | Main alternative |
| --- | --- | --- | --- |
| C-D1 | **Scheduler** | **Deterministic `simple-v1`** (section 8). States store a scheduler version so FSRS can be added later as a reviewed, versioned upgrade. | Adopt `ts-fsrs` 5.4.2 now. This needs an explicit owner/reviewer exception replacing the deterministic-first rule, plus an application-side interval clamp (section 9). |
| C-D2 | **Intervals** | Again: 10 minutes. First exposure: Hard 1 day, Good 1 day, Easy 3 days. Ladder: 1, 3, 7, 16, 35, 75, 150, 180 days. Hard repeats the current rung, Good climbs one, Easy climbs two. **Maximum 180 days; minimum 10 minutes** (at least 1 day for any rating other than Again). Intervals count from the review time. No per-user configuration in C1. | A longer maximum, or configurable intervals later |
| C-D3 | **Card identity and replacement** | Content-addressed versions (section 4). Regenerated or edited cards form a new version that starts with new cards. Old reviews stay with the frozen text studied. Identical text (going from text B back to text A) maps to the same version and its retained history, unless it was reset or deleted. | Carry the schedule forward for identical single cards across versions (deferred) |
| C-D4 | **Retention and erasure** | **Card policy D:** deleting a material deletes its card snapshots, state and events in the same `DELETE`. Only non-content receipt tombstones remain, so late replay is refused. A per-material **Reset card reviews** action erases that material's card state and events, keeps the current cards, prunes older snapshots and advances the material's **review generation**, so no request prepared before the reset can apply afterwards. Regeneration keeps old versions until reset or deletion. | Retain frozen card text after deletion (Policy A style), not recommended |
| C-D5 | **Due ordering and time zone** | Absolute UTC instants are stored. Again-step cards are due at their exact instant (`due_at <= now`). Day-ladder cards are due before the **exclusive next local midnight** in the current time zone, with daylight saving handled exactly. Only the current card set's version counts. Order: eligible Again cards by due instant, then other due cards by due instant, then new cards by card order. Caps of **10 new / 20 cards per session** apply after eligibility. A clock earlier than the card's last review refuses the rating. | Snap day-cards to local 4 a.m. |
| C-D6 | **Suspended and flagged** | Both work on any current card, including never-rated ones. Both are excluded from due and new work and refuse ratings until resumed or unflagged, keeping history and leaving the schedule unchanged. "Flag" means *questionable content* (wrong answer / unclear / not in my source); "Suspend" means *not now*. | Flagged cards stay reviewable with a badge |
| C-D7 | **Navigation** | C1 works inside MaterialDetail: due summary, Review cards session, recent reviews, flagged list and Reset card reviews. The Library-wide **Review due** and **History** views belong to M2-4. | Cross-material Review due in C1 |
| C-D8 | **Dependency** | No new production dependency. `ts-fsrs` stays research evidence only. | — |

## 2. What exists today (verified on main `df7a130`)

- **Card storage:** `ai_study_sets` (migration 7) holds one row per material, with `flashcards_json` items `{ front, back, sourcePage }` and no IDs.
- **How saves replace cards:** `saveAiStudySet` replaces the row with one upsert. Gemini asks for 10–20 cards. The atomic Slice B import creates a new material with up to 500 cards (front at most 1,000 characters, back at most 2,000).
- **Malformed data reads as empty:** `jsonArray` turns malformed JSON into `[]`.
- **Current card UI:** the MaterialDetail carousel persists nothing.
- **Material deletion:** one `DELETE FROM study_materials` after the undo window.
- **Practice precedent (migration 11, `practice_sessions.rs`):**
  - five-second busy timeout, `BEGIN IMMEDIATE`, foreign keys on
  - canonical-JSON SHA-256 request hashes and receipts
  - `is_erased` tombstones, and a readiness gate
  - browser connection owner plus `durableWrite`
  - startup and archive validators, held equal by a shared fixture
- **Schema version:** `CURRENT_SCHEMA_VERSION = 11`, so the **next migration is `0012`**.

## 3. The user's smallest useful flow

The example is a synthetic imported material, "Synthetic airspace letters", with three cards.

**Before:** a stateless "Card 1 of 3" carousel.

**After (C1):**

1. **Summary.** The Flashcards card shows "3 new cards · none due" and **Review cards**. The browse carousel stays.
2. **Session.**
   - **Show answer**, then **Again** ("again in 10 minutes"), **Hard**, **Good** or **Easy**, each labelled with the next wait it would set.
   - One rating is in flight at a time, with the buttons locked.
   - The session advances only on an acknowledged result for the card shown, and a replayed acknowledgement never advances twice.
   - The session's cards are fixed when it starts: at most 20 unique cards, at most 10 of them new.
   - Copy: "Your rating only decides when this card comes back. It isn't a score."
3. **Same day.** After Good, Again and Easy: "Done for now · 1 card back in 10 minutes · next review tomorrow". The Again card appears at minute ten, not before.
4. **Return later.** "1 card due" opens a session with due cards first, then unseen new cards.
5. **Regenerated cards.** The new cards appear as new. Earlier reviews show only in Recent reviews, marked "earlier version of these cards", and never as due work.
6. **History.** "Recent reviews" is paged in 20s, with card front, rating and time.
7. **Suspend / flag.** Both are available from a card's "…" menu even before the card is ever rated. Suspended and flagged cards leave due and new work and are listed with **Resume** / **Unflag**.
8. **Reset card reviews.** A secondary button at the bottom of the Flashcards card opens a confirmation: "Reset card reviews for *Synthetic airspace letters*? This removes the review schedule and rating history for this material's cards. Your saved cards, study guide and practice tests stay. Backups you've already made are not changed."
   - The action is **Reset reviews**; the default focus is **Cancel**.
   - While pending, the dialog locks.
   - On an unknown outcome: "We couldn't confirm the reset. **Try again** resends the same reset request and can't reset twice." The only other choice is **Check again**, which reads only. The app never sends a second, new reset automatically.

Everything works offline, with no Gemini key or network. Practice tests and their results are untouched; ratings are not practice results.

**States and messages**

| Situation | What she sees |
| --- | --- |
| No cards saved | Existing empty state; no review controls |
| Malformed saved cards | "These saved cards can't be reviewed because they're damaged. Your study guide is still here. Regenerating or re-importing creates a fresh set." The browse view keeps today's behavior. |
| All current cards suspended or flagged | "Nothing to review — all cards are paused or flagged." |
| Nothing due, all seen | "All caught up. Next review: Thu 8 Oct." |
| Read failure | "Card reviews couldn't be loaded just now. Your cards are still here to browse." **Retry card reviews** repeats reads only. |
| Write unconfirmed | "We couldn't confirm that rating. **Try again** resends the same rating; it won't be counted twice." |
| Acknowledged (or replayed), then refresh fails | The confirmed result shows, for example "Saved: back in 3 days". Rating, advancing, suspend/flag and reset stay **locked** until **Retry card reviews** reads succeed. A historical replay result is never treated as the current generation or revision. |
| Stale (generation, revision or content) | "These cards changed since you opened them." Read-only **Refresh**, then a new deliberate action |
| Clock behind last review | "Your computer's clock is earlier than this card's last review, so this rating wasn't saved…" |

## 4. Identity, versioning and materialization

For material `m` with ordered cards `C` (only `front`, `back`, `sourcePage`):

- `content_hash = sha256(canonical_json(C))`
- `version_id = sha256(m + "\u0000" + content_hash)`
- `item_id = sha256(version_id + "\u0000" + ordinal)`

The canonical JSON is sorted-key, as in practice hashing. The golden vectors in `proof/fixtures/identity-golden.json` were computed independently in Python; native and TypeScript code must both reproduce them.

- **No array index or `updatedAt` identity.** Duplicate identical cards stay distinct by ordinal. Identity is stable across restart, backup and restore.
- **The current version is always derived, never trusted from storage.** Every read derives it from the material's current `ai_study_sets.flashcards_json`. The stored `is_active` marker is a convenience for validation and history labels; queue eligibility never relies on it, because B can be current while only A is materialized.
- **Materialization happens on the first item mutation of any kind** (rate, suspend, resume, flag or unflag), inside that transaction. It writes `card_versions` with `created_at = now` and `first_reviewed_at = NULL`, plus all `card_items`, and marks it active. The first *rating* sets `first_reviewed_at`. A suspend or flag on a never-rated card creates a projection with `due_at = NULL` and `last_reviewed_at = NULL` and **no rating event**; that card stays new.
- **Reads never write.** Unmaterialized current cards are presented from derived identities.
- **Collisions:** the same `(material, content_hash)` pair gives the same version. A stored item whose text differs from the derived text is `INVALID_STATE` and a validator refusal.
- **Legacy and malformed sets:** a set is reviewable only if every card validates (1–500 cards; trimmed front of 1–1,000 and back of 1–2,000 code points; `sourcePage` null or an integer 1–1,000). Otherwise the whole set is refused as `MALFORMED_CARDS`. Nothing is converted to empty, and no past ratings are invented from quiz totals or practice results.

**Reviewer compatibility clarification:** an absent card set or a valid empty `flashcards_json` array is `current.status = "none"`, not damaged content. Accepted guide-only study packets can legitimately save an empty array. A nonempty reviewable set must satisfy the 1–500 item limits; malformed JSON or invalid items yield `malformed`. No zero-item card version is materialized, and the guide remains available.

## 5. Schema sketch (migration `0012_card_reviews.sql`; not SQL to apply verbatim)

```sql
card_review_generations(                      -- the reset barrier; no row means generation 0
  source_material_id TEXT PRIMARY KEY REFERENCES study_materials(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK (generation >= 0))

card_versions(
  id TEXT PRIMARY KEY,                         -- version_id
  source_material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  card_count INTEGER NOT NULL CHECK (card_count BETWEEN 1 AND 500),
  provider TEXT NOT NULL CHECK (provider IN ('gemini','import')),
  created_at TEXT NOT NULL,                    -- snapshot creation (first item mutation)
  first_reviewed_at TEXT,                      -- first rating; NULL until then
  is_active INTEGER NOT NULL CHECK (is_active IN (0,1)),
  UNIQUE (source_material_id, content_hash))
UNIQUE INDEX uq_active_card_version ON card_versions(source_material_id) WHERE is_active = 1

card_items(
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES card_versions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  front TEXT NOT NULL, back TEXT NOT NULL, source_page INTEGER,
  UNIQUE (version_id, ordinal))

card_review_state(
  item_id TEXT PRIMARY KEY REFERENCES card_items(id) ON DELETE CASCADE,
  source_material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  scheduler_version TEXT NOT NULL,             -- 'simple-v1'
  step INTEGER NOT NULL CHECK (step BETWEEN -1 AND 7),
  due_at TEXT,                                 -- NULL only while never rated
  last_reviewed_at TEXT,                       -- NULL only while never rated
  reps INTEGER NOT NULL DEFAULT 0 CHECK (reps >= 0),
  lapses INTEGER NOT NULL DEFAULT 0 CHECK (lapses >= 0),
  suspended INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0,1)),
  flag TEXT CHECK (flag IN ('wrong_answer','unclear','not_in_source')),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  CHECK ((due_at IS NULL) = (last_reviewed_at IS NULL)),
  CHECK (due_at IS NOT NULL OR (reps = 0 AND step = -1)))
INDEX idx_card_state_due ON card_review_state(source_material_id, suspended, due_at)

card_review_events(                            -- immutable ratings only
  id TEXT PRIMARY KEY,                         -- = operation_id
  item_id TEXT NOT NULL REFERENCES card_items(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL CHECK (generation >= 0),
  rating TEXT NOT NULL CHECK (rating IN ('again','hard','good','easy')),
  reviewed_at TEXT NOT NULL,
  scheduler_version TEXT NOT NULL,
  prior_state_json TEXT NOT NULL, next_state_json TEXT NOT NULL)
INDEX idx_card_events_item ON card_review_events(item_id, reviewed_at)

card_review_operations(                        -- receipts; no FK, so tombstones outlive deletion
  operation_id TEXT PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('rate','suspend','resume','flag','unflag','reset')),
  source_material_id TEXT NOT NULL,            -- routing metadata, never nulled
  generation INTEGER NOT NULL CHECK (generation >= 0),  -- generation the request captured
  request_hash TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  is_erased INTEGER NOT NULL DEFAULT 0 CHECK (is_erased IN (0,1)),
  result_json TEXT,                            -- content; NULL exactly when erased
  CHECK ((is_erased = 1) = (result_json IS NULL)))
INDEX idx_card_ops_material ON card_review_operations(source_material_id)

TRIGGER trg_card_ops_material_delete AFTER DELETE ON study_materials
  -> UPDATE card_review_operations SET is_erased = 1, result_json = NULL
     WHERE source_material_id = OLD.id AND is_erased = 0
```

**Timestamp format.** Every stored instant is the 24-character UTC form `YYYY-MM-DDTHH:MM:SS.sssZ` (`Date#toISOString`, or `strftime('%Y-%m-%dT%H:%M:%fZ')` natively), so text order is chronological. Validators refuse any other form.

## 6. Contracts

### Reads (no writes; `AppDataContext` is not used)

```ts
interface CardReviewSnapshot {
  materialId: string;
  generation: number;                       // 0 when no generations row exists
  current: { status: "ok"; versionId: string; contentHash: string;
             items: { itemId: string; ordinal: number; front: string; back: string; sourcePage: number | null }[] }
         | { status: "none" } | { status: "malformed" };
  states: Record<string, { revision: number; step: number; dueAt: string | null; lastReviewedAt: string | null;
                           suspended: boolean; flag: string | null }>; // keyed by current itemId; absent = untouched, revision 0
}
getCardReviewSnapshot(materialId): Promise<CardReviewSnapshot>
getDueQueue(input: { materialId: string; currentVersionId: string; currentItemIds: string[];
                     nowUtc: string; nextLocalMidnightUtc: string;   // exclusive boundary
                     maxNew?: 10; maxTotal?: 20 }): Promise<{ itemId: string; kind: "again" | "due" | "new"; dueAt: string | null; ordinal: number }[]>
getRecentReviews(materialId, cursor?: { reviewedAt: string; id: string }): Promise<{ rows: …; next: … | null }>  // 20 per page, may include earlier versions, labelled
```

- **Current raw identity:** the native and browser paths read the same `ai_study_sets` row through `select` and derive the version in shared pure code (`src/logic/cardIdentity.ts`, with a Rust twin used only on writes). Neither persists anything during a read.
- **Read races:** a regeneration between the snapshot read and the queue read can only make the queue advisory-stale. Every write rechecks `versionContentHash` and `expectedGeneration` and refuses with `STALE_CONTENT` or `STALE_GENERATION`.
- **Due SQL** (proved in `proof/cardQuery.mjs`):

  ```sql
  SELECT s.item_id, s.step, s.due_at, i.ordinal FROM card_review_state s
  JOIN card_items i ON i.id = s.item_id
  WHERE i.version_id = :currentVersionId AND s.source_material_id = :materialId
    AND s.suspended = 0 AND s.flag IS NULL AND s.due_at IS NOT NULL
    AND ((s.step < 0 AND s.due_at <= :nowUtc) OR (s.step >= 0 AND s.due_at < :nextLocalMidnightUtc))
  ORDER BY CASE WHEN s.step < 0 THEN 0 ELSE 1 END, s.due_at, i.ordinal, s.item_id
  LIMIT :maxTotal
  ```

- **New cards:** current derived items with no state row, or with a row where `due_at IS NULL AND suspended = 0 AND flag IS NULL` (looked up with `WHERE item_id IN (SELECT value FROM json_each(:currentItemIds))`). They are ordered by ordinal and capped at `min(maxNew, maxTotal − due count)`.
- **Next local midnight:** the client computes `nextLocalMidnightUtc` from its current IANA zone as the first instant whose local date is after today's. It is exact across 23- and 25-hour days, and stored instants are never rewritten.

### Writes: one typed union, canonical request identity

```ts
type CardItemAction = {
  operationId: string;            // UUIDv4
  materialId: string;
  versionContentHash: string;     // 64 hex, from the snapshot
  itemId: string;                 // a current derived item
  expectedGeneration: number;     // from the snapshot
  expectedRevision: number;       // 0 when untouched
} & ( { action: "rate"; rating: "again" | "hard" | "good" | "easy" }
    | { action: "suspend" | "resume" | "unflag" }
    | { action: "flag"; reason: "wrong_answer" | "unclear" | "not_in_source" } );

type CardResetAction = { action: "reset"; operationId: string; materialId: string; expectedGeneration: number };
type CardReviewAction = CardItemAction | CardResetAction;   // exact keys per branch; anything else is INVALID_ARGUMENT

type CardReviewResult =
  | { action: CardItemAction["action"]; itemId: string; generation: number; revision: number;
      dueAt: string | null; reviewedAt: string | null; suspended: boolean; flag: string | null }
  | { action: "reset"; materialId: string; generation: number };   // the new generation

type CardReviewErrorCode =
  | "INVALID_ARGUMENT" | "OPERATION_CONFLICT" | "OPERATION_ERASED" | "STALE_GENERATION"
  | "STALE_REVISION" | "STALE_CONTENT" | "MALFORMED_CARDS" | "CARD_SUSPENDED" | "CARD_FLAGGED"
  | "CLOCK_BEHIND_LAST_REVIEW" | "NOT_FOUND" | "INVALID_STATE" | "NOT_READY"
  | "STORAGE_ERROR" | "UNSUPPORTED_DRIVER";
```

Request identity is `sha256(canonical_json(action))` over the whole typed payload, so every field takes part, including `expectedGeneration`.

**Transaction (native `save_card_review_atomically`; browser/test `executeCardReviewAction`):**

1. **Before any write:** `UNSUPPORTED_DRIVER` if the atomic method is missing, `NOT_READY` if the root isn't ready, `INVALID_ARGUMENT` on a strict two-pass decode failure (exact keys per branch, 64 KiB, bounded IDs).
2. **Open:** a dedicated native connection (busy timeout 5 s, foreign keys on, `BEGIN IMMEDIATE`). The browser uses the connection owner plus `durableWrite`.
3. **Replay first:** look up the receipt by `operation_id`.
   - Different `request_hash`: `OPERATION_CONFLICT`.
   - Else `is_erased = 1`: `OPERATION_ERASED`.
   - Else return the stored `result_json` and commit nothing new. This precedence matches practice receipts. A replayed committed reset therefore never advances the generation again and never erases later work.
4. **Generation barrier:** read `generation` (0 if absent); it must equal `expectedGeneration`, else `STALE_GENERATION`.
5. **Item branch:**
   - Read and validate `ai_study_sets` (`NOT_FOUND`, `MALFORMED_CARDS`), derive the version, and compare `versionContentHash` (`STALE_CONTENT`). The `itemId` must be derived (`NOT_FOUND`).
   - Materialize if absent (section 4) and set this version active, the others inactive.
   - Check `expectedRevision` against the projection (absent means 0), else `STALE_REVISION`.
   - **rate:** refuse `CARD_SUSPENDED` or `CARD_FLAGGED`. Take `now` from the system clock inside the transaction (never from the client) and check `CLOCK_BEHIND_LAST_REVIEW`. Run `simple-v1`, insert the event with the generation, upsert the projection with `revision + 1`, and set `first_reviewed_at` if null.
   - **suspend / resume / flag / unflag:** upsert the projection with `revision + 1`, with no event and no schedule change.
   - Insert the receipt (action, material, captured generation, hash, result).
6. **Reset branch** (no item fields):
   - Delete the material's projections and events.
   - Prune `card_versions` (cascading items) for the material, except the version derived from the **current** raw set, which is kept with `first_reviewed_at = NULL`. If the set is absent or malformed, prune all.
   - Tombstone the material's live receipts (`is_erased = 1`, `result_json = NULL`; rows already tombstoned are skipped).
   - Upsert `generation = expected + 1`, and insert the reset receipt with result `{ action: "reset", materialId, generation }`.
   - The current raw cards, study guide, practice data and other materials are untouched.
7. **Commit.** Every write in steps 5–6 commits together or not at all. Any refusal leaves projection, event, receipt and generation counts unchanged.

### Client recovery (a small `useCardReview` hook, not a copy of the practice controller)

- **One write at a time per material,** under a synchronous lock.
- **Owned request IDs** (as in `usePracticeMetadata`), so route change and unmount cannot publish.
- **Pending operations** keep their `operationId` and exact payload for **Try again**.
- **Reset** gets the same treatment, plus read-only **Check again**, and never an automatic second reset.
- **Acknowledged result, then refresh failure:** show the confirmed acknowledgement, but keep conflicting actions locked until an authoritative snapshot read succeeds. Replay results never supply the current generation or revision.
- **Restart without pending IDs:** reload the snapshot; she then takes a new deliberate action.

## 7. Retention, deletion and backup compatibility

- **Material deletion** (C-D4): cascades generations, versions, items, state and events in the same `DELETE`. The trigger tombstones receipts while keeping material, generation, action and hash, so a late replay gets `OPERATION_ERASED`. The confirmation adds "This also removes its card review history."
- **Regeneration:** `ai_study_sets` is overwritten as today. Old versions and events remain as history but are never due work. The next item mutation materializes the new version.
- **Reset:** section 6. An uncommitted pre-reset request carries the old generation and is refused by the barrier, which tombstones alone could not do (shown by the corrected model).
- **Not affected:** practice attempts, receipts and Policy A history.
- **Backups:**
  - Format v2 fits.
  - Schema 11 or older restores into the new app: migration 12 adds empty tables (generation 0 everywhere), with no conversion.
  - Older apps refuse schema 12 through the existing ceiling check.
  - Restoring an older backup replaces the database as today, and the existing restore warning covers that. Restored tombstones and generations can't know about operations made after that backup, the same disclosed boundary as practice erasure.
- **Startup and archive validation** (`verify_schema_12_card_semantics` in `backup.rs`, the TS twin in `practiceStateValidation.ts`, shared accept/refuse fixtures). Beyond the reference column, FK, CHECK, index and trigger comparison:
  - **Ownership:** every `card_items.version_id`, and every state, event and generation row, belongs to an existing material. A state's `source_material_id` equals its item's version's material. At most one active version per material.
  - **Identity:** `version_id` and `item_id` can be recomputed from stored text, material and ordinal. `card_count` equals the item count, ordinals are contiguous, and items are within bounds.
  - **Generation:** `generation >= 0`. Every live receipt's and event's `generation` is at most its material's current generation (counting a missing row as 0). After a reset, no live item receipt or event has a generation below the current one.
  - **Receipts:** typed by action. Live receipts carry a result matching their action shape (item results name an item of that material; reset results carry `generation = captured + 1`). Tombstones have a NULL result while keeping material, generation, action and hash. Request hashes are 64 hex characters.
  - **Events against the projection:** each rated state's `revision` is at least its live event count. `reps` equals the number of current-generation events for the item. `last_reviewed_at` and `due_at` equal the latest event's `next_state_json` values. `step` and `due_at` are consistent with the scheduler version. A never-rated state has no events and NULL instants.
  - **Timestamp format:** as in section 5.
- **Immutability:** shipped migrations 1–11 and their checksums don't change. `0012` is registered in `lib.rs`, `src/data/migrations.ts` and `migration-checksums.json` only in C1.

## 8. The recommended deterministic scheduler, `simple-v1`

Unchanged and accepted. A pure function `(prior | null, rating, nowUtc) → next`: no randomness, clock read or I/O, and versioned state with unknown versions refused. Review scheduling only: not mastery, an FAA result, readiness or a prediction of test success, and not a validated aviation training method.

## 9. Open-source scheduler evaluation: `ts-fsrs` 5.4.2

Unchanged and independently verified in the review; see the original evidence (`PRIMARY_SOURCES.md`, `receipts/library-evidence.txt`):

- MIT-licensed, with no dependencies, and offline; the integrity matches.
- Defaults: maximum interval 36,500 days and learning steps of 1 and 10 minutes.
- Observed: it exceeded a configured 180-day maximum (182), throws on clock rollback, rewards overdue recall, and fuzz is seeded.
- Bundle: 6.7 KB gzipped.

**Recommendation unchanged: `simple-v1` first.** A later FSRS exception needs explicit owner/reviewer approval, an application-side clamp, rollback handling, a dependency-plan entry, a third-party notice and versioned upgrade tests.

## 10. Acceptance cases and CRS-R1/R2 requirement-to-test map

Proof tests are in `docs/evidence/m2-card-review-scope-2026-10-06/proof/corrections.test.mjs` (SQLite query proof and in-memory model); C1 must re-prove them against the real native and browser paths.

| Requirement | Proof case (this package) | C1 production test required |
| --- | --- | --- |
| R1: Again not due at minute 9, due at minute 10 | `[promoted 1] an Again card is not returned at minute nine and is returned first at minute ten` | Repository query on both drivers |
| R1: exclusive next local midnight | `a day-ladder card due exactly at next local midnight is excluded; one millisecond earlier is included` | The same, with an injected zone |
| R1: daylight saving | `daylight saving: the 25-hour local day in Chicago (1 November 2026) gets the exact exclusive boundary` | The same |
| R1: old A versus current materialized B | `[promoted 2] with old A and current materialized B both due, only B is current due work` | Both drivers, after a real regeneration |
| R1: B before first materialization | `before B's first materialization, B's cards are new and A's retained due rows are not current work` | The same |
| R1: A→B→A reuse | `A -> B -> A: when the raw cards return to A, A's retained schedule is current again` | The same |
| R1: suspended/flagged new cards excluded | `never-rated suspended and flagged cards are excluded from new work before the caps` | The same, plus UI |
| R1: order and limits after eligibility | `order and limits apply after eligibility, even behind many ineligible older rows` | 500-card set plus 10,000 events |
| R1: session cap and replay | `session membership counts unique presented cards; a replayed acknowledgement does not advance twice` | jsdom session with a lost acknowledgement and replay |
| R2: uncommitted pre-reset rev-0 refused | `[promoted 3] an uncommitted pre-reset revision-0 rating is refused after reset, with nothing written` | Native and browser: reset racing a queued rating |
| R2: pre-reset rev-1 refused after new rev 1 | `[promoted 4] a pre-reset revision-1 request stays refused after a new-generation rating reaches revision 1` | The same |
| R2: repeated reset; safe tombstones | `[promoted 5] repeated resets succeed; already tombstoned receipts are skipped safely and keep routing metadata` | Native and browser |
| R2: committed reset replay after new work | `an identical committed-reset replay after new work returns its stored result and erases nothing` | Native and browser, reopen then replay |
| R2: changed payload; stale reset | `reusing a reset operation ID with a changed payload conflicts; a stale-generation reset is refused` | The same |
| R2: fresh work and new reset | `fresh work after refresh with the current generation is accepted, and a new intentional reset applies again` | The same |
| R2: unrelated material isolation | `reset touches only its material: another material's state, events, receipts and generation remain` | The same, including practice data untouched |
| R2: typed reset branch | `reset is strictly typed: item fields on a reset, or a missing generation on an item action, are invalid` | Strict decode on both drivers |
| R2: reset keeps current snapshot, prunes old | `reset keeps the snapshot of the current raw cards and prunes retained older versions` | The same |
| First suspend before any rating | `first suspend works on a never-rated card: the snapshot is created without a review time or fabricated event` | Both drivers |
| Flag refuses rating | `a flagged card refuses ratings until unflagged, without changing its schedule` | Both drivers, plus UI |
| Stale content | `an item action against changed raw cards is refused as stale content` | Both drivers |

C1 must additionally prove the following on the real paths:

- golden identity (native and TypeScript)
- same-ID replay after reopen
- malformed sets
- clock rollback
- material-delete cascade, tombstones and replay refusal
- native failure-injection rollback (event or generation insert fails, so nothing commits)
- browser storage refusal, and failed recovery disabling the adapter
- validator parity on the shared card fixture
- schema-11 backup restore and schema-13 refusal
- jsdom UI: no Gemini call; duplicate-click lock; lost-acknowledgement retry; acknowledged-then-refresh-failure lock; Reset confirmation with pending and unknown retry and read-only Check again; keyboard (Space/Enter reveals, 1–4 rate)

## 11. Proposed slices

- **C1 (one active branch): card reviews in MaterialDetail, end to end.** Migration 0012, native module and command, browser and test transaction, validators, repository, pure scheduler and identity in `src/logic`, `useCardReview`, the review panel, and Reset. Conditional prompt: [M2_CARD_REVIEW_C1_PROMPT_2026-10-06.md](M2_CARD_REVIEW_C1_PROMPT_2026-10-06.md).
- **C2 (later, M2-4):** cross-material Review due and History, the new-card backfill decision, and the 100 / 2,500 / 5,000-material and 10,000-review benchmarks. It depends on C1 being merged.

**Narrow production files for C1:**

- `src-tauri/migrations/0012_card_reviews.sql`
- `src-tauri/src/lib.rs`
- new `src-tauri/src/card_reviews.rs`, plus `card_reviews_tests.rs`
- `src-tauri/src/backup.rs`
- a shared fixture: new `src-tauri/fixtures/card-validation/cases.json`
- `src/data/migrations.ts`, `src/data/migration-checksums.json`
- `src/data/db.ts`
- new `src/data/cardReviewTransaction.ts`
- `src/data/sqlJsDb.ts`, `src/data/testing/nodeSqliteDb.ts`, `src/data/tauriDb.ts`
- `src/data/practiceStateValidation.ts`
- `src/data/persistenceErrors.ts`
- new `src/data/repositories/cardReviewRepository.ts`, plus `src/data/repositories/index.ts`
- `src/domain/types.ts`
- new `src/logic/cardScheduler.ts`, `src/logic/cardIdentity.ts`, `src/logic/localDay.ts`
- new `src/pages/StudyLibrary/useCardReview.ts`, `CardReviewPanel.tsx`, `ResetCardReviewsDialog.tsx`
- `MaterialDetail.tsx`, `studyLibrary.css`
- the material delete confirmation copy
- tests next to each file

## 12. Exclusions

The following are out of scope for this increment:

- multi-material or collection sessions, and cross-material views (M2-4)
- quiz generation from cards, and any provider or Gemini call
- FSRS or any new dependency, optimization, and history upload
- FAA or weather APIs, a source viewer, editing cards in place, mobile or iOS
- release, signing, packaging and installed testing

The four installed Mac observations, signing credentials and lane, version decisions and release gates remain unresolved.

## Corrections log (CRS-R1/R2, 6 October 2026)

- **CRS-R1:** the end-of-day bound applied to every card and the material-only filter are replaced by the version-owned, two-boundary query above. The new-card query and the post-eligibility caps are specified, the read API carries `nowUtc` and the exclusive `nextLocalMidnightUtc`, and the queue is proved in disposable `node:sqlite`.
- **CRS-R2:** added the `card_review_generations` barrier, receipt routing metadata separate from nullable `result_json`, a strictly typed reset branch and its transaction, and safe tombstoning, proved in the corrected model.
- **Handoff details:** materialization on any first item mutation, with `created_at` separate from `first_reviewed_at`; suspend/flag on never-rated cards; the acknowledged-then-refresh-failure lock; the Reset UI and confirmation; stronger validator invariants.
- **Unchanged:** defaults C-D1–C-D8, the scheduler arithmetic, the identity vectors and the FSRS research.
