# P54-06 phase B part 2: results

**Status: PASS (synthetic experiment only).** Production stays on `simple-v1`. Nothing here is a production scheduler change, a migration, a retention setting, a dependency or an adoption decision. A PASS shows only that the in-house `fsrs6-candidate-1` matches the pinned FSRS4Anki v6.1.3 oracle on the preregistered vectors and meets the hand-written contract. It does not show that FSRS helps this learner.

The binding contract is `../p54-06-phase-b-2026-10-19/PREREGISTRATION.md`. Its files were verified before any measurement (`receipts/frozen-preregistration-sha256.txt`, `receipts/frozen-sha256sums.txt`, both exit 0) and were not edited. The runner re-checks them on every run against digests pinned in `proof/runner.mjs`, and regenerates the reference vectors through the frozen oracle harness (isolated `vm`, Git blob and SHA-256 check) before comparing anything.

## 1. Candidate against the oracle and contract vectors

The candidate is `candidate/fsrs6Candidate.ts` (SHA-256 `935ca33b…829bde0`). It is TypeScript, loaded by the runner through the locked TypeScript 5.9.3 transpiler, and type-checks under `--strict --noUncheckedIndexedAccess` (`receipts/candidate-typecheck.txt`).

| Measure | Result |
| --- | --- |
| Oracle scenarios / steps | 30 / 66, all reached |
| Rating outcomes compared (4 per step; the oracle-error step excluded) | 260 |
| `d` exact | 260 / 260 |
| `s` exact | 256 / 260; the other 4 are the preregistered deviations C1 (1) and C3 (3) |
| Intervals exact (candidate below 2.5 days) | 44 |
| Intervals inside the fuzz window `[c − ⌈0.05c⌉ − 2, c + ⌈0.05c⌉ + 2]` | 114 (consistency only, not equality) |
| Intervals at the cap, deviation C2 (oracle 36,501/36,502, candidate 36,500) | 8 |
| Intervals not comparable (Again: Anki learning steps; Hard on new/same-day: candidate 1 day) | 94 |
| Contract vectors | 42 / 42, 51 assertions, 0 failures |
| Failures | **0** |

Deviations seen, all preregistered:
- **C1** `bound-tiny-s-same-day#0/again`: oracle `s = 0`, candidate 0.01.
- **C2** `bound-max-d-huge-s`, `bound-min-d-huge-s-early`, `bound-max-interval-cap`, `bound-stability-ceiling` (Good and Easy each): oracle 36,501 and 36,502, candidate 36,500.
- **C3** `bound-stability-ceiling#0` Hard, Good, Easy: oracle 1,016,881.89, 1,028,070.98 and 1,052,574.13; candidate 1,000,000.
- **Oracle limitation** `oracle-review-zero-elapsed`: the oracle throws; the candidate takes the same-day path (`d` 5, `s` 10, due in 10 days). Recorded, not compared.

No vector looked wrong, so none is reported as a finding.

Choices the preregistration leaves open, made here and open to review:
- A refusal is a thrown `FsrsRefusal` with `.code`, as `simple-v1` throws `SchedulerRefusal`. `scheduleFsrs` returns only the state; `decideFsrs` also returns the path, elapsed days and interval so the contract vectors can be checked.
- A non-null prior that is not a plain object is refused `UNSUPPORTED_SCHEDULER_VERSION` (it carries no recognisable version).
- Intervals are computed from `s` after C1/C3. Both caps bind long before C3 matters, and an `s` of 0 or 0.01 both give 1 day, so no measured interval depends on this.
- An invalid `config` throws `TypeError`; it is a programming error, not a refusal. It is checked only after refusals 1–6, so it never preempts them (fixed after Codex review RED, 28 October; regression test in `proof/runner.test.mjs`).

## 2. simple-v1 and the candidate over phase A's 19 histories

`simple-v1` is the unchanged production module `src/logic/cardScheduler.ts`, imported read-only after its bytes matched phase A's pin and the Git blob at `e8f6808`. It reproduced every phase A expectation (19 histories, 78 reviews, 6 local-day vectors). The candidate ran the same reviews with the 180-day product cap.

**Correctness failures: 0.** Every accepted candidate output was a valid next prior, `reps` rose by one, no prior was mutated, and every interval was above 0 and at most 180 days.

**Intended behavioural differences**, reported separately:

| Kind | Count |
| --- | --- |
| Same interval as simple-v1 | 33 |
| Different interval | 39 |
| Lapse count differs (simple-v1 counts Again after any ladder step; the candidate only on the review path) | 2 |
| Candidate refuses a `simple-v1` prior (`UNSUPPORTED_SCHEDULER_VERSION`; conversion is a transition policy) | 3 (`state-without-retained-events`, `very-old-capped-card`, `clock-backward`) |
| Same refusal as simple-v1 | 3 (`noncanonical-time`, `foreign-version`, `unknown-rating`) |

Examples (simple-v1 days / candidate days): first Good 1/2, first Easy 3/8; Good chain `ladder-cap` 1/2, 3/7, 7/20, 16/45, 35/95, then the 180 cap from review 6 instead of review 8; `repeated-hard` stays at 1 day under simple-v1 but grows to 12 under the candidate; `twenty-days-overdue` Good 7/58 (the candidate credits a late success); Again is 10 minutes in both. Full per-review rows are in `receipts/results.json` under `phaseA.histories`.

## 3. Transition simulations (proposed contracts only)

`proof/transition.mjs` states each rule in its header. 13 cases, 13 pass, using the `lapse-and-relearn` history run through production simple-v1:

retained complete history (replayed, `reconstructed`); retained partial history (`partial-fallback`, `reconstructed: false`, simple-v1 counters kept, visibly different `d`/`s` from a full replay); erased history (stays erased, card starts new, cannot be resurrected from events); unknown version (refused); unreviewed state (no-op, stays new); already transitioned (no-op); flagged card (flag kept); suspended card (suspension kept, not lifted); stale generation (refused `STALE_GENERATION`, refusal stored); repeated operation ID (the very stored outcome returned, zero candidate calls); pending due instant (kept until the next real review, then replaced by the candidate); inconsistent complete history (refused); purity and determinism (deep-frozen inputs, two runs equal).

These are not a migration design. They do not choose storage, a migration number or when a transition would run.

## 4. Negative controls

`node proof/runner.mjs --controls` (`receipts/negative-controls.json`): 10 controls, **10 refused**. Disposable copies go to a temporary directory that is removed afterwards.

| Control | Caught by |
| --- | --- |
| Wrong expectation (contract `dueAt` +1 ms), in memory | the comparison (`product-cap-180-days: dueAt`) |
| The same, in a copy of the frozen folder | the frozen digest |
| Wrong oracle value (`d` + 0.01), in memory | the comparison |
| Missing contract vector / missing reference vector, in memory | the vector counts |
| Missing vector, in a copy | the frozen digest |
| Candidate throws a plain `Error` on its 50th call | `candidate-threw` failure |
| Oracle byte flipped in a copy | the frozen digest |
| Oracle byte flipped and `PREREGISTRATION.sha256` rewritten to match | the pinned digest of `PREREGISTRATION.sha256` |
| Reference vectors claim a different oracle | the provenance check |

## 5. Run size, runtime, hardware and commands

- Size: 30 scenarios, 66 steps, 260 rating outcomes, 42 contract vectors, 19 histories / 78 reviews, 13 transition cases, 10 negative controls.
- Runtime (one run): evaluation 9.5 ms (vectors 3.1 ms, phase A and transitions 6.3 ms), 81 ms in-process including verification and oracle regeneration, 0.26 s wall for the whole process; controls 0.48 s wall (`receipts/results.time`, `receipts/negative-controls.time`).
- Hardware and runtime: Apple M5 (10 cores), arm64, macOS (Darwin 27.0.0), Node v22.23.3, TypeScript 5.9.3.
- **Unmeasured:** memory use, native (Rust) parity and responsiveness, and installed-app responsiveness. Only a TypeScript candidate exists; cross-language equality is out of scope.
- Exact commands: `receipts/commands.txt`.

## CI

`proof/runner.test.mjs` (3 tests) re-runs everything with `node --test`. The CI workflow is unchanged: a change under `docs/` takes the documentation-only path, so CI runs these tests only if a step is added to `.github/workflows/checks.yml`. That is left to the reviewer.
