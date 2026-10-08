# M2 Card Reviews C2 — Bounded-Read Corrections Evidence Package (7 October 2026)

## Overview & Scope Summary

This evidence package completes the bounded-read planning corrections required by the reviewer in `docs/M2_CARD_REVIEW_C2_PIPELINE_REVIEW_2026-10-07.md` and `docs/M2_CARD_REVIEW_C2_BOUNDED_READ_CORRECTIONS_PROMPT_2026-10-07.md`.

All five prior evidence packages are preserved byte-for-byte:
1. `docs/evidence/m2-card-review-c2-scope-2026-10-07/`
2. `docs/evidence/m2-card-review-c2-scope-corrections-2026-10-07/`
3. `docs/evidence/m2-card-review-c2-scope-completion-2026-10-07/`
4. `docs/evidence/m2-card-review-c2-final-corrections-2026-10-07/`
5. `docs/evidence/m2-card-review-c2-read-pipeline-corrections-2026-10-07/`

All 38 paths in `origin/main:docs/evidence/m2-card-review-c2-pipeline-review-2026-10-07/submitted-source-hashes.json` were verified at the start of work and matched 100% byte-for-byte.

---

## Baseline Reproduction

The reviewer's frozen diagnostic (`docs/evidence/m2-card-review-c2-pipeline-review-2026-10-07/diagnostic.test.mjs`) was executed against the submitted contract model, reproducing the baseline result exactly:
- **1 control pass / 7 assertion failures** (Exit code: 1)
- Failures confirmed:
  1. Discovery malformed prefix wire bytes exceeded 2 MiB request budget (read 2.8 MB vs 2 MB).
  2. Pending malformed prefix wire bytes exceeded budget and reported 0 bytes transferred.
  3. Card budget stop read and transferred candidate across SQLite wire before refusing, concealing 24,281 bytes.
  4. History enrichment read two max-ASCII 500-card sets (3,041,002 bytes) ignoring requested 2 MiB budget.
  5. 250 pending UUID cursor length (13,296 chars) rejected by 8 KiB decoder limit (`MAX_CURSOR_LENGTH`).
  6. Missing cursor version (`v`) accepted without validation.
  7. History cursor missing `t/id` keyset fields accepted and silently restarted page 1 instead of throwing `INVALID_CURSOR`.

---

## Diagnostic Test Verification

All five frozen diagnostic test suites pass **100% unchanged**:
- **Diagnostic 1** (`docs/evidence/m2-card-review-c2-review-2026-10-07/diagnostic.test.mjs`): **9 / 9 passed** (Exit: 0).
- **Diagnostic 2** (`docs/evidence/m2-card-review-c2-rereview-2026-10-07/diagnostic.test.mjs`): **12 / 12 passed** (Exit: 0).
- **Diagnostic 3** (`docs/evidence/m2-card-review-c2-completion-review-2026-10-07/diagnostic.test.mjs`): **16 / 16 passed** (Exit: 0).
- **Diagnostic 4** (`docs/evidence/m2-card-review-c2-final-review-2026-10-07/diagnostic.test.mjs`): **11 / 11 passed** (Exit: 0).
- **Diagnostic 5** (`docs/evidence/m2-card-review-c2-pipeline-review-2026-10-07/diagnostic.test.mjs`): **8 / 8 passed** (Exit: 0, including control).

**Total Frozen Diagnostic Passes**: **56 / 56 passed** (zero failures, exit 0).

The comprehensive proof test suite (`proof.test.mjs`) passes **40 / 40 tests** (Exit: 0) across 12 suites, including Suite 12 with 8 new bounded-read and cursor contract tests.

---

## Core Corrections Implemented

### 1. C2-R4: Bounded Work Before Reads Across All Pipelines
- **Immediate SQLite Wire Accounting**: In both initial discovery and pending revalidation loops, `cumulativeRawBytes` increments by `Buffer.byteLength(flashcards_json)` immediately upon fetching the row from SQLite. Work counters strictly match instrumented SQLite byte and row counts, including budget boundary candidates.
- **Preflight Admission Stop**: Before issuing `getSetStmt.get(id)`, the reader preflights candidate byte length. If reading the next candidate would exceed `maxBatchRawJsonBytesBudget` or `maxBatchCardsBudget`, reading stops immediately. All unevaluated candidates are retained in `remIds` for subsequent continuation.
- **Absolute Bounded Single-Set Lane**: If the first candidate in a batch exceeds the query budget, it is admitted under the single-set lane only if its raw JSON byte size is within `ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES = 8388608` (8 MiB). Payloads exceeding 8 MiB are rejected without reading the raw blob, throwing `PAYLOAD_TOO_LARGE`.
- **Honest History Current-Content Enrichment**: When history enrichment reaches `maxBatchRawJsonBytesBudget`, unread sets are marked with `status: 'pending'` and `isEarlierVersion: null` (honest absence of proof) without guessing provenance or dropping events. The 2-MiB history budget test passes cleanly.
- **Complete Traversal Guarantees**: Retained candidate ordering guarantees that full traversal visits every eligible set exactly once, with zero lost or duplicated items despite resource-budget stops or stream modifications.

### 2. C2-R8: Consumable Cursors & Strict Validation Schemas
- **Consumable Cursor Length**: Expanded `MAX_CURSOR_LENGTH = 32768` (32 KiB). A full 250-candidate pending UUID batch encodes to ~13.3 KB base64, which now roundtrips cleanly without truncation or `INVALID_CURSOR` errors.
- **Strict Version Requirement**: Decoder strictly enforces `v === 1`. Omitted or alternative versions throw `INVALID_CURSOR`.
- **Bounded Keyset & Context Validation**:
  - `due` cursors validate `remIds` as an array of $\le 250$ strings ($\le 64$ chars each) and require normalized `ctx: { topic, statusFilter, nowUtc, nextLocalMidnightUtc }`.
  - `history` cursors strictly require keyset fields `t` (valid ISO string) and `id` (non-empty string $\le 64$ chars) before SQL. Missing `t` or `id` immediately throws `INVALID_CURSOR` rather than silently restarting page 1.
  - Arrays passed as objects, malformed structures, or mismatched contexts immediately throw `INVALID_CURSOR` / `STALE_CURSOR`.

### 3. Supporting Contracts Completed
- **Honest Worst-Case Arithmetic**: Replaced the 31.25 MB serialization estimate with honest code-point / UTF-8 arithmetic. A 500-card set with 1,000 front / 2,000 back code points yields ~1.5M code points, producing up to ~6 MB in UTF-8 (and ~5.26 MB in real JSON escaping).
- **Genuine 500-Card Max-Unicode Fixture**: Generated a genuine production-valid 500-card set containing 1,000 code-point front and 2,000 code-point back text (`\u4e00`–`\u9fa5` CJK ideographs), verifying validity before benchmarking.
- **Typed Legacy Schedule Inspection**: Implemented `validateScheduleState` validating raw `priorState` and `nextState` against C1 `simple-v1` ladder (`10m`, `1d`, `3d`, `7d`, `16d`, `35d`, `75d`, `150d`, `180d`). Malformed, out-of-range, or unsupported versions yield typed nulls (`step: null`, `dueAt: null`, `intervalDays: null`, `intervalLabel: null`) while preserving raw audit strings.
- **Repository-Relative Links**: Replaced all `file://` links in live delivery documents (`M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md` and `M2_CARD_REVIEW_C2_IMPLEMENTATION_PROMPT_2026-10-07.md`) with clean repository-relative paths.

---

## Mutation Verifier & Survival Control

- **Baseline**: `runMutants.mjs` runs baseline tests against the contract model; passes cleanly (Exit code: 0).
- **Mutants Killed**:
  - `mutant_wrong_version`: Fails with `AssertionError` (Exit code: 1).
  - `mutant_time_boundary`: Fails with `AssertionError` (Exit code: 1).
  - `mutant_cursor_tie`: Fails with `AssertionError` (Exit code: 1).
  - `mutant_owner_lock`: Fails with `AssertionError` (Exit code: 1).
  All 4 mutants killed.
- **Survival Control**: `mutantSurvivalControl.mjs` verifies that disabling assertions causes the verifier to report a mutant survival failure (Exit code: 0).

---

## Benchmark & Audit Performance Summary

Ran benchmarks across synthetic SQLite datasets (Node v22.23.3 / SQLite 3.53.4 on macOS Darwin arm64):

| Metric | 100 Materials Scale | 2,500 Materials Scale | 5,000 Materials Scale | Target |
| :--- | :--- | :--- | :--- | :--- |
| **Review Due Page 1 (limit 50)** | **p50 = 2.70 ms** | **p50 = 5.79 ms** | **p50 = 6.76 ms** | $\le 10\text{ ms}$ (PASS) |
| **Review Due Page 2 Cont.** | **p50 = 0.98 ms** | **p50 = 1.76 ms** | **p50 = 1.77 ms** | Fast resumption (PASS) |
| **History Page 1 (limit 20)** | **p50 = 1.15 ms** | **p50 = 4.48 ms** | **p50 = 9.52 ms** | $\le 15\text{ ms}$ (PASS) |
| **Full Discovery Traversal** | **p50 = 3.82 ms** (2 pages) | **p50 = 117.20 ms** (47 pages) | **p50 = 252.14 ms** (92 pages) | Bounded traversal (PASS) |
| **Preflight Byte Check** | p50 = 0.07 ms | p50 = 0.22 ms | p50 = 0.23 ms | Negligible overhead |
| **Raw JSON Reads** | p50 = 2.15 ms | p50 = 4.18 ms | p50 = 4.29 ms | Bounded transfer |
| **Max-Unicode 500 Cards Hash** | p50 = 5.82 ms (~5.26 MB) | p50 = 5.82 ms (~5.26 MB) | p50 = 5.82 ms (~5.26 MB) | Single-set lane bound |

*Note: Desktop IPC and WebKit rendering remain explicitly unmeasured.*

---

## Evidence Manifest & Artifact Verification

- `receipts/diagnostic-1-frozen.txt` & `.exit`: Diagnostic 1 (9/9 pass, exit 0)
- `receipts/diagnostic-2-frozen.txt` & `.exit`: Diagnostic 2 (12/12 pass, exit 0)
- `receipts/diagnostic-3-frozen.txt` & `.exit`: Diagnostic 3 (16/16 pass, exit 0)
- `receipts/diagnostic-4-frozen.txt` & `.exit`: Diagnostic 4 (11/11 pass, exit 0)
- `receipts/diagnostic-5-frozen.txt` & `.exit`: Diagnostic 5 (8/8 pass, exit 0)
- `receipts/proof-run.txt` & `.exit`: Full proof suite (40/40 pass, exit 0)
- `receipts/negative-controls.txt` & `.exit`: Mutation verifier killing all 4 mutants (exit 0)
- `receipts/mutant-survival.txt` & `.exit`: Mutation survival control detecting survivor (exit 0)
- `receipts/query-audit.txt`, `query-audit.json` & `.exit`: SQL query audit across pages and filters
- `receipts/benchmark-run.txt` & `.exit`: Multi-scale performance benchmark (exit 0)
- `receipts/explain-query-plans.txt`: Baseline SQLite query plans

All changes remain uncommitted and unpushed on branch `codex/m2-card-review-c2-scope`. Production C2 implementation remains pending independent scope review and owner approval. Proposed defaults C2-D1 through C2-D9 remain PROPOSED.
