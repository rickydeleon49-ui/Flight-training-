# P54-06 phase B preregistration: FSRS-6 candidate contract

**Status: frozen before any candidate code exists.** This file, `scenarios.json`, `reference-vectors.json`, `contract-vectors.json` and the oracle are bound by `PREREGISTRATION.sha256`. Any change after measurements start needs a new dated revision with its own receipts. Expected values and budgets are never loosened to obtain a PASS.

This is a disposable, synthetic experiment. It is not a production adoption, and it does not choose a migration, a retention setting, a library exception or a storage design.

## Algorithm and reference

| Item | Pinned value |
| --- | --- |
| Algorithm generation | **FSRS-6**, with 21 parameters `w[0]`–`w[20]`; `w[20]` is the decay. Not FSRS-5's 19-parameter contract. |
| Reference oracle | `open-spaced-repetition/fsrs4anki`, `fsrs4anki_scheduler.js`, Git blob `724a2f445adfffb2cc3d7fae7a96ab37b948561c`, SHA-256 `f323accb38ee17c792a7685a9c9ac7f5e7c3c7b9544d6e5f8a01e68000f1b84e`. This blob is identical at release tag **v6.1.3** (commit `c2d8a9d86b507218a30f6c47389a1a58e5d19257`) and at main `ff7c85cee735472d1c9cec0b9252d184087f74d8`; see `receipts/oracle-provenance.json`. The script's own label still says "v6.1.1". |
| Eligibility | The repository has 4,110 stars (snapshot of 19 October 2026), which is above the 1,000-star filter, and is MIT licensed (`oracle/LICENSE`, blob `200c20b`). ts-fsrs (827 stars) and fsrs-rs (445 stars) are below the threshold and are **not** used. |
| How the oracle runs | Unmodified, inside a Node `vm` context with stand-ins for Anki's `states`, `customData` and `ctx` (`proof/oracle.mjs`). It gets no network, file or process access. The harness checks the blob ID and the SHA-256 before running it. |
| Parameters | The oracle's default `w` = `[0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542]` |
| Benchmark retention | 0.9 (the oracle default). A benchmark value only, not a product setting. |
| Maximum interval | `oracle-parity`: 36,500 days. `product-comparison`: **180 days**, the same as simple-v1's longest rung. |
| Fuzz | **None** in the candidate (deterministic, like simple-v1). The oracle fuzzes intervals of 2.5 days or more with a seeded generator, so oracle intervals are checked within a range only; see the tolerances below. |

Package versions (ts-fsrs 5.4.2, fsrs-rs 6.6.2) are separate from the algorithm generation and are not used.

## Candidate contract (`fsrs6-candidate-1`)

`scheduleFsrs(prior | null, rating, nowIso, config)` returns `{ schedulerVersion: "fsrs6-candidate-1", d, s, reps, lapses, lastReviewedAt, dueAt }`. It is pure: no clock reads, randomness or I/O.

**Validation**, in this order, each a refusal:
1. `INVALID_RATING`: the rating is not one of again, hard, good or easy.
2. `INVALID_TIME`: `nowIso` is not the canonical 24-character UTC instant that round-trips through `Date`.
3. `UNSUPPORTED_SCHEDULER_VERSION`: the prior has any other scheduler version, including `simple-v1`. Converting a simple-v1 state is a transition policy, not this function's job.
4. `INVALID_STATE`: any prior field is invalid. Specifically:
   - `d` is not finite in [1, 10];
   - `s` is not finite in [0.01, 1,000,000];
   - `reps` or `lapses` is not a non-negative safe integer;
   - `lastReviewedAt` or `dueAt` is missing or is not a canonical instant (the same rule as `nowIso`).
5. `CLOCK_BEHIND_LAST_REVIEW`: `now` is earlier than the prior's `lastReviewedAt`.
6. `COUNTER_OUT_OF_RANGE`: the new `reps`, or the new `lapses` on a review-path Again, would exceed `Number.MAX_SAFE_INTEGER`.
7. `DUE_OUT_OF_RANGE`: the resulting due time would be after `9999-12-31T23:59:59.999Z`.

The first failing check decides the code. For example, an invalid rating together with an invalid prior gives `INVALID_RATING`. Elapsed time is computed only after the prior's timestamps pass check 4.

**Elapsed days** = `floor((now − lastReviewedAt) / 86,400,000)`, using absolute UTC milliseconds. Local calendar days are not used; this matches simple-v1's from-review-time intervals.

**Path:**
- **New:** the prior is null. Initial difficulty and stability follow the oracle's `init_difficulty` and `init_stability`.
- **Same day:** elapsed is 0. The oracle's short-term formula (`next_short_term_stability`) is used, with the difficulty update.
- **Review:** elapsed is 1 or more. Retrievability is `forgetting_curve(elapsed, s)`. Again uses `next_forget_stability`; the other ratings use `next_recall_stability`.

**Rounding:** `d` and `s` are rounded exactly as the oracle rounds them (`+x.toFixed(2)`, with difficulty clamped to [1, 10]).

**Deviation C1, stability floor:** after rounding, `s` is raised to at least 0.01. The oracle can produce `s = 0` (scenario `bound-tiny-s-same-day`, Again), which would divide by zero on the next review.

**Deviation C3, stability ceiling:** after rounding, `s` is lowered to at most 1,000,000, the same bound check 4 accepts. Together with check 6, every accepted output is a valid prior for the next review: its `d`, `s`, counters and timestamps all pass check 4. (A later review may still be refused, for example when `reps` is already at the safe maximum, but never because the earlier output was malformed.) The oracle has no ceiling: from `{d: 1, s: 1,000,000}` after 36,500 days, its Hard, Good and Easy give 1,016,881.89, 1,028,070.98 and 1,052,574.13 (scenario `bound-stability-ceiling`). Intervals are unaffected in practice, because both caps (180 and 36,500 days) bind long before this.

**Intervals:**
- **Again:** due in 10 minutes, as in simple-v1. `lapses` increases only on the review path. The oracle leaves Again to Anki's learning steps, so it has no interval to compare.
- **New or same-day:**
  - Hard: 1 day. The oracle leaves Hard to Anki's learning steps.
  - Good: `next_interval(s_good)`.
  - Easy: `max(next_interval(s_easy), good + 1)`.
- **Review:** compute `next_interval` for Hard, Good and Easy, then apply the oracle's ordering: `hard = min(hard, good)`, `good = max(good, hard + 1)`, `easy = max(easy, good + 1)`.
- **Deviation C2, cap after ordering:** every interval is capped at the configured maximum *after* ordering. The oracle's ordering pushes Good and Easy past its own cap (scenario `bound-max-interval-cap`: 36,501 and 36,502 against a 36,500 maximum).
- **`next_interval(s)`** = `min(max(round(s / FACTOR × (retention^(1/DECAY) − 1)), 1), maximum)`, where `DECAY = −w[20]` and `FACTOR = 0.9^(1/DECAY) − 1`.
- **Due** = `now + interval × 86,400,000 ms`.

`reps` increases by 1 on every accepted review. The prior is never mutated.

## Reference vectors and tolerances

- **Oracle vectors** (`reference-vectors.json`, 30 scenarios, 66 steps). They are produced only by the oracle from the preregistered inputs in `scenarios.json`. The categories are:
  - initial ratings;
  - same-day repetitions;
  - on-time Good, Easy and Hard chains;
  - repeated lapses and Hard after a lapse;
  - lateness from 1 day early to 100 years late;
  - bounded states (difficulty 1 and 10, stability from 0.01 to 1,000,000);
  - rounding-adjacent values (5.555/1.005, 9.995/2.345, 1.005/0.125, stability 2.5);
  - one oracle limitation (a review with zero elapsed days throws).
- **Contract vectors** (`contract-vectors.json`, 42). These are written by hand, not by any scheduler code. They cover:
  - every refusal, including NaN and ±Infinity;
  - every prior field: invalid, missing or non-canonical timestamps, negative `reps`, fractional `lapses`, and stability just above the ceiling;
  - refusal precedence (rating before time before version before state, and counters before due time);
  - `reps` and `lapses` at and just below `Number.MAX_SAFE_INTEGER`, including the refused successor;
  - stability at the ceiling, where the successor state must be accepted on the next review;
  - the clock 1 ms behind;
  - a due time past year 9999;
  - the elapsed-day floor at 0 ms, 1 ms short of a day, exactly 1 day and 1.999 days;
  - Again's 10 minutes and the lapse rule;
  - the 180-day product cap, before and after ordering;
  - the parity cap after ordering;
  - the stability floor;
  - Hard on a new card.

**Tolerances:**

| Quantity | Rule |
| --- | --- |
| `d`, `s` at every oracle step | **Exact equality** after the oracle's rounding. Both run as IEEE-754 doubles in the same engine with the same formulas, so any difference is a candidate defect. The only exceptions are deviation C1 (the candidate gives 0.01 where the oracle gives 0) and deviation C3 (the candidate gives 1,000,000 where the oracle exceeds it); both oracle values are recorded. |
| Oracle intervals that weren't fuzzed (candidate interval below 2.5 days) | Exact equality. |
| Oracle intervals that were fuzzed | Consistency only: the oracle value must lie in `[c − ⌈0.05c⌉ − 2, c + ⌈0.05c⌉ + 2]` around the candidate's unfuzzed value `c`. This bounds the oracle's fuzz window (±5% ±1 day) plus one ordering bump. It is **not** an equality proof. Cap cases follow deviation C2. |
| Contract vectors | Exact: the refusal code, elapsed days, path, due time, interval, `s` or lapse change as listed. `successorAccepted` means the returned state, reviewed again one day later with Good, must not be refused; `successorRefusal` names the code that review must give instead. `reps` is the exact returned count. |

Cross-language equality is out of scope: only a TypeScript candidate is planned, and native parity is unverified. Rounding cannot prove cross-language equality.

## What phase B will measure (after this file is frozen)

1. The candidate against all oracle and contract vectors.
2. The unchanged simple-v1 baseline and the candidate over phase A's 19 input histories (`../p54-06-feasibility-baseline-2026-10-17/fixtures.json` and `required-inputs.json`), used as inputs, not as candidate goldens. Intended behavioral differences are reported separately from correctness failures.
3. Pure transition simulations, as proposed contracts only:
   - retained complete history (replayed under the candidate);
   - retained partial history (fallback, marked as different from reconstruction);
   - erased history (stays erased; the card starts new);
   - an unknown version (refused);
   - an unreviewed state;
   - flagged or suspended cards;
   - stale generations;
   - repeated operation IDs (the stored result is replayed, not recomputed);
   - pending due instants (kept until the next real review).
4. Negative controls in disposable copies: a wrong expectation, a missing vector, a thrown candidate error, and a provenance or digest mismatch. Each must make the runner refuse success.
5. Run sizes, runtime, hardware and commands, recorded. Memory and native responsiveness are disclosed as unmeasured.

Nothing here selects a production algorithm, migration number, retention slider or library exception. A PASS would show only that the in-house candidate matches the pinned oracle on these vectors, not that FSRS is beneficial for this learner.
