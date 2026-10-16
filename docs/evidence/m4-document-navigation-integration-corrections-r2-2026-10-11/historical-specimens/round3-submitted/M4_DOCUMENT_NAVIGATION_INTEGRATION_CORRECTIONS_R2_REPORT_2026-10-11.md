# Her Flight Deck — Milestone 4 Round-3 Integration Corrections Report (M4-R23–R27)

**Date**: October 11, 2026  
**Author**: Gemini (Implementer)  
**Reviewer**: Claude (Senior Reviewer, during Codex unavailability)  
**Baseline Commit**: `c28ab8482c8635b0b2bf74686b081e02bf448f65` (`origin/main`)  
**Worktree**: `/Users/rickymac/code/Flight-training-m4-viewer-evaluation` (`codex/m4-navigation-viewer-evaluation`)  
**Production Code Impact**: Zero production edits; zero lockfile modifications; candidate schema unapplied and unregistered. All changes left uncommitted.

---

## 1. Executive Summary & Context

This report documents the completion of the Round-3 integration corrections (**M4-R23 through M4-R27**) for Her Flight Deck's **Milestone 4 (Document navigation and local retrieval)** evaluation, addressing the findings and reproductions identified in:
- Review findings: [`docs/M4_ROUND2_CORRECTIONS_REVIEW_2026-10-11.md`](/Users/rickymac/code/Flight-training-reviewer-handoff-b/docs/M4_ROUND2_CORRECTIONS_REVIEW_2026-10-11.md)
- Prompt specification: [`docs/GEMINI_M4_ROUND3_CORRECTIONS_PROMPT_2026-10-11.md`](/Users/rickymac/code/Flight-training-reviewer-handoff-b/docs/GEMINI_M4_ROUND3_CORRECTIONS_PROMPT_2026-10-11.md)

All 5 round-3 corrections (R23–R27) are fully implemented and verified across both engine lanes (Node 22.23.3 and Node 26.10.0), with:
- **52 total tests** across 3 test suites (`proof.test.mjs` 39/39, `databaseLifecycle.test.mjs` 10/10, `sensitivityMutants.test.mjs` 3/3), all passing.
- **13 disposable sensitivity mutants** (`M1_RELAX_SHARED_COUNT_VALIDATOR` through `M13_RETRY_SENDS_NEWEST_GENERATION`), each failing its unchanged regression with a named `AssertionError`.
- **Traceability gate**: An automated runner step (`08b-report-readme-traceability.txt`) parsing this report and the README, asserting that every cited test name and mutant ID executed in the run.
- **Manifest & Prior Pack Verification**: Verified published `SHA256SUMS` for all 5 prior packs and the R9–R12 review pack with 0 mismatches. Re-verified the updated pack's authoritative `SHA256SUMS` in-run with receipt `16-manifest-verification.txt`.

---

## 2. Status Table: Requirements R23–R27 (Copied Verbatim from Receipts)

| Requirement | Description | Status | Exact Executed Test Name(s) | Exact Mutant ID(s) |
|---|---|---|---|---|
| **M4-R23** | Operation generation ordered across controller instances and sessions (restart fix) | **CLOSED** | `[M4-R23] session 1 saves several pages, then a new controller on the same database commits a new page`<br>`[M4-R23] two controllers on one database: the later request wins and the earlier held request is rejected`<br>`[M4-R13] held obsolete save is rejected at commit and page 42 never reaches storage` | `M12_DISABLE_CROSS_SESSION_GENERATION_ORDERING` |
| **M4-R24** | Late `retrySave` carries operation's own generation; rejected once superseded | **CLOSED** | `[M4-R24] retrySave sends the retried operation's own generation and is rejected once superseded by a newer request`<br>`[M4-R11] partial save failure offers deliberate save-only retry carrying same ownership` | `M13_RETRY_SENDS_NEWEST_GENERATION` |
| **M4-R25** | Report and README traceability built from executed receipts; verified by runner | **CLOSED** | Runner Step `08b report and README traceability validation` (asserts every cited test & mutant executed) | Runner Step `08b report and README traceability validation` (asserts all 13 mutants executed) |
| **M4-R26** | Complete regressions added: R13 criterion 4 lifecycle tests, R14(b) unverified row, copy-mutants | **CLOSED** | `[M4-R13] same-content repeat commits with advanced generation and preserves final database state`<br>`[M4-R13] changed content with same material ID commits new tuple and preserves final database state`<br>`[M4-R13] route navigation A -> B -> A commits each destination and preserves final database state for both materials`<br>`[M4-R13] explicit abort/unmount prevents in-flight operation from committing to storage`<br>`[M4-R13] delayed failure of earlier operation cannot overwrite or corrupt newer committed progress`<br>`[M4-R14] superseded or drifted generation row remains visibly unverified, never active` | `M12_DISABLE_CROSS_SESSION_GENERATION_ORDERING`<br>`M13_RETRY_SENDS_NEWEST_GENERATION` |
| **M4-R27** | Measured runner claims: no premature PASS, step 03 added fails, prior SHA256SUMS, recorded npm ci, receipt 16, PINNED_REF source | **CLOSED** | Runner Step `03 subject pack vs pre-edit inventory`<br>Runner Step `04 frozen submitted paths and prior rounds verification`<br>Runner Step `01b scratch engine install audit`<br>Runner Step `14 manifest tamper self-test`<br>Runner Step `16 manifest verification` | Runner Step `14 manifest tamper self-test` |

---

## 3. Retained Requirements R13–R22 Test Mapping (Copied Verbatim from Receipts)

| Requirement | Exact Executed Test Name(s) | Exact Mutant ID(s) |
|---|---|---|
| **M4-R13** | `[M4-R13] held obsolete save is rejected at commit and page 42 never reaches storage`<br>`[M4-R13] a fenced commit that throws is surfaced honestly and cannot leave the stale page` | `M4_DISABLE_COMMIT_GENERATION_FENCE` |
| **M4-R14** | `[M4-R14] a mid-flight content replacement commits the winner's whole tuple and nothing else` | `M11_OMIT_TUPLE_PROPAGATION` |
| **M4-R15** | `[M4-R15] unknown or malformed destination count cannot produce a verified destination` | `M6_DROP_DESTINATION_COUNT_REQUIREMENT` |
| **M4-R16** | `[M4-R16] a label map bound to different content is stale and cannot resolve`<br>`[M4-R16] a bound map still cannot resolve a mapped page outside the trusted count` | `M7_DROP_LABEL_CONTENT_BINDING` |
| **M4-R17** | `[M4-R17] resolveDestination refuses any reference without a trusted identity`<br>`[M4-R17] a caller-inflated count cannot open a destination beyond persisted identity`<br>`[M4-R17] resolver -> controller -> protocol compose into one durable destination` | `M8_TRUST_CALLER_DESTINATION_BOUNDS` |
| **M4-R18** | `[M4-R18] translated pages stay inside the bounded root range so arithmetic cannot overflow` | `M1_RELAX_SHARED_COUNT_VALIDATOR` |
| **M4-R19** | `[M4-R19] navigation writers with unknown or malformed identity persist unverified without throwing` | `M9_ALLOW_UNKNOWN_IDENTITY_ACTIVE` |
| **M4-R20** | `[sensitivity] clean modules pass all thirteen unchanged regressions`<br>`[sensitivity] each guard reversion fails its unchanged regression by name` | All 13 sensitivity mutants |
| **M4-R21** | `[M4-R21] populated schema 1-14 upgrade preserves all prior rows including M3 skills evidence`<br>`[M4-R21] candidate 0015 coexists with shipped 0014 for the navigation writers`<br>`[M4-R21] pointing the ledger back at this worktree's own migrations fails the verification`<br>`[M4-R21] an altered byte in the extracted ledger fails verification before any database is built`<br>`[M4-R21] older binary refuses a candidate-upgraded database using the derived ceiling` | `M10_HARDCODE_STALE_LEDGER_CEILING` |
| **M4-R22** | `[sensitivity] a missing scratch engine fails loudly and never borrows another directory` | Missing engine check in `scripts/run_integration_proof.mjs` and `scripts/record-scratch-artifacts.mjs` |

---

## 4. Corrections of Round-2 Claims Identified in Review

In accordance with the review findings in `M4_ROUND2_CORRECTIONS_REVIEW_2026-10-11.md`:

1. **Correction of M4-R23 (Restart Generation Desynchronization)**:
   - *Round-2 Defect*: `OpenerController` initialized `intentCounter = 0` per instance. When an app restarted or opened a second controller on a database that already held durable `owner_generation = 3`, the new controller issued `generation = 1`. In `persistenceProtocol.mjs`, `commitNavigation` rejected any save whose generation was `<= stored owner_generation`. As a result, after restart, the controller was permanently locked out from saving until it had issued more requests than the prior session.
   - *Correction*: `OpenerController` now queries the durable store (`identityProvider`, `generationSource`, or `injectedPersistence.getHighestGeneration`) at the start of `requestOpen`. It seeds `this.intentCounter` from `Math.max(this.intentCounter, Number(persistedGen) || 0) + 1`. Monotonic ordering across sessions and controller instances is guaranteed.
   - *Executed Regressions*:
     - `[M4-R23] session 1 saves several pages, then a new controller on the same database commits a new page`: Session 1 commits pages 5, 6, 7 (`owner_generation = 3`); a new controller on the same database commits page 9 with `owner_generation = 4`.
     - `[M4-R23] two controllers on one database: the later request wins and the earlier held request is rejected`: Controller 1's save is held in persistence; Controller 2 commits page 20; Controller 1's held save is unblocked and is rejected inside `commitNavigation` as superseded, leaving page 20 in the database.
     - `[M4-R13] held obsolete save is rejected at commit and page 42 never reaches storage`: Verified passing unchanged.

2. **Correction of M4-R24 (Late `retrySave` Stale-Winner Defect)**:
   - *Round-2 Defect*: `retrySave` sent `this.currentIntentId`. If Operation 1 (page 42) failed persistence, and Operation 2 (page 3) committed with `intentId = 2`, a late `retrySave` from Operation 1 sent `this.currentIntentId = 2` (or advanced), overwriting page 3 with page 42.
   - *Correction*: The partial-save failure closure in `requestOpen` binds the operation's own token: `retrySave: () => this.retrySave(material, record, intentId)`. In `retrySave(material, record, originalIntentId = null)`, if `originalIntentId !== null && this.currentIntentId !== originalIntentId`, the retry immediately returns `{ success: false, state: "aborted", superseded: true, reason: "superseded" }` without attempting persistence. Furthermore, if sent to persistence, `commitNavigation` rejects `originalIntentId <= current.owner_generation`.
   - *Executed Regression*: `[M4-R24] retrySave sends the retried operation's own generation and is rejected once superseded by a newer request`.

3. **Correction of M4-R25 (Report Traceability Defect)**:
   - *Round-2 Defect*: The Round-2 report and summary cited fabricated test names and fabricated mutant names (`M01_...`, `M02_...`, etc.) that did not exist in the code, and credited R18 with a mutant that did not exist.
   - *Correction*: Every test name and mutant ID in this report and `README.md` is copied verbatim from the executed test suites and `issue-to-test-map.json`. Runner step `08b` strictly parses the report and README and fails the run if any cited test or mutant did not execute.

4. **Correction of M4-R26 (Missing Regressions)**:
   - *Round-2 Defect*: R13 criterion 4 lifecycle tests and R14(b) unverified row test were omitted from the executed suite.
   - *Correction*: Added all 6 required tests with explicit final database assertions:
     - `[M4-R13] same-content repeat commits with advanced generation and preserves final database state`
     - `[M4-R13] changed content with same material ID commits new tuple and preserves final database state`
     - `[M4-R13] route navigation A -> B -> A commits each destination and preserves final database state for both materials`
     - `[M4-R13] explicit abort/unmount prevents in-flight operation from committing to storage`
     - `[M4-R13] delayed failure of earlier operation cannot overwrite or corrupt newer committed progress`
     - `[M4-R14] superseded or drifted generation row remains visibly unverified, never active`
     - Added copy-mutants `M12_DISABLE_CROSS_SESSION_GENERATION_ORDERING` and `M13_RETRY_SENDS_NEWEST_GENERATION`.

5. **Correction of M4-R27 (Asserted Runner Claims)**:
   - *Round-2 Defect*: `13-manifest.txt` wrote `RESULT: PASS` prematurely; `15-run-summary.json` wrote `manifest.verified: true` before verification and added a hardcoded `+ 1` to step count; final verification failure only reached console; Step 03 did not fail on added files; prior rounds' published `SHA256SUMS` were unverified; `npm ci` was not a recorded step; tamper test used a dummy file.
   - *Correction*:
     - `13-manifest.txt` describes manifest generation without premature PASS.
     - Final manifest verification executed and recorded in `receipts/16-manifest-verification.txt`.
     - `15-run-summary.json` writes `manifest.verified: verifyOk` and `stepsExecuted: steps.length` (exact measured step count).
     - Step 03 fails the run if `added.length > 0`.
     - Step 04 verifies published `SHA256SUMS` of all 5 prior packs and R9–R12 review pack.
     - Step 01b records `npm ci` engine install audit: command, cwd, exit code, resulting package and digests.
     - Step 14 tamper self-test tampers with delivered receipt `receipts/01-toolchain.txt` in a disposable copy and asserts detection.
     - Step 01 records whether `PINNED_REF` came from default or environment override.

---

## 5. Verification Execution & Multi-Lane Results

Both engine lanes were executed **sequentially** in accordance with project constraints.

### 5.1 Lane 1: Project Lane — Node 22 (v22.23.3)
- **Environment**: macOS Darwin 24.3.0 (arm64), Node.js v22.23.3 (`/opt/homebrew/opt/node@22/bin/node`).
- **Command**: `PATH=/opt/homebrew/opt/node@22/bin:$PATH node docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/scripts/run_integration_proof.mjs`
- **Exit Code**: `0`
- **Counts**: 18 steps executed, 52 mapped tests verified, 0 failures.
  - `proof.test.mjs`: **39 passed**, 0 failed.
  - `databaseLifecycle.test.mjs`: **10 passed**, 0 failed.
  - `sensitivityMutants.test.mjs`: **3 passed** (13 clean regressions passed, 13 mutants failed with named `AssertionError`, 1 scratch crash verified), 0 failed.
  - Legacy Parser Demonstration: Exit `0`, all 5 fixtures completed (50, 10, 1, 16 pages; graceful `InvalidPDFException`; forged `/Count 99` resolved to 50).
- **Integrity Gate**: Step 14 tamper self-test passed (detection of modified delivered receipt confirmed).
- **Checksum Verification**: `(cd docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11 && shasum -a 256 -c SHA256SUMS)`: **44 of 44 files OK (0 mismatches), Exit `0`**.

### 5.2 Lane 2: Second Lane — Node 26 (v26.10.0)
- **Environment**: macOS Darwin 24.3.0 (arm64), Node.js v26.10.0 (`/opt/homebrew/bin/node`).
- **Command**: `/opt/homebrew/bin/node docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/scripts/run_integration_proof.mjs`
- **Exit Code**: `0`
- **Counts**: 18 steps executed, 52 mapped tests verified, 0 failures.
  - `proof.test.mjs`: **39 passed**, 0 failed.
  - `databaseLifecycle.test.mjs`: **10 passed**, 0 failed.
  - `sensitivityMutants.test.mjs`: **3 passed** (13 clean regressions passed, 13 mutants failed with named `AssertionError`, 1 scratch crash verified), 0 failed.
  - Legacy Parser Demonstration: Exit `0`, all 5 fixtures completed.
- **Integrity Gate**: Step 14 tamper self-test passed.
- **Checksum Verification**: `(cd docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11 && shasum -a 256 -c SHA256SUMS)`: **44 of 44 files OK (0 mismatches), Exit `0`**.

---

## 6. Delivered Files Inventory

```
docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/
├── README.md                                    # Evidence pack guide & exact execution instructions
├── SHA256SUMS                                   # Authoritative sha256 checksum manifest (verified in-pack)
├── issue-to-test-map.json                       # Traceability matrix mapping R13–R27 to 52 tests & 13 mutants
├── candidate/
│   └── candidate_migration_0015.sql             # Provisional candidate migration DDL (unregistered)
├── fixtures/
│   ├── fixtures-manifest.json                   # Test PDF fixture manifest
│   ├── handbook_root_sample.pdf                 # 50-page root handbook PDF
│   ├── malformed_sample.pdf                     # Malformed syntax PDF fixture
│   ├── multi_page_sample.pdf                    # 10-page sample PDF
│   ├── single_page.pdf                          # 1-page sample PDF
│   └── split_part_sample.pdf                    # 16-page split chapter PDF
├── proof/
│   ├── contractModel.mjs                        # Unified destination & coordinate contract (R15, R16, R17, R18)
│   ├── databaseLifecycle.test.mjs               # SQLite lifecycle with shipped 0014 + candidate 0015 (R19, R21)
│   ├── openerController.mjs                     # Controller with cross-session generation ordering & late retry binding (R13, R14, R17, R23, R24)
│   ├── persistenceProtocol.mjs                  # Injected persistence protocol with generation checks (R13, R19, R23)
│   ├── proof.test.mjs                           # Regressions for R13-R26 (39 tests, all passing)
│   ├── realParserDemonstration.mjs              # PDF.js legacy engine demonstration (R22)
│   ├── sensitivityMutants.test.mjs              # 13 disposable mutation sensitivity tests (R13-R26)
│   └── shippedLedger.mjs                        # Real shipped migration ledger reader (R21)
├── receipts/
│   ├── 00-pre-edit-inventory.json               # Pre-edit workspace inventory
│   ├── 01-accepted-main.json                    # Accepted main commit & schema version receipt
│   ├── 01-toolchain.txt                         # Node & OS toolchain metadata, PINNED_REF source
│   ├── 01b-engine-install.txt                   # Scratch engine install audit receipt (R27)
│   ├── 02-accepted-main.txt                     # Accepted main migration ledger verification
│   ├── 03-subject-pack-inventory.txt            # Subject pack inventory check (fails on added)
│   ├── 04-frozen-submitted-paths.txt            # Frozen submitted paths & prior packs published SHA256SUMS
│   ├── 05-suite-proof.txt                       # 39-test proof suite execution receipt
│   ├── 06-suite-lifecycle.txt                   # 10-test database lifecycle execution receipt
│   ├── 07-suite-sensitivity.txt                 # 13-mutant sensitivity test receipt
│   ├── 08-issue-map-traceability.txt            # Issue-to-test map traceability receipt
│   ├── 08b-report-readme-traceability.txt       # Report & README traceability validation receipt (R25)
│   ├── 09-parser-legacy.txt                     # Legacy entrypoint 5-fixture execution receipt
│   ├── 10-parser-modern-historical.txt          # Modern entrypoint probe receipt
│   ├── 11-historical-reproductions.txt          # Historical reproductions from frozen rereview pack
│   ├── 12-hygiene.txt                           # Whitespace, staged, and tracked state hygiene receipt
│   ├── 13-manifest.txt                          # Generated manifest receipt
│   ├── 14-manifest-tamper-selftest.txt          # Manifest tamper self-test verification receipt
│   ├── 15-run-summary.json                      # Machine-readable execution summary (verified: true after check)
│   └── 16-manifest-verification.txt             # Authoritative in-run manifest verification receipt (R27)
├── scratch/
│   └── pdfjs-engine/                            # Isolated scratch dependency for pdfjs-dist@6.3.289
│       ├── package.json                         # Manifest-tracked package declaration
│       ├── package-lock.json                    # Manifest-tracked lockfile
│       └── scratch-artifacts.json               # Manifest-tracked audited artifact digests
└── scripts/
    ├── parser-entrypoint.mjs                    # Per-process parser runner for entrypoint isolation
    ├── pre-edit-inventory.mjs                   # Pre-edit inventory generator
    ├── prepare-accepted-main.mjs                # Accepted main ledger extractor
    ├── record-scratch-artifacts.mjs             # Artifact hashing script for scratch directory
    └── run_integration_proof.mjs                # Unified proof runner, verifier & receipt generator
```
