# P54-06 adaptive-flashcard scheduling: corrected technical evaluation

**Evaluation only. No production scheduler, dependency, migration, retention setting or repository-rule exception is adopted.** Gemini's original evaluation is preserved at `e8da4d5`; this revision follows independent source review on 17 October 2026. Baseline application source is accepted main `2fc27b9`.

## Recommendation and next bounded step

Keep `simple-v1` in production. Before asking the owner to choose a migration, library exception or retention slider, prepare a disposable feasibility comparison of one precisely pinned FSRS algorithm against the current baseline. Measure correctness, complexity and behavioral differences using synthetic histories. The evaluation must establish a reference-vector and transition contract before a production implementation is assigned.

The official TypeScript and Rust ports remain below the1,000-star direct-adoption threshold. A popular research repository does not qualify a different port. Options remain an explicitly approved exception, or a separately reviewed implementation of a precisely identified algorithm with proper source/license attribution. An in-house implementation does not automatically guarantee parity, safety, correctness or less maintenance. Neither route is selected here.

## Verified current implementation

- `src/logic/cardScheduler.ts`: deterministic `simple-v1`, ladder `[1,3,7,16,35,75,150,180]` days; Again waits10 minutes. Hard stays at the current rung (at least0), Good advances one and Easy two, capped at7. Due time is computed from **actual review time**. Lateness does not increase the selected rung; the implementation does not pretend a late review happened on its old due date.
- `src-tauri/src/card_reviews.rs`: native-authoritative transactional mutations with a TypeScript twin in `src/data/cardReviewTransaction.ts`. Keep operation receipts, request hashes, revisions and generation barriers intact.
- `src/logic/cardIdentity.ts`: identity includes ordered front/back/sourcePage content, the material and ordinal. Changed content creates a new version; identical content can recover **retained** history. This does not recreate erased history.
- `src-tauri/migrations/0012_card_reviews.sql`: current state holds scheduler version, discrete step, timestamps, reps/lapses, suspension/flag and revision. `due_at` is nullable for an unreviewed state. The step and paired-timestamp constraints must keep their existing meaning.
- `src/logic/localDay.ts` and the library readers separate absolute UTC due instants from the user's local due-today boundary. Any new scheduler must preserve that distinction and the existing clock-backward refusal.

### Important history boundary

The native reset transaction **deletes** review events/state for the material, prunes obsolete versions, tombstones earlier operation results and advances the reset generation. Material deletion also cascades content/history removal. Therefore the event log is not an eternal complete sequence across generations. A transition may replay only surviving history, must detect absent/incomplete history and must never resurrect erased records or apply an operation from an older generation.

Reps/lapses alone do not uniquely reconstruct FSRS stability and difficulty. A cold-start or partial-history transition requires an explicit tested initialization policy; it cannot be described as exact historical replay. Preserving pending due dates until an actual review remains a useful proposed requirement, pending the transition design.

## Repository and algorithm identities checked

Counts are snapshots retrieved on17 October2026 (local date), not compatibility guarantees.

| Repository | Stars | License | Inspected identity | Adoption state |
| --- | ---: | --- | --- | --- |
| [fsrs4anki](https://github.com/open-spaced-repetition/fsrs4anki) | 4,108 | MIT | HEAD `ff7c85cee735472d1c9cec0b9252d184087f74d8` | Eligible research/reference repository; Anki integration is not a drop-in Tauri scheduler. |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) | 827 | MIT | HEAD `c8ca282edc3fe1cdfa1c24912437938b63a25cb3`; `packages/fsrs/package.json` declares **5.4.2**, Node>=20 | Below threshold; not adopted. Package version is distinct from algorithm generation. |
| [fsrs-rs](https://github.com/open-spaced-repetition/fsrs-rs) | 445 | BSD-3-Clause | HEAD `0a5737406a0c5c7a5259b144738cbe4a0b649d76`; Cargo package `fsrs` **6.6.2** | Below threshold; not adopted. |

The [official algorithm reference](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm) distinguishes **FSRS-6 with21 parameters** from **FSRS-5 with19**. Do not mix FSRS-6 labels, a19-weight vector and an `fsrs-v5` storage identifier as the original plan did. Before a prototype, pin an algorithm revision, default parameter vector, learning/relearning rules, fuzz policy, numeric bounds and expected outputs. Published wiki content can change, so archive its precise reference identity when selecting a prototype.

No review-volume measurements on owner data were made. The original average-volume estimates, universal1,000-review optimization cutoff and fixed workload multiplier for95% retention were unsupported here and are withdrawn. Default parameters are a sensible **evaluation baseline**, not evidence that calibration is categorically impossible or that a target improves checkride outcomes.

## Transition and storage questions to resolve through evidence

1. Keep already scheduled due instants unchanged at a transition boundary unless an independently reviewed policy explicitly says otherwise. Do not silently reschedule an entire library.
2. Determine how retained histories, resets, missing history, suspension, flags and currently unreviewed cards initialize the chosen algorithm. Keep replay and fallback distinguishable.
3. Preserve exactly-once operation replay: replay a retained historical result rather than recomputing it under a new scheduler; erased receipts must stay erased.
4. Persistent stability/difficulty need a reviewed storage contract. Compare additive state with a carefully reviewed table transition; discrete legacy `step` is not an FSRS interval. Do not reserve migration0016 until current main and competing migrations are reconciled.
5. Preserve backup/restore and old/new application compatibility. The historical schema14 helper remains pinned to its own contract and must continue refusing newer schema data. Add appropriate current-schema verification/fixtures rather than retargeting its historical invariant.

## Numerical and clock acceptance

Rounding to integer days can reduce sensitivity but **does not prove cross-language equality**: values on opposite sides of a half-day boundary round differently. Native Rust and browser TypeScript must be compared against independently specified vectors, including boundary-adjacent values, short-delay reviews, very late reviews, finite-value limits and timestamp overflow. Decide tolerances for internal numeric state and exact rules for persisted due instants explicitly.

Adding `interval_days * 86400000` is fixed elapsed-time arithmetic, not local calendar-day arithmetic. Do not silently change the app's existing clock model. Test due-today interpretation separately across DST, travel/timezone changes and backwards clocks. Disable random fuzz for reference-vector comparisons; any later fuzz feature needs its own deterministic test/replay contract.

## Next assignment: feasibility only

A model may prepare a **disposable, non-production** experiment under a separately bounded assignment:

- Pin one algorithm/version/parameter/reference-vector contract without adopting a below-threshold library.
- Compare synthetic new, repeated-Again, repeated-Hard, long-overdue, same-day, reset-with-missing-history and very old-card histories against `simple-v1`.
- Explain expected user-visible differences and observed workload changes for the fixture set, without extrapolating a proficiency or aviation-safety verdict.
- If testing TS/Rust twins, prove the selected numeric/due-time contract with reference and boundary vectors; do not claim parity from rounding alone.
- Compare storage/transition alternatives without modifying production migrations, readers or authoritative mutation commands.
- Deliver exact sources, commands, outputs, failed receipts and recommendations for independent review. Do not touch owner data or install/call external providers.

After evidence exists, the owner can decide any needed library exception, production transition, retention default/configuration and schema design. The proposed90% target is only a benchmark starting point here; a user-facing slider and85–95% range are not approved product changes.

## Review boundaries

This document was checked against source and primary repository/algorithm material. It contains no implemented FSRS engine, performance benchmark or proven mathematical port. No application tests were repeated solely to revise this evaluation. Earlier application and calendar receipts do not validate a future scheduler. The current P54 queue and Study Hub roadmap remain intact; nothing is merged.
