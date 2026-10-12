# Her Flight Deck: Milestone 4 Document Navigation & PDF Viewer Evaluation Evidence

**State: COMPLETE DISPOSABLE TECHNICAL EVALUATION (October 11, 2026)**

This evidence directory contains the disposable evaluation suite, synthetic PDF fixtures, contract model tests, candidate schema, and execution receipts for **Milestone 4 (Document Navigation and Local Retrieval)**.

## Environment & Baseline Verification

- **Worktree**: `/Users/rickymac/code/Flight-training-m4-viewer-evaluation` (isolated worktree)
- **Branch**: `codex/m4-navigation-viewer-evaluation`
- **Starting Commit**: `c28ab8482c8635b0b2bf74686b081e02bf448f65` (current `origin/main`)
- **Primary Checkout & Concurrent Worktrees**: Completely untouched.
- **Production Code Status**: Clean; zero production code or lockfiles modified.
- **Runtime Migrations**: Candidate migration 0015 is **unregistered and unapplied**.

## Contents

| Path | Description |
| --- | --- |
| `candidate/candidate_migration_0015.sql` | Proposed unregistered additive migration DDL for reading state, bookmarks, and content identity. |
| `fixtures/fixtures-manifest.json` | Metadata manifest for synthetic test fixtures (sizes, SHA-256 hashes, page counts). |
| `fixtures/*.pdf` | Deterministic synthetic PDF 1.4 byte fixtures (single page, multi-page, 50-page root, 16-page split, malformed). |
| `proof/contractModel.mjs` | Pure domain contract model implementing page clamping, label parsing, split translation, drift detection, and native HUD formatting. |
| `proof/proof.test.mjs` | 7-part automated test suite validating contracts P1–P7 under Node native test runner (`node:test`). |
| `scripts/generate_fixtures.mjs` | Generator script creating deterministic synthetic PDF files without external network dependencies. |
| `scripts/run_proof.mjs` | Self-contained proof runner capturing stdout, stderr, timestamps, and exit codes into receipts. |
| `receipts/01-toolchain.txt` | Toolchain receipt (Node 26.10.0, npm 12.2.0, macOS 27.0.1 arm64). |
| `receipts/02-baseline.txt` | Repository baseline receipt verifying base commit and clean working tree. |
| `receipts/03-proof-suite.txt` | Raw execution log showing 7 passed tests with sub-millisecond durations. |
| `receipts/04-hygiene.txt` | `git diff --check` and zero trailing-whitespace verification. |

## How to Run

From the repository root or worktree directory:

```bash
# 1. Regenerate synthetic fixtures (deterministic)
node docs/evidence/m4-document-navigation-eval-2026-10-11/scripts/generate_fixtures.mjs

# 2. Run the disposable proof test suite and update execution receipts
node docs/evidence/m4-document-navigation-eval-2026-10-11/scripts/run_proof.mjs

# 3. Direct execution via Node's native test runner
node --test docs/evidence/m4-document-navigation-eval-2026-10-11/proof/proof.test.mjs
```

## Summary of Measured Proof Results

All 7 test suites pass deterministically:

1. **M4-P1 (Physical Page Indexing & Clamping)**: Confirms 1-based indexing ($1 \le P \le N$), graceful clamping with warnings for out-of-range navigation ($P < 1 \rightarrow 1$, $P > N \rightarrow N$), and rejection of non-integers.
2. **M4-P2 (Printed Page Labels vs Physical Indexes)**: Distinguishes pure physical indices from roman numerals (`iv`), chapter-hyphenated labels (`3-12`), appendices (`A-1`), and named landmarks (`Cover`).
3. **M4-P3 (Split-Lineage Page Translation)**: Validates bidirectional coordinate mapping between child split parts and root handbooks, enforcing bounds checking and out-of-part error diagnostics.
4. **M4-P4 (Content Replacement & Hash Drift Detection)**: Detects when a re-imported or restored document differs in SHA-256 hash from previously marked navigation points.
5. **M4-P5 (Native Jump Fallback Messaging)**: Formats clear, actionable toast/HUD messages when native OS openers cannot accept CLI page parameters.
6. **M4-P6 (WebKit & Browser Compatibility Audit)**: Formally checks the language feature and engine boundaries separating macOS 12 Monterey (Safari 15/16/17.6) from macOS 14 Sonoma (Safari 18+).
7. **M4-P7 (Synthetic PDF Structural Integrity)**: Validates that all generated fixtures adhere to PDF-1.4 header and trailer requirements.
