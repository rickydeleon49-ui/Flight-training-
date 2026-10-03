# Structured study import contract evidence — 3 October 2026

Prepared by Claude on the Mac, on branch `codex/structured-study-import-contract`. The base is clean `main` `8fb3b7f` (PR #56); the handoff was local and uncommitted; [Codex now accepts preparation](../../STRUCTURED_STUDY_IMPORT_ACCEPTANCE_2026-10-03.md). It supports the [contract](../../STRUCTURED_STUDY_IMPORT_CONTRACT_2026-10-03.md) and the [implementation handoff](../../STRUCTURED_STUDY_IMPORT_IMPLEMENTATION_HANDOFF_2026-10-03.md).

**Status: [preparation accepted; R1–R5 independently closed](../../STRUCTURED_STUDY_IMPORT_ACCEPTANCE_2026-10-03.md). Production adoption and installed evidence remain gated.**

- [Codex's review](https://github.com/rickydeleon49-ui/Flight-training-/blob/main/docs/STRUCTURED_STUDY_IMPORT_REVIEW_2026-10-03.md) found R1–R4, corrected in `prototype-corrected/` and `results-corrected/`.
- [Codex's re-review](https://github.com/rickydeleon49-ui/Flight-training-/blob/main/docs/STRUCTURED_STUDY_IMPORT_REREVIEW_2026-10-03.md) (PR #58) confirmed R1–R4 and found R5, corrected in `prototype-r5/`, `results-r5/` and [`r5-receipt-2026-10-03.txt`](r5-receipt-2026-10-03.txt).

- The original sources (`prototype/`), results (`results/`) and receipt (`validation-receipt-2026-10-03.txt`) are **kept unchanged** as reviewed history.
- The corrections are in `prototype-corrected/`, `results-corrected/` and [`correction-receipt-2026-10-03.txt`](correction-receipt-2026-10-03.txt).
- Two existing files changed: `expected-outcomes.json` (new fixtures 54–58 and preview assertions) and this README.
- The issue-to-fix map with exact test names is in [contract §8](../../STRUCTURED_STUDY_IMPORT_CONTRACT_2026-10-03.md#8-review-correction-map-r1r4).

**This is a disposable experiment, not production adoption.**

- The prototype ran in a scratch directory outside the repository, with exact versions installed using `--ignore-scripts`. The repository's `package.json`, `package-lock.json` and `node_modules` were not used or changed.
- Prototype sources are saved here as inert `.txt` files.
- All fixtures are synthetic: invented labels and letters, no training content, personal notes or keys. Credential-shaped strings are assembled at run time and never committed.

## Contents

| Path | What it is |
| --- | --- |
| [`fixtures/`](fixtures) | 45 hand-written packets, numbered by case |
| [`expected-outcomes.json`](expected-outcomes.json) | The expected result for every fixture: accepted, or the rejecting stage and the exact set of error codes; plus warnings, counts and selected values |
| [`prototype/`](prototype) | Prototype sources and commands (`*.txt`), the scratch `package.json` and `package-lock.json`, and the schema-check tooling |
| [`results/`](results) | Machine-readable results of the final run, logs, the dependency/license inventory and the API scan |
| [`validation-receipt-2026-10-03.txt`](validation-receipt-2026-10-03.txt) | Original submission: commands, exit codes, repository checks and SHA-256 of every new or changed file (unchanged) |
| [`prototype-corrected/`](prototype-corrected) | Corrected sources (R1–R3), the permanent regressions, Codex's adapted diagnostics, the corrected mutation and aggregate runners, the before-run script and the DTO typecheck. Helpers not listed there are byte-identical to `prototype/`. |
| [`results-corrected/`](results-corrected) | Corrected run results; `before-reviewed-prototype/` holds the new tests run against the frozen reviewed prototype |
| [`correction-receipt-2026-10-03.txt`](correction-receipt-2026-10-03.txt) | R1–R4 correction: starting-hash verification, commands, counts, exits, intermediate failures and SHA-256 of every file in that package (unchanged) |
| [`prototype-r5/`](prototype-r5) | R5 sources: the validator with the source-notes rule, regressions with 12 `R5:` tests, Codex's source-notes diagnostic (output path only adapted), the fixture runner (R5 assertions), the mutation runner (M16–M18) and the focused runner `run-r5.sh` (exit propagation). Files not listed there are byte-identical to `prototype-corrected/` or `prototype/`. |
| [`results-r5/`](results-r5) | R5 run results; `before-r1r4-prototype/` holds the new tests run against the frozen R1–R4 prototype |
| [`r5-receipt-2026-10-03.txt`](r5-receipt-2026-10-03.txt) | R5: starting-hash verification, commands, counts, exits, intermediate failures and SHA-256 of every file in the package |

The generated cases (49) are defined with their expectations in [`prototype/boundary-cases.mjs.txt`](prototype/boundary-cases.mjs.txt). These are multi-megabyte, near-limit, encoding and privacy cases that are better built in memory.

## Fixture map

| Case | Fixtures |
| --- | --- |
| Guide only, no automatic test | 01 (warning `no_practice_test`) |
| Flashcards plus an explicit test | 02 (answer indexes 1 and 2 derived from choice IDs; refs and source claim flagged unverified) |
| Unicode | 03 (NFC composition, CRLF to LF, Hebrew/Greek/CJK/emoji, bidi warning) |
| Questions only | 04 |
| Hostile HTML, MDX, URLs, images, embedded "instructions" | 05 (accepted as data; rendered safely, see the render results) |
| Unsupported or missing version and format | 10–14, 53 |
| Malformed JSON | 15, 16, 47 |
| Duplicate keys | 17 |
| Duplicate or missing IDs | 18–21, 22 (invalid characters) |
| Invalid answer keys | 23 (not in choices), 24 (case only), 25 (number), 26 (legacy `correctIndex`), 27 (multiple), 31 (missing) |
| Choices | 28 (duplicate text), 29 (duplicate ID), 32 (one choice) |
| Unsupported question type | 30 |
| Null, wrong type, blank, empty packet, root array | 33, 44, 39, 38, 43 |
| Special property names | 34 (`__proto__`), 35 (`constructor` nested) |
| Fetch/upload/action directives | 36 |
| Numbers, control characters, lone surrogates | 40, 41, 42 |
| Source references | 45 (page out of range), 46 (empty) |
| Markdown nesting (render guard) | 51 (70 quote levels: plain-text fallback), 52 (16 levels: formatted) |
| Guide source notes (review R5) | 59 (questions + notes only: rejected), 60 (blank summary, empty sections + notes: rejected), 61 (cards + notes, normalized: saved), 62 (guide sections + notes + questions: saved), 63 (questions + blank notes: valid, no study set), 64 (notes only: `packet_empty`) |
| Preview data and source claims (review R2) | 54 (note-only claim), 55 (date-only claim), 56 (blank source: no claim), 57 (references on several items, normalized labels; asserted absent from persistence), 58 (cards only); preview assertions added to 01, 02, 04 |
| Size and nesting boundaries; encodings; credentials; error cap; sentinels | generated (below, at and above each limit) |
| Cancellation and failed-save conservation | fake-adapter scenarios S1–S11 |

## R5 run (2026-10-03T22:04Z, same host and toolchain)

The command is `HFD_CHECKOUT=<checkout> run-r5.sh` (`prototype-r5/run-r5.sh.txt`). It reruns only the checks whose inputs changed and **exits 1 if any step fails** (self-test: `results-r5/runner-r5-selftest-summary.txt`, exit 1). The renderer, depth probes, API scan and legacy simulation are unchanged since the R1–R4 run and were not rerun.

| Check | Evidence level | After R5 | Before (frozen R1–R4 prototype) |
| --- | --- | --- | --- |
| Fixtures, generated cases, reader | executable (Zod 4.6.5) | 106/106 | 104/106 (59 and 60 accepted) |
| Permanent regressions | executable | 41/41 | 37/41 (the 4 orphan-notes tests fail) |
| Codex's source-notes diagnostic | executable | 6/6 | 4/6 (the same 2 failures Codex recorded) |
| Codex's original diagnostics, adapted | executable | 8/8 | — |
| Fake adapter | **fake store, not a database** | 13/13 | — |
| CSP probe | executable | `jitless` 0 `Function` calls | — |
| Mutations | executable | 22/22 as expected: **19 caught, 3 neutralized** (M10, M12a, M12b) | — |
| Schema consistency | executable (ajv 8.20.0) | 56 fixtures, 46 asserted, 0 failed | — |
| DTO typecheck | TypeScript 5.9.3, repository settings | positive exit 0 (9 typed values); reviewed `Omit` types exit 2 | — |

## Corrected run for R1–R4 (2026-10-03T21:40Z, same host and toolchain), kept as history

The command is `HFD_CHECKOUT=<checkout> prototype-corrected/run-all.sh.txt`, run as `run-all.sh`. It **exits 1 if any step fails** (self-test: `results-corrected/runner-selftest-summary.txt`, exit 1).

| Check | Evidence level | After correction | Before (frozen reviewed prototype) |
| --- | --- | --- | --- |
| Fixtures, generated cases, reader | executable (Zod 4.6.5) | 100/100 | 92/100 against the corrected expectations |
| Permanent regressions (`R1:`, `R2:`, `R3:`, 2 controls) | executable | 29/29 | 7/29 (22 failed, as expected) |
| Codex's diagnostics, adapted to `preview.data` | executable | 8/8 | 2/8 (the same 6 failures Codex recorded) |
| Renderer (unchanged) | executable (react-markdown 10.1.0) | 23/23, 0 fetches | — |
| Fake adapter | **fake store, not a database** | 13/13 | — |
| Mutations | executable | 19/19 as expected: 16 caught, 3 absorbed by the second privacy layer (M10, M12a, M12b). *Clarified 3 October after the re-review: the first version of this row said 15 and 4; the recorded JSON was always 16 and 3.* | — |
| CSP probe | executable | `jitless` 0, default 9 `Function` calls | — |
| Legacy capability simulation | Node, **not WebKit** | unchanged outcome | — |
| Schema consistency | executable (ajv 8.20.0) | 50 fixtures, 40 asserted, 0 failed | — |
| DTO typecheck | TypeScript 5.9.3, repository settings | positive exit 0; reviewed `Omit` types exit 2 (two TS2322) | — |

## Original run (2026-10-03T21:02Z, Node v22.23.3, npm 10.9.9, Apple M5, macOS 27.0.1), kept as history

The command is `HFD_CHECKOUT=<checkout> prototype/run-all.sh` (`results/run-all-summary.txt`).

| Check | Evidence level | Result | Exit |
| --- | --- | --- | --- |
| Validator (`run-fixtures`) | executable prototype (Zod 4.6.5) | 95/95 passed: 45 fixtures, 49 generated cases, 1 bounded-reader check | 0 |
| Renderer (`run-render`) | executable prototype (react-markdown 10.1.0) | 23/23 passed; 0 fetch calls | 0 |
| Mutations (`run-mutations`) | executable | 11/11 deliberate defects caught | 0 |
| CSP probe, `jitless` | executable | 0 `Function` constructor calls | 0 |
| CSP probe, default | executable | 9 `Function` constructor calls (what the app CSP would report) | 0 |
| Legacy capability simulation | Node simulation, **not WebKit** | validator fine without Safari 15.4 APIs; renderer throws without `Object.hasOwn` and works with a shim | 0 |
| API scan | static and indicative | 373 files; `structuredClone` ×6 (polyfilled through `@ungap/structured-clone`), `Object.hasOwn` ×3 (react-markdown) | 0 |
| Unguarded depth probes | executable | `RangeError` at deep block-quote, list and emphasis nesting; parse succeeds, conversion overflows | 0 |
| Schema consistency (ajv 8.20.0) | executable | 35 asserted fixtures agree, 10 scan-stage differences recorded, 0 failures | 0 |
| Schema normalization difference | executable | decomposed 400-code-point title: schema invalid; the app accepts it after NFC (200) | 0 |
| Fake-adapter scenarios | **fake in-memory store, not a database** | 13/13: cancellation, no preview writes, rollback after each insert, retry once, double click, unknown outcome, refresh failure, bounded lock retry, conflict, stale replacement | 0 |

**Failures before the final run**, all corrected and kept in the record:

1. The first nesting estimator counted the space after each marker as indentation (fixture 52 failed).
2. `skipHtml: true` deleted HTML blocks together with adjacent text. Changed to the default, which escapes HTML.
3. The renderer displayed `http://asset.localhost` as text. Local hosts are now excluded.
4. Inline emphasis at the body limit overflowed, so the line-prefix nesting rule was replaced by an iterative depth guard on the parsed tree.
5. A 32-node guard was too tight for lists (two nodes per level) and was raised to 64.
6. The first mutation run missed the object-depth check, so an object-nesting case was added.

**Timing** (Node, M5; indicative only):

- a 4 MiB padded packet validates in about 7 ms
- 250,000 values in about 19 ms
- emphasis-bomb bodies at the 20,000-code-point limit take about 1.0–1.7 s to parse before the guard falls back

## Limits of this evidence

- Nothing ran in WKWebView, Tauri, the installed app, macOS 12 or Windows.
- No SQLite, sql.js or native transaction ran. The fake adapter models the *proposed* interaction rules only.
- `pick_study_packet` and `save_structured_study_import` do not exist. `io.mjs` only mirrors the proposed bounded read in Node.
- Credential detection is a set of patterns for accidental pastes, not a guarantee.
- The proposed limits are not yet checked against real exported packets (decision D12).

## Candidate provenance

From the npm registry, accessed 2026-10-03 at 20:40Z:

- `zod@4.6.5` (MIT, no dependencies, published 2026-09-13)
- `react-markdown@10.1.0` (MIT, published 2025-03-07, upstream gitHead `44d2e4a4…`)

Integrity values are in `prototype/package-lock.json.txt`. The full transitive inventory with licenses (88 MIT, 1 ISC including React) is in `results/dependency-inventory.tsv`. Test-only: `ajv@8.20.0` (MIT), in a separate scratch directory (`prototype/schema-check-package-lock.json.txt`).
