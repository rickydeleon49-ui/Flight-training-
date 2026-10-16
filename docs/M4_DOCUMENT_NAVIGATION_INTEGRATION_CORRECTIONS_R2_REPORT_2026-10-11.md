# Her Flight Deck — Milestone 4 Round-4 Integration Corrections Report (M4-R28–R32)

**Date**: October 11, 2026  
**Author**: Gemini (Implementer)  
**Reviewer**: Claude (Senior Reviewer, during Codex unavailability)  
**Baseline Commit**: `c28ab8482c8635b0b2bf74686b081e02bf448f65` (`origin/main`)  
**Worktree**: `/Users/rickymac/code/Flight-training-m4-viewer-evaluation` (`codex/m4-navigation-viewer-evaluation`)  
**Production Code Impact**: Zero production edits; zero lockfile modifications; candidate schema unapplied and unregistered. All changes left uncommitted.

---

## 1. Executive Summary & Context

This report documents the completion of the Round-4 integration corrections (**M4-R28 through M4-R32**) for Her Flight Deck's **Milestone 4 (Document navigation and local retrieval)** evaluation, addressing the findings and reproductions identified in:
- Review findings: [`docs/M4_DOCUMENT_NAVIGATION_ROUND3_REVIEW_2026-10-11.md`](M4_DOCUMENT_NAVIGATION_ROUND3_REVIEW_2026-10-11.md)
- Prompt specification: [`docs/M4_DOCUMENT_NAVIGATION_ROUND4_CORRECTIONS_PROMPT_2026-10-11.md`](M4_DOCUMENT_NAVIGATION_ROUND4_CORRECTIONS_PROMPT_2026-10-11.md)

All 5 round-4 corrections (R28–R32) are fully implemented and verified sequentially across both engine lanes (Node 22.23.3 and Node 26.10.0), with:
- **68 total mapped tests** across 3 test suites (`proof.test.mjs` 55/55, `databaseLifecycle.test.mjs` 10/10, `sensitivityMutants.test.mjs` 3/3), all passing.
- **16 disposable sensitivity mutants** (`M1_RELAX_SHARED_COUNT_VALIDATOR` through `M16_OMIT_POST_AWAIT_OWNERSHIP_RECHECK`), each failing its unchanged named regression with an `AssertionError`.
- **Dynamic traceability gate**: Automated runner step `08b` consumes `receipts/07b-executed-mutants.json` and asserts that every cited test name and mutant ID executed in the run, while rejecting unexecuted claims.
- **Two-stage manifest**: Decoupled Stage 1 payload checksums (112 entries in `PAYLOAD_SHA256SUMS`, verified and recorded in `receipts/16-manifest-verification.txt`) and Stage 2 outer delivery checksums (115 entries in `SHA256SUMS`, verified outside covered set).
- **Prior Pack Verification**: Published `SHA256SUMS` for all 5 prior packs and the R9–R12 review pack verified with 0 mismatches.
- **Preserved Historical Specimens**: Complete Round-3 submitted report, manifest, and receipts preserved under `historical-specimens/round3-submitted/`.

---

## 2. Status Table: Requirements R28–R32 (Copied Verbatim from Receipts)

| Requirement | Description | Status | Exact Executed Test Name(s) | Exact Mutant ID(s) |
|---|---|---|---|---|
| **M4-R28** | Atomic durable operation ownership reservation before async work | **CLOSED** | `[M4-R28] file-backed DB: overlapping controllers, earlier completion released first, later request wins`<br>`[M4-R28] file-backed DB: overlapping controllers, later completion released first, earlier completion rejected`<br>`[M4-R28] earlier pending operation is fenced from becoming a durable stale winner once later claim exists` | `M14_DISABLE_DURABLE_OWNERSHIP_RESERVATION` |
| **M4-R29** | Cancellation commit fence; abort while persistence is pending | **CLOSED** | `[M4-R29] abort while persistence is pending fences the operation before commit and preserves previous saved tuple`<br>`[M4-R29] an old operation cancellation cannot cancel or release a newer operation claim`<br>`[M4-R29] post-commit delayed acknowledgement retains storage result but suppresses publication` | `M15_DISABLE_COMMIT_CANCELLATION_FENCE` |
| **M4-R30** | Post-await immutable ownership recheck; isolate stale callbacks | **CLOSED** | `[M4-R30] late fulfilled commit acknowledgement cannot overwrite newer controller progress`<br>`[M4-R30] late retry acknowledgement cannot overwrite newer controller progress`<br>`[M4-R30] obsolete opener failure must leave winner notice and state intact`<br>`[M4-R30] route navigation A -> B -> A with delayed persistence leaves final winner intact` | `M16_OMIT_POST_AWAIT_OWNERSHIP_RECHECK` |
| **M4-R31** | Truthful install records; measured verification outcomes; two-stage manifest | **CLOSED** | `[M4-R31] delivered receipt altered after sealing causes runner verification failure and records truthful failure`<br>`[M4-R31] installer failure or verified reuse is recorded truthfully without fabricating zero-exit records`<br>`[M4-R31] payload verification failure records truthful failure and does not claim success` | Runner Step `14 manifest tamper self-test`<br>Runner Step `16 payload manifest verify` |
| **M4-R32** | Execution-derived mutant traceability; count alignment; reject unknown claims | **CLOSED** | `[M4-R32] report and README validator rejects unknown mutant claims including unexecuted probe IDs`<br>`[M4-R32] report and README validator rejects cited tests that were not executed`<br>`[M4-R32] executed mutant IDs and failure outcomes are derived from execution records` | All 16 sensitivity mutants consumed from `receipts/07b-executed-mutants.json` |

---

## 3. Retained Requirements R13–R27 Test Mapping (Copied Verbatim from Receipts)

| Requirement | Exact Executed Test Name(s) | Exact Mutant ID(s) |
|---|---|---|
| **M4-R13** | `[M4-R13] held obsolete save is rejected at commit and page 42 never reaches storage`<br>`[M4-R13] a fenced commit that throws is surfaced honestly and cannot leave the stale page`<br>`[M4-R13] same-content repeat commits with advanced generation and preserves final database state`<br>`[M4-R13] changed content with same material ID commits new tuple and preserves final database state`<br>`[M4-R13] route navigation A -> B -> A commits each destination and preserves final database state for both materials`<br>`[M4-R13] explicit abort/unmount prevents in-flight operation from committing to storage`<br>`[M4-R13] delayed failure of earlier operation cannot overwrite or corrupt newer committed progress` | `M4_DISABLE_COMMIT_GENERATION_FENCE` |
| **M4-R14** | `[M4-R14] a mid-flight content replacement commits the winner's whole tuple and nothing else`<br>`[M4-R14] superseded or drifted generation row remains visibly unverified, never active` | `M11_OMIT_TUPLE_PROPAGATION` |
| **M4-R15** | `[M4-R15] unknown or malformed destination count cannot produce a verified destination` | `M6_DROP_DESTINATION_COUNT_REQUIREMENT` |
| **M4-R16** | `[M4-R16] a label map bound to different content is stale and cannot resolve`<br>`[M4-R16] a bound map still cannot resolve a mapped page outside the trusted count` | `M7_DROP_LABEL_CONTENT_BINDING` |
| **M4-R17** | `[M4-R17] resolveDestination refuses any reference without a trusted identity`<br>`[M4-R17] a caller-inflated count cannot open a destination beyond persisted identity`<br>`[M4-R17] resolver -> controller -> protocol compose into one durable destination` | `M8_TRUST_CALLER_DESTINATION_BOUNDS` |
| **M4-R18** | `[M4-R18] translated pages stay inside the bounded root range so arithmetic cannot overflow` | `M1_RELAX_SHARED_COUNT_VALIDATOR` |
| **M4-R19** | `[M4-R19] navigation writers with unknown or malformed identity persist unverified without throwing` | `M9_ALLOW_UNKNOWN_IDENTITY_ACTIVE` |
| **M4-R20** | `[sensitivity] clean modules pass all thirteen unchanged regressions`<br>`[sensitivity] each guard reversion fails its unchanged regression by name` | All 16 sensitivity mutants |
| **M4-R21** | `[M4-R21] populated schema 1-14 upgrade preserves all prior rows including M3 skills evidence`<br>`[M4-R21] candidate 0015 coexists with shipped 0014 for the navigation writers`<br>`[M4-R21] pointing the ledger back at this worktree's own migrations fails the verification`<br>`[M4-R21] an altered byte in the extracted ledger fails verification before any database is built`<br>`[M4-R21] older binary refuses a candidate-upgraded database using the derived ceiling` | `M10_HARDCODE_STALE_LEDGER_CEILING` |
| **M4-R22** | `[sensitivity] a missing scratch engine fails loudly and never borrows another directory` | Engine isolation check in `scripts/run_integration_proof.mjs` |
| **M4-R23** | `[M4-R23] session 1 saves several pages, then a new controller on the same database commits a new page`<br>`[M4-R23] two controllers on one database: the later request wins and the earlier held request is rejected` | `M12_DISABLE_CROSS_SESSION_GENERATION_ORDERING` |
| **M4-R24** | `[M4-R24] retrySave sends the retried operation's own generation and is rejected once superseded by a newer request`<br>`[M4-R11] partial save failure offers deliberate save-only retry carrying same ownership` | `M13_RETRY_SENDS_NEWEST_GENERATION` |
| **M4-R25** | Runner Step `08b report and README traceability validation` (asserts every cited test & mutant executed) | `08b-report-readme-traceability.txt` |
| **M4-R26** | Complete regressions added; 16 mutants executed | Tested in suites 05, 06, 07 |
| **M4-R27** | Measured runner claims; step 03 added fails; prior SHA256SUMS; tamper self-test | Tested in runner steps 01-16 |

---

## 4. Retained Baseline Positive Controls and Boundary Checks

| Group | Exact Executed Test Name(s) |
|---|---|
| **M4-Controls** | `[control] bounded physical reference with trusted identity and complete nested translation work`<br>`[control] newer missing-path intent still blocks obsolete opener` |
| **M4-R9** | `[M4-R9] unknown and invalid totals cannot resolve physical destinations`<br>`[M4-R9] printed label map without a declared identity cannot resolve`<br>`[M4-R9] genuine first-level nullable parent metadata permits root navigation`<br>`[M4-R9] live root translation requires complete range metadata`<br>`[M4-R9] reverse translation cannot succeed without destination identity`<br>`[M4-R9] deleted root document returns structured snapshot guidance`<br>`[M4-R9] deleted parent document returns structured snapshot guidance`<br>`[M4-R9] physical index validation rejects non-integers, zeros, and out-of-bounds` |
| **M4-R10** | `[M4-R10] persisted bookmark cannot default verified outside active bounds`<br>`[M4-R10] identity replacement atomically invalidates bookmark and reading state`<br>`[M4-R10] unknown bounds cannot reverify a matching-hash bookmark`<br>`[M4-R10] content drift detector distinguishes verified, drifted and unknown`<br>`[M4-R10] atomic replacement transaction rolls back completely upon injected fault`<br>`[M4-R10] file-backed SQLite database safely closes and reopens`<br>`[M4-R10] synthetic backup and restore preserves state and detects drift/missing files`<br>`[M4-R10] deleting study_materials cascades to content identities, bookmarks, and reading state`<br>`[M4-R10] replacement of a drifted document leaves prior navigation visible but unverified` |
| **M4-R11** | `[M4-R11] same material with different content cannot inherit prior requested page`<br>`[M4-R11] public progress accessor must not leak A after failed B`<br>`[M4-R11] explicit abort refuses obsolete opener and prevents state publication`<br>`[M4-R11] opener refuses an out-of-bounds destination before native invocation`<br>`[M4-R11] partial save failure offers deliberate save-only retry carrying same ownership` |

---

## 5. Detailed Technical Closures for M4-R28 through M4-R32

### 5.1 M4-R28: Atomic Durable Operation Ownership Reservation
- **Defect in Round 3**: The cross-session restart fix sequentially read the last committed generation and added one. When two controllers overlapped before either saved, both allocated generation 1. If released in reverse order (older page 10 first, then newer page 20), the older request committed and the newer request was rejected, leaving stale page 10 in storage.
- **Closure**:
  - `DocumentPersistenceProtocol` creates `material_operation_claims (material_id TEXT PRIMARY KEY, reserved_generation INTEGER, cancelled_generation INTEGER, updated_at TEXT)` lazily under the write lock without modifying candidate migration 0015.
  - `reserveOperationOwnership(materialId, clientBase = null)` claims a monotonically increasing token inside `BEGIN IMMEDIATE TRANSACTION;`: `nextGen = Math.max(reservedGen, clientBase ?? savedGen) + 1` with safe integer overflow guards.
  - `OpenerController.requestOpen` reserves durable ownership before async opener or persistence work.
  - In `commitNavigation`, ownership is validated under the write lock: if a newer reservation exists (`resGen > savedGen && resGen > generation`), the commit aborts and returns `{ committed: false, reason: "superseded" }`.
- **Regressions**: Proves on file-backed SQLite databases with two connections that the later request wins regardless of completion order.

### 5.2 M4-R29: Commit Boundary Cancellation Fence
- **Defect in Round 3**: `abort()` invalidated only controller-local in-memory state. Pausing an operation in persistence before its transaction and then aborting still allowed the operation to write page 42 to the database.
- **Closure**:
  - `OpenerController` creates an active operation token for every save and retry, attaching `destination.isCancelled = () => activeOp.cancelled`.
  - `abort()` sets `activeOp.cancelled = true` and calls `cancelOperation(materialId, intentId)` in the database under the write lock.
  - In `commitNavigation`, cancellation is fenced before the write transaction commits: both in-memory `destination.isCancelled()` and durable `cancelled_generation >= generation` cause immediate abort, returning `{ committed: false, reason: "cancelled", persistedPage }` without modifying storage.
  - Delayed acknowledgements after a legitimate commit preserve the storage result but suppress obsolete controller publication.
- **Regressions**: Proves that abort while persistence is pending preserves previous saved page 5; old cancellations cannot cancel newer claims.

### 5.3 M4-R30: Post-Await Ownership Recheck & Callback Isolation
- **Defect in Round 3**: Controller methods published state after awaits without revalidating ownership, reverting the winning controller's page or notice on late callbacks.
- **Closure**:
  - `OpenerController` captures immutable context at entry (`intentId`, `material.id`).
  - Guards post-await blocks in `requestOpen` and `retrySave` with `if (this.currentIntentId !== intentId || this.currentMaterialId !== material.id || activeOp.cancelled) return this.#superseded(...)`.
  - `#superseded` is pure: returns `{ success: false, state: "aborted", superseded: true }` without mutating `this.state` or `this.lastNotice`.
  - Obsolete callbacks return operation-local superseded results leaving the winning controller intact.
- **Regressions**: Proves late commit acknowledgements, late retry acknowledgements, and late opener failures leave winner page 20, notice, and state intact.

### 5.4 M4-R31: Truthful Install Records & Two-Stage Manifest
- **Defect in Round 3**: Runner pre-wrote `exit: 0`, PASS, and `manifest.verified: true` before executing `shasum`, leaving success receipts even on tampered failures. Step `01b` fabricated a zero-exit `npm ci` record without executing npm.
- **Closure**:
  - Step `01b` executes actual `npm ci` when `--install` is supplied, or performs verified-reuse by validating lockfile, package.json, and legacy pdf.mjs digests against `scratch-artifacts.json`, explicitly labeling the mode as `verified-reuse`.
  - Two-stage manifest architecture:
    - Stage 1: `PAYLOAD_SHA256SUMS` seals all 112 payload deliverables. Real command `shasum -a 256 -c PAYLOAD_SHA256SUMS` executes and writes measured exit and results to `receipts/16-manifest-verification.txt`.
    - `receipts/15-run-summary.json` records actual measured execution outcomes.
    - Stage 2: Outer `SHA256SUMS` seals all 115 final deliverables (including payload manifest and receipts 15 & 16). Final seal verification is executed as an outer measured check.
  - Permanent negative probes verify that tampered receipts cause real runner failure and failure receipts.

### 5.5 M4-R32: Execution-Derived Mutant Traceability & Count Alignment
- **Defect in Round 3**: Step `08b` used a hardcoded M1–M13 whitelist and ignored unexecuted claims. Report, summary, console, and source disagreed on step counts (18 vs 22 vs 23) and entry counts (44 vs 45).
- **Closure**:
  - Sensitivity runner outputs `receipts/07b-executed-mutants.json` containing all 16 executed mutant IDs and assertion failures.
  - Step `08b` consumes this record dynamically, matching any `M\d+_[A-Z0-9_]+` pattern, rejecting unexecuted claims, and failing if any executed mutant is missing from report/README.
  - Step counts and checksum counts aligned across all outputs:
    - Console: `steps: 23, mapped tests: 68`
    - Summary: `stepsExecuted: 23, mappedTests: 68, deliveryEntries: 115`
    - Payload manifest: 112 entries; delivery manifest: 115 entries.

---

## 6. Complete List of Executed Sensitivity Mutants (M1 – M16)

Derived directly from `receipts/07b-executed-mutants.json`:

1. `M1_RELAX_SHARED_COUNT_VALIDATOR` — fails regressionTotals
2. `M2_REJECT_NULLABLE_PARENT` — fails regressionFirstLevelLineage
3. `M3_OMIT_ATOMIC_BOOKMARK_INVALIDATION` — fails regressionAtomicInvalidation
4. `M4_DISABLE_COMMIT_GENERATION_FENCE` — fails regressionHeldSaveFence
5. `M5_IGNORE_CONTENT_PROGRESS_SCOPE` — fails regressionContentScoping
6. `M6_DROP_DESTINATION_COUNT_REQUIREMENT` — fails regressionDestinationCount
7. `M7_DROP_LABEL_CONTENT_BINDING` — fails regressionLabelBinding
8. `M8_TRUST_CALLER_DESTINATION_BOUNDS` — fails regressionTrustedCount
9. `M9_ALLOW_UNKNOWN_IDENTITY_ACTIVE` — fails regressionUnknownIdentity
10. `M10_HARDCODE_STALE_LEDGER_CEILING` — fails regressionLedgerCeiling
11. `M11_OMIT_TUPLE_PROPAGATION` — fails regressionTuplePropagation
12. `M12_DISABLE_CROSS_SESSION_GENERATION_ORDERING` — fails regressionCrossSessionOrdering
13. `M13_RETRY_SENDS_NEWEST_GENERATION` — fails regressionLateRetrySuperseded
14. `M14_DISABLE_DURABLE_OWNERSHIP_RESERVATION` — fails regressionDurableReservationOrder
15. `M15_DISABLE_COMMIT_CANCELLATION_FENCE` — fails regressionCancellationFence
16. `M16_OMIT_POST_AWAIT_OWNERSHIP_RECHECK` — fails regressionPostAwaitOwnership

---

## 7. Multi-Lane Verification Results

Both engine lanes were executed **sequentially**:

### 7.1 Lane 1: Project Lane — Node 22 (v22.23.3)
- **Command**: `PATH=/opt/homebrew/opt/node@22/bin:$PATH node docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/scripts/run_integration_proof.mjs`
- **Exit Code**: `0`
- **Output**: `steps: 23, mapped tests: 68, failures: 0`
- **Suites**:
  - `proof.test.mjs`: **55 passed**, 0 failed
  - `databaseLifecycle.test.mjs`: **10 passed**, 0 failed
  - `sensitivityMutants.test.mjs`: **3 passed** (16 clean regressions passed, 16 mutants failed with named `AssertionError`, 1 scratch crash verified)
- **Manifests**:
  - `PAYLOAD_SHA256SUMS`: 112 of 112 files OK, Exit `0`
  - `SHA256SUMS`: 115 of 115 files OK, Exit `0`

### 7.2 Lane 2: Second Lane — Node 26 (v26.10.0)
- **Command**: `/opt/homebrew/bin/node docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/scripts/run_integration_proof.mjs`
- **Exit Code**: `0`
- **Output**: `steps: 23, mapped tests: 68, failures: 0`
- **Suites**:
  - `proof.test.mjs`: **55 passed**, 0 failed
  - `databaseLifecycle.test.mjs`: **10 passed**, 0 failed
  - `sensitivityMutants.test.mjs`: **3 passed**
- **Manifests**:
  - `PAYLOAD_SHA256SUMS`: 112 of 112 files OK, Exit `0`
  - `SHA256SUMS`: 115 of 115 files OK, Exit `0`

---

## 8. Preserved Historical Evidence & Deliverables

- **Preserved Specimens**: `historical-specimens/round3-submitted/` contains the unmodified Round-3 report, `SHA256SUMS` (45 entries), and all 20 receipts.
- **Candidate Migration**: `candidate/candidate_migration_0015.sql` remains intact (87 lines, hash `8e03b7bc8c0bd0bd27a1990351c6afa2733008ea9f9f7310a2ca754a29e7ef96`).
- **Boundaries**: Strictly evidence-only. Zero production edits, zero dependencies, zero migration registrations, no application builds or launches.
- All files left **uncommitted and unpushed** in `/Users/rickymac/code/Flight-training-m4-viewer-evaluation`.
