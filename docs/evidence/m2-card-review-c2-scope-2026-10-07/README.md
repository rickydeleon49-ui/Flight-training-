# M2-4 / Card Reviews C2 — Scope and Query-Proof Evidence (7 October 2026)

This directory contains disposable synthetic evidence, query designs, and benchmark measurements for the **C2 Study Library Review Due and History Scope Proposal** ([`docs/M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md`](../../M2_CARD_REVIEW_C2_SCOPE_2026-10-07.md)).

No application source files (`src/`, `src-tauri/`), production dependencies, package lockfiles, migrations, or release configurations are modified by this planning assignment.

---

## 1. Evidence Manifest

| Path | Contents |
| --- | --- |
| [`proof/package.json`](proof/package.json) | Isolated scratch package declaring ESM module type for disposable Node scripts. Zero third-party dependencies. |
| [`proof/contractModel.mjs`](proof/contractModel.mjs) | Pure canonical JSON serialization, SHA-256 hashing, card version derivation, `simple-v1` scheduling arithmetic, local calendar midnight bisection, and candidate C2 queries over in-memory SQLite tables. |
| [`proof/syntheticDataset.mjs`](proof/syntheticDataset.mjs) | Synthetic dataset generator creating realistic databases with 100, 2,500, and 5,000 materials and up to 10,000 review events, covering all edge cases. |
| [`proof/proof.test.mjs`](proof/proof.test.mjs) | 15 `node:test` assertion suites covering all 6 required C2 contracts, boundary conditions, and semantic negative controls. |
| [`proof/benchmark.mjs`](proof/benchmark.mjs) | Performance benchmark runner measuring latencies across 100, 2,500, and 5,000 materials (min, p50, p95, p99, max), query plans, and breakdown between SQL and JSON/hash discovery costs. |
| [`optional_migration_0013.sql`](optional_migration_0013.sql) | Evaluated candidate Migration 0013 (provisional persistent index/cache table). Documents why it is **not recommended** for C2 and specifies schema ceiling, registry, and backup compatibility. |
| [`receipts/proof-run.txt`](receipts/proof-run.txt) | Raw output of `node --test proof.test.mjs`: **15 passed / 0 failed**, exit 0. |
| [`receipts/benchmark-run.txt`](receipts/benchmark-run.txt) | Raw benchmark execution output with scale sizes, timings, and database counts. |
| [`receipts/explain-query-plans.txt`](receipts/explain-query-plans.txt) | SQLite `EXPLAIN QUERY PLAN` output for candidate due-review, new-card discovery, and history keyset queries. |
| [`receipts/negative-controls.txt`](receipts/negative-controls.txt) | Detailed analysis of the three deliberate semantic failure variants proving test sensitivity. |
| [`results.json`](results.json) | Structured machine-readable benchmark results, query plans, and host toolchain metadata. |
| [`source-hashes.json`](source-hashes.json) | Rooted SHA-256 hashes of the proposal document, implementation prompt, and tracking files. |
| [`SHA256SUMS`](SHA256SUMS) | Checksums of every file in this evidence directory. |

---

## 2. How to Rerun

All scripts run on modern Node.js (v22+ or v26+) with built-in `node:sqlite` and `node:test`. No external packages or networks are used:

```bash
cd docs/evidence/m2-card-review-c2-scope-2026-10-07/proof

# 1. Run the 15-test correctness and negative-control suite:
node --test --test-reporter=spec proof.test.mjs

# 2. Run the 100 / 2,500 / 5,000-material performance benchmark:
node benchmark.mjs
```

---

## 3. What This Proves and What It Doesn't

### Meaningful Invariants Proved:
1. **Unmaterialized Current Content Discovery:**
   - Materials with valid raw cards that have never been rated or materialized in `card_versions` (`mat-nav-02`) are reliably discovered as materials with new cards.
   - When a material's study set is regenerated from Version A to Version B (`mat-changed-03`), Version A's due cards are strictly excluded from current due work, and all cards in Version B are recognized as new.
   - When content returns to identical Version A (`mat-revert-04`), Version A's retained spaced repetition schedule is safely reactivated.
2. **Exact Boundary Adherence:**
   - Again cards (step -1) are due at their exact instant (10 minutes after rating); evaluated 1ms before, they are excluded; at exact instant, they are included.
   - Day ladder cards (step >= 0) are due before the exclusive next local midnight of the computer's current time zone; on a 25-hour daylight saving fall-back day (e.g. America/Chicago on 2026-11-01), the bisection algorithm accurately identifies the 25-hour boundary (`2026-11-02T06:00:00.000Z`).
   - Cards flagged (e.g. `unclear`, `wrong_answer`) or suspended on unrated cards are excluded from both due work and new card counts.
3. **Deterministic Pagination & History Provenance:**
   - Keyset cursor pagination over tied timestamps (`reviewed_at`, tie-broken by `id`) produces zero duplicate rows and zero omitted rows across consecutive page requests.
   - History queries correctly flag events belonging to retired snapshot versions as `isEarlierVersion: true`.
   - Practice test attempts (Migration 0011: scores, percentages, questions answered) and flashcard review events (Migration 0012: ratings, state JSON) are strictly separated.
   - Material deletion cascades card review events, versions, and items, leaving tombstoned operation receipts (`is_erased = 1`).
4. **Performance Scalability Without Migration:**
   - At 100 materials: End-to-end review due discovery p50 = **1.51 ms** (p95 = **1.80 ms**).
   - At 2,500 materials: End-to-end review due discovery p50 = **11.71 ms** (p95 = **13.09 ms**).
   - At 5,000 materials (with 10,000 events): End-to-end review due discovery p50 = **22.51 ms** (p95 = **24.70 ms**).
   - Keyset history paging at 10,000 events: p50 = **5.81 ms** (p95 = **6.00 ms**).
   - Content hash verification cost across candidate materials: only **0.21 ms**.
   - These measurements prove that **Bounded On-Demand Discovery** comfortably satisfies the 50 ms user-perceived interactive budget without requiring any database schema migration.

### What This Does Not Prove:
- This is a disposable in-memory proof using synthetic data.
- It does not represent shipped native desktop builds, WebKit/Safari-specific rendering costs, or cross-platform SQLite driver quirks under Tauri IPC.
- It does not authorize production backfill or migration changes.
