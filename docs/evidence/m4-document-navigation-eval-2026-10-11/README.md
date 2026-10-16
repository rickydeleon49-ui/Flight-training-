# Her Flight Deck: Milestone 4 Document Navigation & PDF Viewer Evaluation Evidence

**State: COMPLETE DISPOSABLE TECHNICAL EVALUATION & CORRECTION SUITE (October 11, 2026)**

This evidence directory contains the disposable evaluation suite, synthetic PDF fixtures, contract model tests, lifecycle opener state machine, candidate schema, and execution receipts for **Milestone 4 (Document Navigation and Local Retrieval)**.

All corrections requested in the independent review ([docs/M4_DOCUMENT_NAVIGATION_SCOPE_REVIEW_2026-10-11.md](file:///Users/rickymac/code/Flight-training-m4-viewer-evaluation/docs/M4_DOCUMENT_NAVIGATION_SCOPE_REVIEW_2026-10-11.md)) have been implemented and validated across M4-R1 through M4-R4.

---

## 1. Environment & Baseline Verification

- **Worktree**: `/Users/rickymac/code/Flight-training-m4-viewer-evaluation` (isolated worktree)
- **Branch**: `codex/m4-navigation-viewer-evaluation`
- **Starting Commit**: `c28ab8482c8635b0b2bf74686b081e02bf448f65` (`origin/main`)
- **Primary Checkout & Concurrent Worktrees**: Completely untouched (`/Users/rickymac/code/Flight-training-` and `/Users/rickymac/code/Flight-training-m3-skills-scope`).
- **Production Code Status**: Clean; zero production code or lockfiles modified.
- **Runtime Migrations**: Candidate migration 0015 is **provisional, unregistered, and unapplied**.

---

## 2. Directory Contents

| Path | Description |
| --- | --- |
| `candidate/candidate_migration_0015.sql` | Proposed unregistered additive migration DDL for reading state, bookmarks, and content identity with strict 64-character hex check constraints and bound originating hash. |
| `fixtures/fixtures-manifest.json` | Metadata manifest for synthetic test fixtures (sizes, SHA-256 hashes, page counts). |
| `fixtures/*.pdf` | Deterministic synthetic PDF 1.4 byte fixtures (single page, multi-page, 50-page root, 16-page split, malformed). |
| `proof/contractModel.mjs` | Pure domain contract model implementing finite safe integer page clamping, provenance-aware label parsing, split translation, deleted root safety, and drift detection. |
| `proof/openerController.mjs` | Opener lifecycle state machine (`idle` -> `opening` -> `opened` / `failed` / `aborted`) proving honest reading semantics (no false progress) and route abort safety. |
| `proof/pdfParserDemonstration.mjs` | Structural PDF-1.4 parser demonstrating actual object loading, text stream extraction, and graceful rejection of malformed PDFs without process crash. |
| `proof/proof.test.mjs` | 10-part automated proof test suite (M4-P1 through M4-P10) validating contracts and the 10 diagnostic cases under Node's native test runner (`node:test`). |
| `proof/databaseVerification.test.mjs` | Genuine in-memory SQLite database tests migrating 0001–0013 to candidate 0015, verifying row retention, CHECK constraints, hash ownership, and rollback. |
| `scripts/generate_fixtures.mjs` | Generator script creating deterministic synthetic PDF files without external network dependencies. |
| `scripts/run_proof.mjs` | Self-contained proof runner executing all suites, reproducing frozen diagnostics, and updating execution receipts. |
| `scripts/verify_schema_probe.py` | Python sqlite3 probe verifying CHECK constraints, hash ownership, and CASCADE deletion. |
| `receipts/01-toolchain.txt` | Toolchain receipt (Node 26.10.0, npm 12.2.0, macOS 27.0.1 arm64). |
| `receipts/02-baseline.txt` | Repository baseline receipt verifying base commit and clean working tree. |
| `receipts/03-proof-suite.txt` | Raw execution log showing 10 passed proof tests, 5 database tests, and Python probe passing. |
| `receipts/04-hygiene.txt` | `git diff --check` and zero trailing-whitespace verification. |
| `receipts/05-frozen-diagnostics.txt` | Reproduction of frozen review diagnostics (8 failed, 2 passed controls on frozen submission, exit 1). |

---

## 3. How to Run

From the repository root or worktree directory:

```bash
# 1. Regenerate synthetic fixtures (deterministic)
node docs/evidence/m4-document-navigation-eval-2026-10-11/scripts/generate_fixtures.mjs

# 2. Run the complete proof suite, database tests, Python probe, and diagnostics reproduction
node docs/evidence/m4-document-navigation-eval-2026-10-11/scripts/run_proof.mjs

# 3. Direct execution of specific test suites via Node native runner
node --test docs/evidence/m4-document-navigation-eval-2026-10-11/proof/proof.test.mjs
node --test docs/evidence/m4-document-navigation-eval-2026-10-11/proof/databaseVerification.test.mjs

# 4. Direct execution of the Python schema probe
python3 docs/evidence/m4-document-navigation-eval-2026-10-11/scripts/verify_schema_probe.py

# 5. Reproduce frozen review diagnostics (expects exit 1: 8 failed, 2 passed controls)
node --test docs/evidence/m4-document-navigation-scope-review-2026-10-11/diagnostics.test.mjs
```

---

## 4. Summary of Measured Proof Results

1. **M4-P1 (Physical Page Indexing & Clamping)**: Confirms 1-based indexing ($1 \le P \le N$), safe clamping with warnings for explicitly physical bounds, and strict rejection of non-integers, NaN, Infinity, and fractions.
2. **M4-P2 (Provenance-Aware Page References & Printed Labels)**: Preserves string labels separately; unmapped printed labels and numeric strings without declared provenance remain unresolved (`physicalIndex: null`). Verified `labelToPhysicalMap` supported.
3. **M4-P3 (Split-Lineage Coordinate Space & Navigation Safety)**: Validates bidirectional mapping between child parts and root handbooks. Returns explicit destination spaces (`"root_physical"` vs `"parent_physical"`). Safely handles deleted roots (`code: "ROOT_DELETED"`) without misrouting coordinates to parents.
4. **M4-P4 (Content Replacement & Hash Drift Detection)**: Detects when a re-imported or restored document differs in SHA-256 hash. Reconciles bookmarks by flagging them as `'unverified'` while preserving their originating content hash.
5. **M4-P5 (Native Jump Fallback Messaging)**: Formats clear, actionable toast/HUD messages when native OS openers cannot accept CLI page parameters.
6. **M4-P6 (WebKit & Browser Boundary Audit)**: Formally documents the engine boundaries between macOS 12 Monterey (Safari 17.6 max, system WKWebView ~16.0) and modern Safari 18+ requirements. Explicitly marks historical WebKit compatibility as **unverified without physical hardware testing**.
7. **M4-P7 (Synthetic PDF Structural Parser Demonstration)**: Parses all synthetic PDF fixtures, extracts object text streams, and gracefully rejects malformed PDFs without process crash, with verified buffer cleanup.
8. **M4-P8 (Injected Opener Controller State Machine)**: Tests the opener lifecycle (`idle` -> `opening` -> `opened` / `failed` / `aborted`). Confirms that failed opening displays an error without claiming success, that reading progress is not advanced, and that route changes abort pending requests.
9. **M4-P9 (Candidate Migration 0015 In-Memory Verification)**: Confirms SQLite migration execution, rejection of malformed SHA-256 hashes, and persistence of bookmark originating hashes.
10. **M4-P10 (Corrected Diagnostics Execution)**: Executes the 10 diagnostic cases against the corrected model, confirming 10 passed out of 10.
11. **M4-DB-1–DB-5 (Database Migration & Integrity)**: Confirms pre-existing schema-13 row retention, check constraint validation, bookmark hash ownership, cascade cleanup, and transaction rollback.
