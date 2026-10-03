# Mac Study Library baseline and open-source decision — 2 October 2026

Bounded measurement task from the [Claude Mac continuation prompt](CLAUDE_MAC_CONTINUATION_PROMPT_2026-10-02.md), **revised for Codex's R1–R3 review** ([review](MAC_STUDY_LIBRARY_BASELINE_REVIEW_2026-10-02.md), [correction prompt](CLAUDE_MAC_BASELINE_CORRECTION_PROMPT_2026-10-02.md)). Those documents, the [Mac report](MAC_SMOKE_RESULTS_2026-10-02.md) and the [Mac-first plan](MAC_PRIMARY_DEVELOPMENT_PLAN_2026-10-02.md) live on draft [PR #44](https://github.com/rickydeleon49-ui/Flight-training-/pull/44); their links resolve once it merges.

Synthetic source-level measurements only. No production component, database driver, package or migration was changed. Installed WKWebView, Tauri IPC, packaged startup and peak app memory remain **UNVERIFIED**. This report is the implementer's own account. **It is not Codex acceptance**; the corrected slice awaits Codex's independent review.

## Identity and ownership

- **Task / date / roles:** Study Library performance baseline and candidate go/no-go, 2 October 2026 (Pacific; run UTC stamps are 3 October). Active implementer: Claude (Mac). Independent reviewer and Git coordinator: Codex. Gemini: not assigned.
- **Machine and OS:** MacBook Air (Mac17,3), Apple M5, 10 cores, 32 GB, macOS 26.6 (Darwin 25.6.0, arm64), matching the Mac report.
- **Toolchain:** Node 22.23.3 and npm 10.9.9 via a scoped `PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/opt/rustup/bin:$PATH`. rustc/cargo 1.99.0. `SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk` (present) for native checks. No global configuration was changed.
- **Repository / branch / base:** `https://github.com/rickydeleon49-ui/Flight-training-`, clone `~/code/Flight-training-`, branch `codex/mac-study-library-baseline` from `origin/main` = `a4339fc720d8eac0f038402687e30233de141436`. Upstream unset.
- **Code availability:** LOCAL UNCOMMITTED. Nothing committed or pushed.
- **State checked before the first task:** The checkout was on `codex/mac-source-evaluation-report` at `ca6c834`, clean and in sync, and was left untouched. `git diff 5e388bf a4339fc -- src package.json package-lock.json` is empty.
- **State checked before the R1–R3 corrections:** Branch and HEAD unchanged (`a4339fc`). The four reviewed source hashes matched the review exactly and nothing competing was found. PR #44's head was `e21ada3` (Codex's review), and `origin/main` was still `a4339fc`.
- **Other owners:** A2 R6/R7 remains Windows-local (`fix/atomic-study-material-saves` is on neither GitHub nor main) with its implementer. No A2 code was reproduced.

## Codex review R1–R3: issue-to-fix map

| Finding | Correction | Maintained regression / evidence |
| --- | --- | --- |
| **R1** — Intermediate measured results were not verified. Only the final state of a multi-step sequence was checked, so a transient wrong result could pass. | `runLibraryScenarios` fixes the intended view and progressive limit for every step before running. After **every** timed event (warm-ups included), and after reset and setup, `verifyState` checks all five controls, the total, and the exact ids and order of shown cards. It runs after the `afterStep` hook and before the sample is kept, all outside the timed region. Generator-rule counts apply to the final step only. | `studyLibraryScenarios.test.ts`: **"fails the run on a wrong intermediate keystroke result even when the final result is correct"** (Codex's fault: wrong first-card id at `airspace c` only, restored before the next keystroke; must reject at `step 9 (query "airspace c")`). **"fails the run on a wrong intermediate count even when the final result is correct"** (count line altered at the same step only). The final-state negative control is kept. |
| **R2** — The "100-card bound" claim was wrong. Each Show more adds 100 with no cap; only 100 and 200 displayed cards were measured. | Added the **`showMoreExpandTo1000`** scenario: nine timed Show more clicks from 100 to **1,000 displayed cards**, each verified. Added **`queryWhileExpanded`**: a query typed while 1,000 cards are displayed, verified to return to 100. Both need ≥ 1,000 materials (small tier records a conditional skip). Displays above 1,000, scrolling, and refresh or editing while expanded remain **unmeasured**. The rendering claims and the virtualization decision are rescoped below. | `studyLibraryScenarios.test.ts`: **"measures a stated expanded display of 1,000 cards, and a query from it returns to 100"** (asserts shown counts 200…1,000 per step and the 100-card return). |
| **R3** — Compute was measured for the final query only (5 samples) while wall/React had 80 samples over 16 prefixes. | Results are now **per step**. Each step records its event, view, limit, wall, React, renders per repeat and DB calls over all repeats, plus **compute for that step's own view** (5 samples after 1 warm-up), so every comparison is like-for-like. The old sequence-wide aggregates and the per-keystroke "under 1 ms savings" and percentage extrapolation are removed. No candidate was measured, so no saving is claimed. | The full-scenario test asserts that the 16 narrowing steps carry the 16 prefixes, each with its own wall and compute samples. The evidence JSON holds every step's raw samples. |

## Scope and state

**Problem.** The previous opt-in benchmark could not support a dependency decision: no matching query, no tags or file cases, end-of-run heap only. Several timings did not measure what their names said (H3/H4 below).

**Result.** The harness measures DB load, index-free search/filter/sort, React work, mutation plus refresh, and navigation separately over 100/1,000/5,000 materials plus a 10,000 stress tier. It now also measures expanded displays up to 1,000 cards. Every timed step is verified against an independent answer key before its sample is kept.

**Decision (revised).**
- **MiniSearch: no-go.** Measured per-step search compute is small relative to the same step's interaction (see the decision section).
- **TanStack Virtual: no adoption justified for the initial 100- and 200-card displays.** For expanded displays, rendering cost **does** grow with the number of displayed cards: in jsdom one Show more click reaches about 94–97 ms at 1,000 cards. That workload exceeds the proposed Node targets, so expanded-display rendering is a **measured open question**. It is not resolved by this task and does not justify adoption on its own. Details are under [Candidate decision](#candidate-decision).

### Harness defects found in the original harness (first task)

| # | Defect | Evidence | Correction |
| --- | --- | --- | --- |
| H1 | Search `airspa` matched no seeded title or note. | Previous source; [reference run](evidence/mac-study-baseline-2026-10-02/original-harness-reference.min.json) | Deterministic fixture with matching, narrowing, no-match, Unicode, duplicate, tag and notes queries. |
| H2 | No tags, duplicate titles, Unicode or file records. | Previous seed | Built into the fixture by construction. |
| H3 | Sort iterations were not all real changes: `sessionStorage` filter state leaked between tiers, so the first medium/large sort was a no-op. | Reference run: sort min 0.34 / 0.31 ms against medians of about 16–17 ms | Storage cleared per tier. Every step guarded against no-ops. |
| H4 | Timed regions included Testing Library role queries. | Development trial: 50 ms wall against 0.8 ms React for a no-match keystroke | Lookups and guards moved outside timing. Direct DOM readiness checks. |
| H5 | Cold load ended at a `waitFor` poll. | Previous source | Ends at a timestamp taken in the ready commit. |
| H6 | End-of-tier heap only. | Previous source | Heap and RSS sampled after every timed step; method labelled. |
| H7 | Identical creation times made sort order among ties arbitrary. | `documentRepository.buildMaterial` | Distinct, shuffled `created_at` values. |

No figure from the previous harness, the first official run, or the Windows note is compared below as a before/after speed change. No speedup is claimed.

### Changes (all uncommitted)

| File | Change |
| --- | --- |
| `src/perf/studyLibraryFixture.ts` (new; unchanged by R1–R3) | Deterministic fixture, SHA-256 identity, real-schema seeding, answer key `expectedIds`, generator-rule `analyticCounts`, and a labelled verbatim replica of the page filter. |
| `src/perf/studyLibraryHarness.ts` (new; revised for R1–R3) | 18 scenarios driving the real `StudyLibrary`. Per-step plan, verification after every step, per-step results with matched compute, expanded-display scenarios, untimed lookups and no-op guards, and an `only` filter for focused tests. |
| `src/perf/studyLibraryScenarios.test.ts` (new, in `npm test`; revised) | 8 tests: 3 fixture tests, all scenarios at 240 materials, the expanded-display test at 1,000, the final-state negative control, and 2 intermediate-step negative controls. |
| `src/perf/appResponsiveness.bench.test.ts` (modified; unchanged by R1–R3) | Uses the fixture. Adds the stress tier, DB-load and material-mutation domains, mocked file-status opens, commit-stamped cold load, untimed DOM checks, identity and memory sampling. Keeps the existing tiers, 5 repeats, action mutation and navigation. |

No production component, repository, migration, driver, package, lockfile or configuration changed. The new modules are imported only by tests.

### Data, security and platform boundaries

Disposable in-memory SQLite (`node:sqlite`, same migrations) and synthetic records only; no fixture files are created. **File status is a mock** (`documentExists` answered from the fixture). It exercises the missing-file notice but is not filesystem or native evidence. The owner's profile was not touched. No app launch, Gatekeeper, quarantine or signing change. Databases close and components unmount in `finally`/`afterEach`. The seed still uses public `BEGIN`/`COMMIT`, accepted by the current Node driver; if A2's contract lands and rejects that, switch to its supported fixture path rather than weakening the guard.

## Measurement method

- **Timing domain:** Node 22 + jsdom: JavaScript, React and `node:sqlite` work in one process. **Not** WKWebView layout/paint, Tauri IPC or packaged startup. React timings are not painted-frame latency.
- **Workload:** Real provider, pages and repositories. Tiers: 100 / 1,000 / 5,000 materials (with 100/400/1,500 actions, 30/150/500 journal entries, 50/250/800 questions); **stress 10,000** with large's other records (not realistic).
- **Repeats, warm-up and cache:**
  - 5 recorded repeats. Each interaction scenario, each step's compute, and the DB list discard 1 warm-up first. Cold load has no warm-up; tiers run small → stress in one process, so module and JIT state are warm after small.
  - Each tier uses a fresh in-memory database with cleared `sessionStorage`/`localStorage`.
  - Each scenario repeat resets through the page controls (a throwaway query forces the progressive limit back to 100) and is verified after reset and after setup.
- **Per-step results:**
  - **Wall** is the `act()` around one dispatched event.
  - **React** is the Profiler `actualDuration` sum for that event.
  - **Compute** is the verified filter replica plus production `sortMaterials` for **that step's view**.
  - **Renders** are listed per recorded repeat; **DB calls** are totals over all recorded repeats of that step.
  - Median is the upper median for even counts; raw samples are in the evidence.
- **Other domains:**
  - **DB load:** `repos.documents.list()`, 2 selects.
  - **Cold load:** render start to the ready commit with the library listed, 22 selects.
  - **Mutation:** `mutate` plus full refresh, 22 selects and 2 executes.
  - **Open/back/navigation:** route change to the target page's title.
- **Fixture identity (SHA-256 of generated records), unchanged:**
  - small: `2d7e1a3c52b6bb6f41a3b7ea7abc6542b18801cbfded6584453bd722b7f11fdf`
  - medium: `c417b4a544a3c40ad769d6768f96290b125c2d0a26fa7098d6e170568ad851b3`
  - large: `523c0f4ddbc2d6dc8c975190d9c2ec242bc9bb86a3032a951ebb54a41bfe1cb8`
  - stress: `30465e9800006a681113c5a3cdb7e0b8b20b337eaf8d41a1a7e7f85485700e90`

## Results — corrected official run (R1–R3)

All values are milliseconds, median [min–max] with n=5 unless stated. Source: `.smoke/mac-study-baseline/results-r1r3.json` (SHA-256 `dc4c7f828eb9e76be1cdde2a3a1a6d04381a30e4e56d32998ae2759c40f49e18`), shared as [`results-r1r3.min.json`](evidence/mac-study-baseline-2026-10-02/results-r1r3.min.json). The first official run ([`results.min.json`](evidence/mac-study-baseline-2026-10-02/results.min.json)) is kept as dated history. It is superseded because its intermediate steps were not verified and its compute was final-query only.

### Database load, cold load and refresh

| Tier | DB materials list | Cold load to library listed | Action edit + full refresh | Material edit + full refresh |
| --- | --- | --- | --- | --- |
| small 100 | 0.24 [0.23–0.26] | 26.83 [16.75–67.23] | 6.36 [4.85–7.77] | 4.71 [4.40–5.28] |
| medium 1,000 | 1.97 [1.93–2.14] | 17.21 [16.80–20.16] | 11.74 [7.31–19.27] | 7.73 [7.38–8.04] |
| large 5,000 | 10.33 [9.69–10.78] | 33.78 [29.45–40.43] | 20.90 [19.81–31.37] | 19.80 [19.65–20.75] |
| stress 10,000 | 21.61 [21.10–22.13] | 47.94 [41.52–54.86] | 34.85 [32.95–44.85] | 33.45 [32.22–33.99] |

Small runs first in a fresh process, so its cold-load maximum reflects first-use cost. Refresh after every write grows linearly with library size (22 selects per edit).

### Single-step interactions — large (5,000) and stress (10,000)

Compute is for the same view as the interaction. Every step made 0 database calls. Renders per repeat: 2 commits for filter, search and sort changes; 1 for Show more.

| Scenario | Results / shown (large) | Wall, large | React, large | Compute, large | Wall, stress | React, stress | Compute, stress |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Clear search (empty query) | 5,000 / 100 | 17.23 [16.66–38.11] | 11.49 | 0.21 | 17.46 [16.80–37.34] | 11.62 | 0.34 |
| Matching query pasted | 500 / 100 | 17.38 [17.01–38.71] | 11.85 | 0.66 | 18.77 [18.59–38.96] | 14.03 | 1.36 |
| No-match query | 0 / 0 | 3.48 [3.44–5.26] | 1.48 | 0.60 | 4.53 [4.00–6.71] | 2.43 | 1.23 |
| Unicode `MÉTÉO` | 500 / 100 | 18.80 [18.08–41.01] | 13.69 | 0.63 | 21.31 [19.54–41.15] | 16.54 | 1.22 |
| Unicode CJK `航空` | 250 / 100 | 19.38 [18.39–32.50] | 13.89 | 0.58 | 19.92 [19.50–40.85] | 15.05 | 1.19 |
| Decomposed `méteo` (NFD) | 0 / 0 | 3.56 [3.45–3.99] | 1.72 | 0.57 | 4.33 [4.27–6.04] | 2.50 | 1.14 |
| Duplicate titles, title sort | 500 / 100 | 19.42 [18.58–40.21] | 13.80 | 0.61 | 19.63 [18.72–39.46] | 13.24 | 1.22 |
| Tag query | 1,250 / 100 | 16.77 [16.14–38.36] | 12.09 | 0.70 | 17.79 [17.36–38.42] | 12.13 | 1.32 |
| Notes query | 715 / 100 | 17.47 [16.40–37.64] | 11.68 | 0.62 | 18.34 [17.22–37.48] | 12.74 | 1.28 |
| Topic + status + query, then title sort | 83 / 83 | 9.23 [9.02–28.21] | 4.80 | 0.14 | 14.69 [14.51–14.95] | 8.78 | 0.27 |
| Status chip Next Up | 1,668 / 100 | 15.26 [15.05–38.46] | 10.06 | 0.14 | 15.71 [15.59–36.69] | 11.23 | 0.29 |
| Sort recent → priority | 5,000 / 100 | 16.50 [15.74–38.86] | 12.03 | 0.68 | 16.64 [16.04–37.43] | 12.22 | 1.38 |
| Sort priority → title | 5,000 / 100 | 20.28 [19.27–33.82] | 13.59 | 1.54 | 21.93 [21.74–42.15] | 16.93 | 3.39 |
| Sort title → recent | 5,000 / 100 | 18.10 [17.82–37.71] | 12.23 | 0.20 | 18.28 [16.95–38.34] | 13.44 | 0.36 |
| Show more (100 → 200) | 5,000 / 200 | 19.32 [15.82–36.19] | 16.11 | 0.19 | 16.44 [15.24–34.91] | 12.00 | 0.33 |

### Narrowing search, per typed prefix — large (5,000)

Each row is its own state: 5 wall/React samples for that keystroke and 5 compute samples for that same query.

| Step | Query | Results / shown | Wall | React | Compute |
| --- | --- | --- | --- | --- | --- |
| 0 | `a` | 4,821 / 100 | 9.30 [8.76–29.43] | 5.99 | 0.72 |
| 1 | `ai` | 1,334 / 100 | 15.47 [15.23–26.69] | 11.16 | 0.68 |
| 2 | `air` | 1,334 / 100 | 8.60 [8.33–28.92] | 5.69 | 0.67 |
| 3 | `airs` | 500 / 100 | 15.10 [14.67–36.86] | 10.81 | 0.66 |
| 4–14 | `airsp` … `airspace class ` (11 steps) | 500 / 100 each | medians 8.58–9.59 | 5.65–6.64 | 0.64–0.68 |
| 15 | `airspace class b` | 125 / 100 | 16.62 [16.47–37.41] | 11.75 | 0.66 |

Keystrokes that change which cards are shown (steps 1, 3, 15) cost about 15–17 ms. Keystrokes that keep the same top 100 cost about 9 ms, because React reuses the existing card elements. Every step for every tier, with raw samples, is in the evidence. Across the 16 steps, compute as a share of the same step's wall-time median ranges from 4.0% to 7.8% at large and from 7.1% to 13.7% at stress.

### Expanded displays — Show more clicks to 1,000 cards (new for R2)

Each row is one click, timed and verified for its displayed count.

| Displayed after click | Wall, medium | Wall, large | React, large | Wall, stress |
| --- | --- | --- | --- | --- |
| 200 | 15.57 | 16.19 [15.21–35.41] | 11.79 | 15.59 |
| 300 | 49.70 | 49.58 [25.19–50.76] | 43.94 | 47.60 |
| 400 | 41.45 | 41.97 [24.41–43.48] | 34.54 | 40.28 |
| 500 | 28.53 | 28.79 [28.11–30.26] | 19.67 | 28.45 |
| 600 | 78.45 | 79.44 [78.55–81.37] | 68.32 | 75.86 |
| 700 | 36.19 | 36.98 [36.47–39.21] | 24.83 | 36.98 |
| 800 | 87.78 | 87.48 [87.14–89.23] | 73.07 | 84.53 |
| 900 | 44.96 | 45.65 [45.11–46.52] | 29.39 | 45.38 |
| 1,000 | 96.41 | 97.03 [96.26–98.70] | 78.96 | 94.07 |
| **Query typed while 1,000 shown** (→ 100 shown) | 33.34 [32.68–33.82] | 34.59 [32.89–42.82] | 6.82 | 35.25 [34.94–45.29] |

- **Scaling:** Per-click cost grows with the number of cards already displayed and is nearly identical across library sizes. The work follows displayed cards, not library size.
- **Sawtooth:** The alternating pattern (for example 600 and 800 above 500 and 700) is consistent across repeats and tiers. This is consistent with a periodic cost such as garbage collection landing on alternate clicks, but this run did not attribute it.
- **Query while expanded:** Only about 7 ms of the 35 ms is React render. The remainder is commit/DOM work removing 900 cards. Compute stays at most 0.2 ms (large) for every click.
- **Unmeasured:** Displays above 1,000, scrolling, focus, and edits or refreshes while expanded.

### Opening materials and navigation

| Tier | Open: no file | Open: present (MOCK) | Open: missing (MOCK, notice shown) | Back (n=15) | Flight Deck / Study Library / Questions leg |
| --- | --- | --- | --- | --- | --- |
| small | 5.53 [5.08–8.24] | 4.94 [4.92–6.03] | 5.07 [4.80–10.82] | 18.08 [17.48–39.96] | 4.43 / 18.85 / 11.03 |
| medium | 5.38 [5.20–6.24] | 5.52 [5.24–5.56] | 5.51 [5.31–5.89] | 16.89 [16.66–17.59] | 6.88 / 17.76 / 19.02 |
| large | 5.32 [4.59–5.86] | 5.32 [5.30–5.79] | 5.35 [5.31–5.51] | 16.97 [16.61–32.03] | 12.53 / 17.57 / 19.35 |
| stress | 5.70 [5.53–6.51] | 5.74 [5.49–5.91] | 5.71 [5.61–5.80] | 17.47 [17.19–17.87] | 16.64 / 19.04 / 21.09 |

### Node process memory and bundle size

| Tier | End heap / RSS (MiB) | Max sampled heap / RSS (MiB) |
| --- | --- | --- |
| small | 127 / 461 | 343 / 462 (215 samples) |
| medium | 202 / 574 | 510 / 621 (281) |
| large | 97 / 913 | 739 / 924 (281) |
| stress | 107 / 921 | 759 / 964 (281) |

These are whole Vitest/jsdom process figures sampled after timed steps. They rose with the new 1,000-card displays. **Not packaged-app or WKWebView memory, and not a true peak.**

Production build: 24 JS files, 636,469 bytes (201,564 gzip -9); 10 CSS files, 53,448 bytes (13,506 gzip). Entry 381,137 bytes (118,090 gzip). `StudyLibrary` chunk 5.52 kB (2.29 kB gzip). No dependency was added.

## Correctness checks

- **Answer key and generator counts:** `expectedIds` comes from the generator definition and documented semantics. `analyticCounts` comes from the generator rules alone. Unit tests check that they agree at 100, 240 and 1,000 materials.
- **Every measured state (R1):** Before each sample is kept, the harness checks:
  - all five controls equal the intended view;
  - the total equals the answer key;
  - shown ids and order exactly equal the answer key sliced to the intended progressive limit;
  - the generator-rule count, on final steps that define one.

  These checks also run after reset and setup, and in warm-up runs.
- **Compute (R3):** For every step, the replica filter plus `sortMaterials` must equal the answer key for that step's view.
- **No-op guard:** Every control step must change the view (fixes H3).
- **Bench assertions:** DB list length and tag totals; material-edit refresh visible in provider data; missing-file notice present or absent as mocked.
- **Negative controls in `npm test`:**
  - a wrong final answer key;
  - a wrong intermediate card id at `airspace c`;
  - a wrong intermediate count at `airspace c`.

  All three must reject, and do. Codex's independent diagnostic showed the reviewed harness accepted the intermediate-id fault. The maintained regression now pins the rejection (error text `step 9 (query "airspace c"): shown ids/order differ`).
- **Current semantics recorded, not changed:**
  - no Unicode normalization (an NFD query gives 0 results);
  - a query can span joined fields;
  - duplicate titles under title sort fall back to newest first;
  - any filter, search or sort change resets the display to 100 cards (verified by `queryWhileExpanded`).

## Verification receipts

| Exact command | Tested source/diff | Exit / counts | Shared sanitized log or summary path |
| --- | --- | --- | --- |
| *First task:* original harness before any edit, `HFD_BENCH=1 HFD_BENCH_OUT=.smoke/mac-study-baseline/original-harness.json npx --no-install vitest run src/perf/appResponsiveness.bench.test.ts` | `a4339fc`, clean | 0; 1 passed | [original-harness-reference.min.json](evidence/mac-study-baseline-2026-10-02/original-harness-reference.min.json) |
| *First task:* development trial 1 | Early rewrite | **1**: provider-ready deadlock inside `act()` (60 s timeout); log overwritten by trial 2 | Recorded here |
| *First task:* development trials 2–3 | Intermediate rewrites | 0; trial 2 revealed H4 | Local only |
| *First task:* first official run (`results.json`) | Reviewed hashes `aa1b6d6d…`, `91cffef1…`, `e349c7c6…`, `9631fb9e…` | 0; 1 passed; 94.9 s | [results.min.json](evidence/mac-study-baseline-2026-10-02/results.min.json) (**superseded**) |
| *First task:* sequential gate | Reviewed hashes | All 0; 599 frontend passed / 4 skipped; 246 Rust passed / 6 ignored | [local-gate-summary.txt](evidence/mac-study-baseline-2026-10-02/local-gate-summary.txt) |
| *Codex review:* independent diagnostic | Reviewed hashes | 1; 1 failed / 1 passed (intermediate fault accepted; 500-card display confirmed) | PR #44 review regressions doc |
| *R1–R3 focused:* `PATH=… npx --no-install vitest run src/perf/studyLibraryScenarios.test.ts` | Corrected harness | 0; **8 passed** (including 3 negative controls and the 1,000-card test); 14.9 s | Counted in the gate below |
| *R1–R3 official:* `PATH=… HFD_BENCH=1 HFD_BENCH_OUT=.smoke/mac-study-baseline/results-r1r3.json npx --no-install vitest run src/perf/appResponsiveness.bench.test.ts` | Corrected hashes below | 0; 1 passed; 275.3 s | [results-r1r3.min.json](evidence/mac-study-baseline-2026-10-02/results-r1r3.min.json) |
| *R1–R3 gate:* `npm ci` | Corrected diff | 0; 165 packages; 0 vulnerabilities (warm cache) | [local-gate-summary-r1r3.txt](evidence/mac-study-baseline-2026-10-02/local-gate-summary-r1r3.txt) |
| `npm test` | same | 0; 60 files passed / 3 skipped; **602 passed** / 4 skipped (599 plus 3 new) | same |
| `npm run build` | same | 0 | same |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | same (no Rust change) | 0 | same |
| `SDKROOT=…26.5.sdk cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | same | 0 (incremental cache) | same |
| `SDKROOT=… cargo test --locked --manifest-path src-tauri/Cargo.toml` | same | 0; 246 passed, 6 ignored | same |
| `npm run test:cargo-lock` | same | 0 | same |
| `git diff --check` plus a trailing-whitespace/final-newline scan of the untracked files | same | 0; clean | same |

The gate ran once, sequentially, after the corrected official run, with no source change in between. Documentation edits after it need only `git diff --check`.

**Final tested source hashes (SHA-256):**

```text
aa1b6d6d827df7d2e7e21d5c4b1b73ddfcda30984d7c79ef884cd443d7c2950e  src/perf/appResponsiveness.bench.test.ts   (unchanged since review)
91cffef1140c34fa64d185f0af7e9250fcd3a91211756b0f0413fb61c41cc788  src/perf/studyLibraryFixture.ts            (unchanged since review)
2af0e3afb8da4d0da001b3dbfaf62e2d7b2412276085f5471e6b61f5a3626598  src/perf/studyLibraryHarness.ts            (R1–R3)
86f6100a1e60ab637dc627038fb255200c7c14c35e6e42d20596970e5010fabe  src/perf/studyLibraryScenarios.test.ts     (R1–R2 regressions)
```

## Candidate decision

Acceptance targets are **proposed before any prototype**, to be agreed by the owner and Codex. Node/jsdom targets apply at the large tier; stress is informative.

| ID | Proposed target | Measured, large (corrected run) | Met? |
| --- | --- | --- | --- |
| T1 | Index-free compute median ≤ 4 ms for each measured state | 0.14–1.54 ms per state, including every narrowing prefix and expanded click (stress ≤ 3.39) | Yes |
| T2 | React render per interaction median ≤ 16 ms | Filter/search/sort at 100 shown: 1.48–13.89 ms. Show more to 200: 16.11 ms (marginally over). **Expanded clicks: up to 78.96 ms at 1,000 cards** | Yes at 100 shown; marginal at 200; **no for expanded clicks from 300 cards** |
| T3 | Interaction wall median ≤ 25 ms; per-keystroke median ≤ 16 ms | Initial/200: ≤ 20.28 ms; keystrokes 8.58–16.62 ms. **Expanded: up to 97.03 ms per click; 34.59 ms for a query from 1,000 shown** | Initial/200 yes (one keystroke at 16.62 is just above 16); **expanded no** |
| T4 | Edit plus full refresh median ≤ 50 ms | 20.90 / 19.80 ms (stress 33–35) | Yes (refresh while expanded unmeasured) |
| T5 | Cold load median ≤ 100 ms | 33.78 ms | Yes |
| W1 | Installed WKWebView keypress-to-next-paint p75 ≤ 100 ms at 5,000 | — | **UNVERIFIED** |
| W2 | Installed launch to usable, peak RSS, and expanded-display behavior | — | **UNVERIFIED** |

- **MiniSearch: NO-GO.** In every measured state, existing compute for the same view is 0.14–1.54 ms at large, and 4.0–7.8% of the same step's wall median across the 16 narrowing prefixes. It never exceeds 0.2 ms in the expanded scenarios. Search computation is not where the measured time goes. No index was built or measured, so this report claims no specific saving for a candidate. An index would add build time, memory, invalidation and semantic-equivalence work (normalization, joined-field substring matching).
- **TanStack Virtual: no adoption justified for the initial 100- and 200-card displays tested.** Those meet T3 and meet or marginally miss T2 (16.11 ms React for the 200-card click), and their cost does not grow with library size. **Expanded displays are different:** in jsdom the per-click cost grows with displayed cards and exceeds the proposed targets from 300 cards (97 ms wall at 1,000), and leaving a 1,000-card display costs about 35 ms. This is a measured rendering cost in a workload a user can reach. **This measurement alone does not justify adoption**, because:
  1. jsdom is not WKWebView layout/paint, and the installed cost is unknown;
  2. how often real use expands the list is unknown;
  3. the per-click React time suggests already-shown cards are re-rendered on each click, so a smaller dependency-free option (for example memoizing `MaterialCard`) would need to be compared fairly before choosing a library.

  Any future rendering pilot must be scoped to the expanded-display workload. It needs agreed targets, these exact fixtures and steps as the baseline, and a like-for-like comparison. It must preserve focus, selection, keyboard and screen-reader behavior, and the progressive display.
- **Refresh scaling:** Edits reload everything (linear, 22 selects). This meets T4 at the measured displays. Scoping it would change `AppDataContext` semantics that A2 is repairing, so it waits for A2.
- **Missing evidence:** Installed WKWebView for all states; displays above 1,000; scrolling and focus while expanded; refresh while expanded; macOS 12 WebKit; real file status; Windows WebView2.

## Roadmap continuation (unchanged sequence)

1. Complete and review A2 (Windows owner), then A3, A4 and A6. Reconcile dated A5 items with merged fixes.
2. MiniSearch only for a measured search bottleneck; none found. A rendering pilot (TanStack Virtual or a dependency-free alternative) only for the expanded-display workload, after installed evidence and a reviewed scope. One pilot per review.
3. M2 identities and history after the M1 check-in. Structured import (Zod/react-markdown) after contract approval. EmbedPDF later in M4 after license and macOS 12 review.

## Cross-machine continuation

- **Shared in this change:** All docs, fixture and harness code, and [sanitized evidence](evidence/mac-study-baseline-2026-10-02/README.md) (first-run and corrected-run files side by side) are in the uncommitted diff for Codex.
- **Local only:** Raw logs under `.smoke/mac-study-baseline/` (`gate/`, `gate-r1r3/`, trial and run logs).
- **Git outcome:** No commit, push, PR or merge by Claude. No release, tag, version or candidate change.

### Next step

Per the correction prompt, **stop for Codex's independent review of this corrected slice**. Do not start installed testing or another roadmap feature until that review completes. The installed-measurement prompt from the first version of this report remains a draft for after that review. It still requires a dedicated test account and an acceptable signing state, and it should now include the expanded-display steps (Show more to 1,000, query while expanded) among the installed measurements.
