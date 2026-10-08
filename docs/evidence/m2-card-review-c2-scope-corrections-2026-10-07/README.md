# M2 Card Review C2 Scope Corrections Evidence (7 October 2026)

This directory contains the verified, runnable proof modules, benchmarks, query plans, receipts, and preserved artifacts for the **C2 Planning Corrections Assignment** resolving findings **C2-R1 through C2-R5** from `docs/M2_CARD_REVIEW_C2_SCOPE_REVIEW_2026-10-07.md`.

Original submitted evidence in `docs/evidence/m2-card-review-c2-scope-2026-10-07/` is preserved byte-for-byte in compliance with the eighteen-path manifest. Original submitted proposal and implementation prompt documents are preserved in `submitted/docs/`.

---

## 1. Issue-to-Fix & Evidence Mapping (C2-R1 through C2-R5)

| Finding | Defect in Submitted Baseline | Corrected Design & Contract | Verifying Proof & Receipts |
| :--- | :--- | :--- | :--- |
| **C2-R1**<br>Bounded discovery, progress & pagination | 1. Ignored `cursor`, repeating page 1.<br>2. Fixed 250 cutoff before eligibility, losing older actionable items.<br>3. 400 raw JSON reads for 50 requested due results. | 1. Progressive keyset candidate stream `(priority ASC, updated_at DESC, id ASC)`.<br>2. Bounded candidate budget (`candidateBatchBudget = 250`) returning consumable `nextCursor`.<br>3. Candidate scan stops immediately when `limit` is met (exactly 50 raw reads for 50 results).<br>4. Reaches items beyond 250 ineligible candidates via continuation. | `scratch/diagnostic.test.mjs` (Cases 1, 2, 3 pass verbatim)<br>`receipts/frozen-diagnostic.txt`<br>`proof.test.mjs` (Assertion 3)<br>`receipts/negative-controls.txt` (Control 3) |
| **C2-R2**<br>Raw current version owns schedule & counts | 1. Used `is_active = 1` for identity, losing retained schedule on raw A reversion.<br>2. Subquery counted touched states across whole material, reducing B's new cards by retired A states. | 1. Raw cards in `ai_study_sets.flashcards_json` authoritatively define current version via `deriveCardVersion`.<br>2. Look up snapshot by exact derived version ID (ignoring `is_active`).<br>3. Review states queried strictly by `i.version_id = currentVersionId`.<br>4. Zero-write schedule recovery on A reversion; cross-version touch isolation. | `scratch/diagnostic.test.mjs` (Cases 4, 5 pass verbatim)<br>`receipts/frozen-diagnostic.txt`<br>`proof.test.mjs` (Assertion 1)<br>`receipts/negative-controls.txt` (Control 1) |
| **C2-R3**<br>Accurate history provenance | Used `isEarlierVersion = !v.is_active`, mislabeling raw unmaterialized B replacement as current A, and inactive A reversion as earlier. | 1. Batch-loads raw saved cards for all distinct materials appearing on the history page.<br>2. Derives current version ID for each material.<br>3. `isEarlierVersion = (row.version_id !== currentVersionId)`.<br>4. Accurate labels for valid-empty, malformed, or reverted sets without snapshot mutations. | `scratch/diagnostic.test.mjs` (Cases 6, 7 pass verbatim)<br>`receipts/frozen-diagnostic.txt`<br>`proof.test.mjs` (Assertion 4) |
| **C2-R4**<br>Measured architecture & performance evidence | 1. Fabricated cache/backfill p50/p95 (8.2/11.4 ms) without runnable benchmarks.<br>2. "Hash" benchmark looped 50 parses without hashing.<br>3. Fixture contained 9,874 events (not 10,000).<br>4. Claimed 50-ms interaction budget based on in-memory SQLite alone. | 1. Removed unsupported numbers; substituted measured benchmarks with qualitative tradeoffs.<br>2. Full instrumented pipeline: SQL candidates, raw JSON reads, JSON validation, canonicalization, SHA-256 version & item hashing.<br>3. Exact 10,000 events generated at 5,000 material scale.<br>4. Real measurements recorded in `results.json`; desktop IPC/UI explicitly labeled unmeasured. | `proof/benchmark.mjs`<br>`receipts/benchmark-run.txt`<br>`receipts/explain-query-plans.txt`<br>`results.json` |
| **C2-R5**<br>Lifecycle/restore proof & conditional prompt | 1. History test lacked full oracle comparison.<br>2. Deletion tested nonexistent hard-coded `ver-aero-01`.<br>3. Lacked deferred-read controller model for held continuations and reset generation barriers. | 1. Full tied-event traversal compared against independent ordered SQL oracle.<br>2. Real pre/post deletion version and item IDs tested.<br>3. `DeferredReadController` class proves generation barriers, held continuations, and read retries without replaying writes.<br>4. Rewrote scope & implementation prompt with typed contracts. | `proof/proof.test.mjs` (Assertions 3, 4)<br>`receipts/proof-run.txt`<br>`docs/M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md`<br>`docs/M2_CARD_REVIEW_C2_IMPLEMENTATION_PROMPT_2026-10-07.md` |

---

## 2. Directory Contents

- `proof/contractModel.mjs`: Corrected contract model with candidate progression keyset paging, authoritative raw content versioning, batch history provenance, and `DeferredReadController`.
- `proof/syntheticDataset.mjs`: Multi-scale database generator (100, 2,500, 5,000 materials with exactly 10,000 events, adversarial 500-card sets, and ineligible prefixes).
- `proof/proof.test.mjs`: Complete 15-test verification suite covering all R1–R5 assertions and negative controls.
- `proof/benchmark.mjs`: Performance benchmark measuring exact execution pipelines, query plans, byte transfers, and adversarial cases.
- `optional_migration_0013.sql`: Evaluated provisional acceleration migration under C2-D8/D9 with measured impact.
- `receipts/frozen-diagnostic.txt`: Raw output of the reviewer's frozen diagnostic (`9/9 passed`).
- `receipts/frozen-diagnostic.exit`: Exit code `0`.
- `receipts/proof-run.txt`: Raw test output of `proof.test.mjs` (`15/15 passed`).
- `receipts/proof-run.exit`: Exit code `0`.
- `receipts/negative-controls.txt`: Documentation and run records for all deliberate failure controls.
- `receipts/negative-controls.exit`: Exit code `0`.
- `receipts/benchmark-run.txt`: Full output of benchmark execution on Apple M5 / Node v22.23.3 / SQLite 3.53.4.
- `receipts/benchmark-run.exit`: Exit code `0`.
- `receipts/explain-query-plans.txt`: Exact SQLite query plans for candidate discovery, raw reads, version lookups, and history.
- `results.json`: Machine-readable benchmark measurements across all scales.
- `submitted/docs/`: Byte-identical copies of original submitted proposal and implementation prompt prior to correction.

---

## 3. How to Reproduce All Runs

Using Node 22 (`/opt/homebrew/opt/node@22/bin/node` on this host):

```bash
# 1. Run the frozen reviewer diagnostic against corrected model (9/9 pass, exit 0)
C2_REVIEW_MODEL="$(pwd)/docs/evidence/m2-card-review-c2-scope-corrections-2026-10-07/proof/contractModel.mjs" \
  /opt/homebrew/opt/node@22/bin/node --test scratch/diagnostic.test.mjs

# 2. Run the complete proof test suite (15/15 pass, exit 0)
/opt/homebrew/opt/node@22/bin/node --test docs/evidence/m2-card-review-c2-scope-corrections-2026-10-07/proof/proof.test.mjs

# 3. Run the performance benchmark and regenerate results.json
/opt/homebrew/opt/node@22/bin/node docs/evidence/m2-card-review-c2-scope-corrections-2026-10-07/proof/benchmark.mjs
```
