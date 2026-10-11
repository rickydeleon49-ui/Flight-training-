# Her Flight Deck: Milestone 4 Scope Remaining Corrections Evidence (M4-R5–R8)

**State: COMPLETE DISPOSABLE TECHNICAL EVALUATION (October 11, 2026)**

This distinct evidence directory contains the complete verification suite, candidate DDL, tests, receipts, and manifests for the remaining corrections (**M4-R5 through M4-R8**) specified in [docs/M4_DOCUMENT_NAVIGATION_SCOPE_REMAINING_CORRECTIONS_PROMPT_2026-10-11.md](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/M4_DOCUMENT_NAVIGATION_SCOPE_REMAINING_CORRECTIONS_PROMPT_2026-10-11.md) and reviewed in [docs/M4_DOCUMENT_NAVIGATION_SCOPE_REREVIEW_2026-10-11.md](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/M4_DOCUMENT_NAVIGATION_SCOPE_REREVIEW_2026-10-11.md).

---

## 1. Environment & Baseline Identity

- **Worktree**: `/Users/rickymac/code/Flight-training-m4-viewer-evaluation`
- **Branch**: `codex/m4-navigation-viewer-evaluation`
- **Base Commit**: `c28ab8482c8635b0b2bf74686b081e02bf448f65`
- **Remote HEAD**: `75f9f9300d3f219b3870ef98699641f3d36b7138` (`origin/main`)
- **Status of Working Trees**:
  - Primary checkout (`/Users/rickymac/code/Flight-training-`): **Untouched**.
  - Claude M3 worktree (`/Users/rickymac/code/Flight-training-m3-skills-scope`): **Untouched**.
  - Shared tracking files (`ROADMAP.md`, `STATUS.md`, `docs/PROJECT_HANDOFF.md`): **Untouched**.
  - Production code and dependencies: **Zero edits**.
  - Candidate migration 0015: **Provisional, unregistered, and unapplied**.

---

## 2. Directory Contents

| Path | Description |
| --- | --- |
| `candidate/candidate_migration_0015.sql` | Authoritative provisional candidate migration DDL with strict 64-character hex check constraints and bound originating content hash. |
| `fixtures/*.pdf` | Deterministic synthetic PDF 1.4 byte fixtures (single, multi-page, 50-page root, 16-page split, malformed). |
| `proof/contractModel.mjs` | Domain contract model implementing strict `Number.isSafeInteger` page validation, explicit coordinate provenance, range consistency, and bounded bookmark revalidation. |
| `proof/openerController.mjs` | Opener lifecycle state machine implementing pre-validation intent advancement, in-flight supersession, material-scoped reading progress, and injected durable persistence. |
| `proof/persistenceProtocol.mjs` | Reusable SQLite persistence protocol executing candidate DDL, bounded bookmark revalidation, and reading state updates. |
| `proof/realParserDemonstration.mjs` | Genuine PDF evaluation demonstration using `pdfjs-dist@6.3.289` in scratch dependencies, proving page catalog resolution and malformed input rejection. |
| `proof/proof.test.mjs` | Automated 10-part proof test suite (M4-P1 through M4-P10) validating contracts and replaying historical diagnostics. |
| `proof/databaseLifecycle.test.mjs` | File-backed SQLite tests covering reopen, mixed bookmark generations, out-of-bounds rejection, rollback, cascade, and backup/restore. |
| `proof/sensitivity.test.mjs` | Targeted mutant sensitivity suite testing 5 decisive guards by reversing them in disposable copies. |
| `scripts/run_remaining_proof.mjs` | Self-contained runner executing all test suites, verifying exact counts and exits, reproducing diagnostics, and writing receipts. |
| `receipts/01-toolchain.txt` | Toolchain environment receipt (Node v26.10.0, npm 12.2.0, macOS 27.0.1 arm64). |
| `receipts/02-baseline.txt` | Repository baseline verification receipt. |
| `receipts/03-proof-suite.txt` | Execution logs for proof suite, database lifecycle tests, and sensitivity mutants. |
| `receipts/04-hygiene.txt` | `git diff --check` and zero trailing-whitespace verification. |
| `receipts/05-diagnostics.txt` | Reproduction receipts for rereview diagnostics (13 fail / 2 pass) and frozen current controls (10 pass). |
| `archived-original-receipts/` | Exact byte-for-byte archived original receipts 02–04 and original SHA256SUMS from the first review submission. |
| `issue-to-test-map.json` | JSON mapping linking M4-R5 through M4-R8 to exact test cases and implementation files. |
| `SHA256SUMS` | SHA-256 checksum manifest covering all pack files. |

---

## 3. How to Run

From the repository root:

```bash
# 1. Run the entire remaining proof and diagnostics suite with receipt updates
node docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/scripts/run_remaining_proof.mjs

# 2. Run individual test suites directly
node --test docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/proof/proof.test.mjs
node --test docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/proof/databaseLifecycle.test.mjs
node --test docs/evidence/m4-document-navigation-scope-remaining-corrections-2026-10-11/proof/sensitivity.test.mjs

# 3. Reproduce the rereview diagnostics (expected exit 1: 13 failed, 2 passed controls)
node --test docs/evidence/m4-document-navigation-scope-rereview-2026-10-11/diagnostics.test.mjs

# 4. Verify historical frozen current controls (expected exit 0: 10 passed)
node --test docs/evidence/m4-document-navigation-scope-rereview-2026-10-11/frozen-current.test.mjs
```

---

## 4. Summary of Verification Results

- **Proof Suite (`proof.test.mjs`)**: **10 passed, 0 failed** (Exit 0).
  - Strict safe integer page validation and clamping.
  - Coordinate provenance required for numeric references (unknown remains unresolved).
  - Split lineage range lengths and nested parent coordinates verified.
  - Bounded bookmark revalidation: matching hash cannot verify page 42 in 10-page doc.
  - Evaluated real PDF parser demonstration (`pdfjs-dist@6.3.289` in scratch).
  - Opener lifecycle: supersession, material progress scoping, pre-validation, injected persistence.
  - All 10 historical diagnostics and all 13 rereview diagnostic assertions pass against corrected models.
- **Database Lifecycle Suite (`databaseLifecycle.test.mjs`)**: **7 passed, 0 failed** (Exit 0).
  - Upgrades from shipped 0001–0013 to candidate 0015 on file-backed SQLite.
  - Close and reopen across connection boundaries.
  - Content replacement A/50 -> B/10 with mixed bookmark generations.
  - Bounded revalidation: out-of-bounds bookmarks stay unverified.
  - Multi-table transaction rollback restores state on failure.
  - `ON DELETE CASCADE` cleans up all dependent navigation rows.
  - Disposable backup and restore preserves records and marks drift unverified.
- **Sensitivity Mutants Suite (`sensitivity.test.mjs`)**: **5 passed, 0 failed** (Exit 0).
  - Proves that reversing numeric provenance, bounds checking, early intent advancement, safe integer validation, or deleted root handling causes immediate regressions.
- **Rereview Diagnostics Reproduction**:
  - Replays `diagnostics.test.mjs` against unedited review snapshot: **13 failed, 2 passed controls** (Exit 1).
  - Replays `frozen-current.test.mjs`: **10 passed controls** (Exit 0).
