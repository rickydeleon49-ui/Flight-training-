# P54-06: Adaptive Flashcard Scheduling (FSRS) Technical Evaluation

**EVALUATION REPORT ONLY; NO PRODUCTION CODE OR SCHEDULING CHANGES APPLIED.**
Prepared by Gemini on 17 October 2026 for repository `/Users/rickymac/code/Flight-training-` on branch `gemini/p54-06-adaptive-flashcard-eval`.

---

## 1. Executive Summary

This report evaluates transitioning the flashcard review experience from the current deterministic ladder (`simple-v1`) to the Free Spaced Repetition Scheduler (FSRS) algorithm.

Key findings:
1. **Current Baseline is Robust & Strict:** The existing `simple-v1` scheduler (`src/logic/cardScheduler.ts` and `src-tauri/src/card_reviews.rs`) is protected by comprehensive database constraints (`step BETWEEN -1 AND 7`), content-addressed card identity, transaction idempotency receipts, generation barriers, and strict cross-platform parity between Rust and TypeScript.
2. **Repository Star Threshold:** Direct candidates in the official FSRS organization (`open-spaced-repetition/fsrs-rs` with ~395 stars, and `open-spaced-repetition/ts-fsrs` with ~820 stars) **do not meet the owner's 1,000-star selection threshold**. Only the parent research repository (`fsrs4anki`, ~4.1k stars) qualifies, but it is an Anki-specific add-on / Python ecosystem rather than an embeddable engine. An explicit owner exception is required before taking third-party library dependencies, or the project should adopt an in-house pure-formula implementation.
3. **Data History Can Support FSRS:** Existing `card_review_events` audit logs retain every review timestamp, rating, and card identifier. FSRS can replay history or transition existing cards on their next review. However, current history does not track review duration / answer latency, nor does it contain sufficient volume for custom parameter optimization (which requires 1,000+ reviews). Default FSRS parameters must be used.
4. **Schema & Migration Impact:** Because `card_review_state` has hardcoded SQLite check constraints (`CHECK (step BETWEEN -1 AND 7)` and `CHECK (due_at IS NOT NULL OR (reps = 0 AND step = -1))`), adopting FSRS requires a formal schema migration (Schema 16) to accommodate continuous stability ($S$) and difficulty ($D$) values.
5. **Preserving Imminent Due Dates:** A transition must not rewrite pending due dates in bulk. Existing due dates should remain intact until the student actually reviews each card.

---

## 2. Current Production Baseline (`simple-v1`) Analysis

### 2.1 Architecture & Native-Authoritative Writes
- **Authoritative Native Pipeline:** Flashcard mutations are executed through dedicated immediate SQLite transactions (`save_card_review_atomically` in `src-tauri/src/card_reviews.rs`).
- **Browser/Test Twin:** `src/data/cardReviewTransaction.ts` mirrors the native logic exactly in TypeScript on sql.js and `node:sqlite`.
- **Database Tables (Migration `0012_card_reviews.sql`):**
  - `card_versions`: Content-addressed snapshots (`id`, `source_material_id`, `content_hash`, `card_count`, `provider`, `created_at`, `first_reviewed_at`, `is_active`).
  - `card_items`: Frozen cards within a version (`id`, `version_id`, `ordinal`, `front`, `back`, `source_page`).
  - `card_review_state`: Current scheduling state per card item (`item_id`, `source_material_id`, `scheduler_version`, `step`, `due_at`, `last_reviewed_at`, `reps`, `lapses`, `suspended`, `flag`, `revision`).
  - `card_review_events`: Immutable append-only audit log of ratings (`id`, `item_id`, `generation`, `rating`, `reviewed_at`, `scheduler_version`, `prior_state_json`, `next_state_json`).
  - `card_review_operations`: Idempotency receipts preventing duplicate dispatches (`operation_id`, `action`, `source_material_id`, `generation`, `request_hash`, `applied_at`, `is_erased`, `result_json`).
  - `card_review_generations`: Generation counter for resets (`source_material_id`, `generation`).

### 2.2 Schedulers & State Representation
- **Ladder Model (`simple-v1`):**
  - Rungs in days: `[1, 3, 7, 16, 35, 75, 150, 180]`.
  - Sub-day step: Again delays by 10 minutes (`step = -1`).
  - Rating behavior:
    - `again`: resets to `step = -1`, increments `lapses` (if previously on ladder $\ge 0$).
    - `hard`: stays on current step (minimum 0).
    - `good`: advances 1 step (capped at step 7 / 180 days).
    - `easy`: advances 2 steps (capped at step 7 / 180 days).
  - Intervals are counted strictly from the review time:
    ```ts
    // Intervals count from the review time, so an overdue card is not advanced further for having waited.
    ```
- **Strict Validation Refusals:**
  - `INVALID_RATING`: Rating not in `["again", "hard", "good", "easy"]`.
  - `INVALID_TIME`: Not an exact 24-character UTC ISO string (`YYYY-MM-DDTHH:MM:SS.sssZ`).
  - `UNSUPPORTED_SCHEDULER_VERSION`: Thrown if `prior.schedulerVersion !== "simple-v1"`.
  - `CLOCK_BEHIND_LAST_REVIEW`: Thrown if `now < lastReviewedAt`.

### 2.3 Clock, Calendar, and Timezone Boundaries
- Stored instants in SQLite are always 24-character UTC ISO strings.
- In `src/logic/localDay.ts`, due evaluations are computed against the user's current IANA timezone:
  - `nextLocalMidnightUtc`: Bisection-based search finding the exact UTC instant of the upcoming local midnight (accounting for 23-hour spring-forward and 25-hour fall-back days).
  - In `cardLibraryReader.ts`, a card is due today if `due_at < nextLocalMidnightUtc(now, timeZone)`.
  - Stored due instants are never shifted when the user changes timezones; the interpretation boundary shifts dynamically.

### 2.4 Content-Addressed Identity & Regeneration
- Cards are identified by cryptographic content hashes (`src/logic/cardIdentity.ts`):
  $$content\_hash = \text{sha256}(\text{canonical\_json}(cards))$$
  $$version\_id = \text{sha256}(material\_id + \text{"\0"} + content\_hash)$$
  $$item\_id = \text{sha256}(version\_id + \text{"\0"} + ordinal)$$
- If an AI study set is regenerated or edited:
  - A new version is created with fresh `item_id`s and starts with `reps = 0, step = -1`.
  - If identical text is restored or re-imported, the hash matches and earlier review history is immediately restored.
  - Review state is tied to the exact card text and ordinal; it never drifts across edited content.

### 2.5 Concurrency and Duplicate Submission Protection
- Every request carries an `operationId` (UUID v4) and `expectedRevision` counter.
- If the exact same operation is resent, `save_card_review_atomically` detects the matching `request_hash` in `card_review_operations` and returns the cached `result_json` without re-executing.
- If a different payload reuses an `operationId`, it is rejected with `OPERATION_CONFLICT`.
- If an operation was prepared against an older card state, it is rejected with `STALE_REVISION`.
- If reviews for the material were reset, it is rejected with `STALE_GENERATION`.

---

## 3. Candidate Repository Research

Inspected primary sources as of **17 October 2026**:

| Candidate Repository | URL | Primary Language | License | Latest Inspected Version | GitHub Stars | Star Threshold Status | Maintenance / Activity |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **`fsrs4anki`** | `https://github.com/open-spaced-repetition/fsrs4anki` | Python / JS | MIT | v5.x / v6.x optimizer | **~4,100+** | **Passes (>1,000 stars)** | High; official algorithmic research reference, core of Anki native integration. |
| **`ts-fsrs`** | `https://github.com/open-spaced-repetition/ts-fsrs` | TypeScript | MIT | v6.x (FSRS v6, Node $\ge 20$) | **~820** | **FAILS (<1,000 stars)** | Active; maintained by open-spaced-repetition; ESM/CJS/UMD packages on npm. |
| **`fsrs-rs`** | `https://github.com/open-spaced-repetition/fsrs-rs` | Rust | BSD-3-Clause | v6.6.2 (FSRS v6) | **~395** | **FAILS (<1,000 stars)** | Active; maintained by open-spaced-repetition; crates.io package `fsrs`. |

### Evaluation Against Project Repository Rules
1. **The 1,000-Star Criterion:** The project roadmap stipulates:
   > *"Direct candidate packages must satisfy existing repository-selection criteria or receive an explicit exception; choosing this feature does not silently waive the original 1,000-star filter."*
   - Neither `ts-fsrs` (~820 stars) nor `fsrs-rs` (~395 stars) meets the threshold.
   - While `fsrs4anki` exceeds the threshold (~4,100 stars), it is a full Anki add-on / optimizer script and cannot be cleanly imported as a library into our Tauri/React architecture.
2. **Adoption Options:**
   - **Option A (Explicit Exception):** The owner grants an explicit exception for `ts-fsrs` and/or `fsrs-rs` on the grounds that they are official sub-projects of the reputable `open-spaced-repetition` organization created by the FSRS algorithm authors.
   - **Option B (In-House Pure Formula Implementation - Recommended):** The core FSRS scheduling formula (FSRS-4.5 or FSRS-5) is open, standard, and mathematically concise (~120 lines of code). Implementing the pure formula in-house in Rust and TypeScript achieves 100% testable parity, avoids introducing external supply-chain dependencies to `Cargo.lock` and `package.json`, completely avoids star-threshold violations, and eliminates WebAssembly / CJS bridging complexities.

---

## 4. Algorithm Comparison: `simple-v1` vs. FSRS

### 4.1 Theoretical & Operational Differences

| Feature | `simple-v1` (Current) | FSRS (Target) |
| --- | --- | --- |
| **Model Nature** | Fixed geometric ladder (`[1, 3, 7, 16, 35, 75, 150, 180]` days). | Continuous DSR model (Difficulty $D \in [1, 10]$, Stability $S \ge 0$, Retrievability $R \in [0, 1]$). |
| **Card Adaptivity** | Equal for all cards; rating only determines ladder jump (+0, +1, +2 steps). | Personalized; cards that prove difficult receive shorter intervals; inherently easy cards expand quickly. |
| **Overdue Handling** | **Ignores delay.** A review 90 days late is treated as if reviewed on the due date. | **Rewards recall.** Successfully recalling a card long overdue proves high stability and expands subsequent interval accordingly. |
| **Retention Target** | Implicit; cannot be tuned by user. | Explicit; user selects target retention (e.g. 90%), allowing control over study workload vs recall confidence. |
| **Interval Formula** | $I = \text{LADDER}[\text{step}]$ | $I(r, S) = \frac{S}{\text{FACTOR}} \cdot \left(r^{1/\text{DECAY}} - 1\right)$ where $r$ is target retention. |
| **State Complexity** | Small: `step` (-1 to 7), `reps`, `lapses`. | Medium: `stability` (f64), `difficulty` (f64), `state` (0-3), `reps`, `lapses`. |
| **Code Size** | ~110 lines TS / ~140 lines Rust. | ~150 lines TS / ~180 lines Rust (pure formula). |

### 4.2 Flight Training Pedagogical Fit
- **Ground School & ACS Retention:** Flight concepts range from rapid perishable knowledge (e.g. airspace altitudes, cloud clearance minimums, transponder codes) to durable conceptual models (e.g. lift equations, weather system rotation).
- **The Problem with `simple-v1`:** A pilot studying airspace minimums who rates a card "Hard" repeatedly remains stuck on the ladder, while an overdue review advances too slowly.
- **The FSRS Advantage:** Continuous difficulty adjustments prevent cards from clumping on fixed ladder days. Workload is smoothed across study weeks leading up to checkrides.

---

## 5. Historical Data Capability & Migration Analysis

### 5.1 What Current History Can and Cannot Support
- **What is available in `card_review_events`:**
  - Complete chronological review log: `item_id`, `rating`, `reviewed_at`.
  - Sequential progression across all generations.
- **What is absent:**
  - User response latency (thinking time). Not strictly required by FSRS formula.
  - Prior $S$ and $D$ values (only `step` is recorded).
  - Review volume: Average users will have between 50 and 500 reviews per material set. FSRS parameter optimization (ML gradient descent) requires $>1,000$ reviews to converge safely. **Conclusion: Custom weight optimization cannot be supported; the app must use standardized default FSRS weights.**

### 5.2 Schema Constraints & Schema 16 Migration
In SQLite migration `0012_card_reviews.sql`, `card_review_state` has:
```sql
CREATE TABLE IF NOT EXISTS card_review_state (
    ...
    scheduler_version  TEXT NOT NULL,
    step               INTEGER NOT NULL CHECK (step BETWEEN -1 AND 7),
    ...
    CHECK ((due_at IS NULL) = (last_reviewed_at IS NULL)),
    CHECK (due_at IS NOT NULL OR (reps = 0 AND step = -1))
);
```
- **Constraint Barrier:** FSRS does not use discrete ladder steps (-1 to 7). Attempting to write an FSRS interval into `step` will either fail SQLite check constraints or corrupt the ladder meaning.
- **Required Schema 16 Migration Plan:**
  - Create table migration `0016_fsrs_scheduling.sql`.
  - Options:
    1. *Table Replacement:* Recreate `card_review_state` to make `step` nullable, add `stability REAL`, `difficulty REAL`, `card_state INTEGER DEFAULT 0`.
    2. *Auxiliary Table:* Add `card_fsrs_state` (`item_id REFERENCES card_items(id), stability REAL, difficulty REAL, card_state INTEGER, ...`).
    - *Evaluation:* Modifying `card_review_state` is cleaner for queries, but requires updating `scripts/mac-schema14-profile-snapshot.test.mjs` and verification helpers.

### 5.3 Version Transition & Due Date Preservation Contract
When switching a material or profile to FSRS:
1. **Preserve Pending Due Dates:** Existing cards already scheduled with `due_at` under `simple-v1` MUST NOT have their due dates shifted unexpectedly upon migration. The student's daily review queue remains unchanged.
2. **Transition on First Review:**
   - When a card with `scheduler_version = 'simple-v1'` is reviewed under FSRS:
     - The scheduler initializes FSRS state ($S, D$) based on the card's prior `reps`, `lapses`, and the current rating (or by replaying the card's historical ratings from `card_review_events`).
     - The resulting `CardSchedule` updates `scheduler_version` to `"fsrs-v5"` (or `"fsrs-v6"`).
     - Subsequent reviews operate entirely in FSRS.
3. **Idempotency & Replay:** Stored operations in `card_review_operations` reference historical JSON results. Idempotency guarantees are preserved because `operation_id` replay returns the exact historical result without re-evaluating under the new scheduler.

---

## 6. Cross-Platform Parity & Determinism Challenges

1. **Floating-Point Parity:**
   - In FSRS, $S$ and $D$ are floating-point values. Rust `f64` and JavaScript `Number` (IEEE 754 double precision) can exhibit micro-discrepancies in transcendental functions (`exp`, `pow`) across platforms.
   - If intervals are calculated as raw millisecond timestamps, 1 millisecond of floating-point drift could cause Rust and TypeScript tests to diverge.
   - **Solution:** The scheduler must compute interval in integer days:
     $$\text{interval\_days} = \max(1, \text{round}(I(r, S)))$$
     The due timestamp is then calculated using date-only arithmetic:
     $$\text{due\_ms} = \text{last\_reviewed\_ms} + \text{interval\_days} \times 86400000$$
     This guarantees bit-for-bit identical ISO strings across Rust and TypeScript.
2. **Sub-Day Again Delays:**
   - In `simple-v1`, Again delays by 10 minutes (`step = -1`).
   - In FSRS, learning and relearning steps can also use sub-day minutes (e.g. 10 minutes), transitioning to day intervals on Good/Easy.

---

## 7. Recommended Implementation Slices

If approved by the owner, the implementation should be partitioned into four reviewable, sequential slices:

### Slice 1: Pure Mathematical Engine & Reference Vectors
- Implement in-house deterministic FSRS scheduler (`cardSchedulerFsrs.ts` and `card_scheduler_fsrs.rs`).
- Fix standard default weights ($w_0 \dots w_{18}$).
- Integer-day interval rounding rule.
- Deterministic test harness proving identical outputs across TS and Rust against 100+ golden vector test cases.
- **Acceptance:** Zero production schema changes, zero database writes; pure math validation only.

### Slice 2: Database Schema Migration (Schema 16)
- Register `0016_fsrs_scheduling.sql` in Tauri and sql.js.
- Add `stability`, `difficulty`, `card_state` fields to card state.
- Update schema profile snapshot helper and regression tests.
- **Acceptance:** Clean migration across fresh, upgrade, and restored databases; existing `simple-v1` records preserved.

### Slice 3: State Transition & Authoritative Integration
- Extend `save_card_review_atomically` and `cardReviewTransaction.ts` to support `fsrs-v5`.
- Implement transition logic: on review of a `simple-v1` card, initialize $S$ and $D$ from past reps/lapses and rating.
- Update readers in `cardLibraryReader.ts` and `card_library.rs` to expose stability and difficulty.
- **Acceptance:** Stale revision, duplicate click, clock skew, and replay protection fully verified.

### Slice 4: UI Experience & Target Retention Setting
- Add "Target Retention" slider in Settings (85% to 95%, default 90%).
- Display estimated interval on rating buttons in `CardReviewPanel.tsx`.
- **Acceptance:** Visual parity, accessibility, and smooth card review transitions.

---

## 8. Explicit Owner Decisions Needed

Before any production implementation begins, the owner must make five explicit architectural decisions:

- **[OD-FSRS-1] Third-Party Library vs. In-House Formula:**
  *Options:*
  1. Grant an explicit exception to the 1,000-star rule for `open-spaced-repetition/ts-fsrs` (~820 stars) and `open-spaced-repetition/fsrs-rs` (~395 stars).
  2. *(Recommended)* Implement an in-house pure-formula twin (~150 LOC each in Rust and TS) with zero third-party dependencies, guaranteeing bit-for-bit parity and total supply-chain safety.

- **[OD-FSRS-2] Default Target Retention Rate:**
  *Options:*
  1. *(Recommended)* Standard default of **90%** ($0.90$), balancing retention and daily workload.
  2. Higher retention of **95%** ($0.95$), recognizing high stakes in aviation certification (results in ~2x review workload).

- **[OD-FSRS-3] Transition Strategy for Existing Cards:**
  *Options:*
  1. *(Recommended) Lazy Transition on Next Review:* Keep existing due dates intact; transition individual cards to FSRS when the student next reviews them.
  2. *Immediate Batch Replay:* On migration, replay `card_review_events` for all cards and recalculate due dates immediately (may disrupt current review queues).

- **[OD-FSRS-4] Schema Architecture:**
  *Options:*
  1. *(Recommended)* Alter/recreate `card_review_state` in Schema 16 to support continuous stability and difficulty columns.
  2. Keep `card_review_state` untouched and create an auxiliary `card_review_fsrs_state` table joined on `item_id`.

- **[OD-FSRS-5] User Configuration Exposure:**
  *Options:*
  1. *(Recommended)* Expose an optional "Target Retention" slider in Settings under Study preferences.
  2. Keep retention hardcoded at 90% without user-facing settings.

---

*End of P54-06 Evaluation Report.*
