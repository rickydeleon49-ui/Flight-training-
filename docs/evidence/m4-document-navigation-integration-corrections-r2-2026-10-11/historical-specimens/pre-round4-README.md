# Her Flight Deck — Milestone 4 Round-4 Integration Corrections Evidence Pack (2026-10-11)

## Executive Summary

This evidence pack delivers the integrated, reproducible round-4 correction package for Her Flight Deck's **Milestone 4 (Document navigation and local retrieval)** evaluation, addressing findings and requirements **M4-R28 through M4-R32** alongside retained corrections **M4-R13 through M4-R27** in full alignment with:
- Review findings: [`docs/M4_DOCUMENT_NAVIGATION_ROUND3_REVIEW_2026-10-11.md`](../../M4_DOCUMENT_NAVIGATION_ROUND3_REVIEW_2026-10-11.md)
- Prompt specification: [`docs/M4_DOCUMENT_NAVIGATION_ROUND4_CORRECTIONS_PROMPT_2026-10-11.md`](../../M4_DOCUMENT_NAVIGATION_ROUND4_CORRECTIONS_PROMPT_2026-10-11.md)
- Comprehensive Report: [`docs/M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_R2_REPORT_2026-10-11.md`](../../M4_DOCUMENT_NAVIGATION_INTEGRATION_CORRECTIONS_R2_REPORT_2026-10-11.md)

All work is self-contained within this evidence pack and the updated evaluation documents in worktree `/Users/rickymac/code/Flight-training-m4-viewer-evaluation`. Production application code, dependencies, shipped migrations (0001–0014), the migration registry, and shared tracking files (`ROADMAP.md`, `STATUS.md`, `docs/PROJECT_HANDOFF.md`) remain untouched. Candidate migration 0015 remains strictly provisional and unregistered.

---

## Technical Summary of Delivered Corrections (M4-R28 – M4-R32)

### M4-R28: Atomic Durable Operation Ownership Reservation (Two Overlapping Controllers)
- In `proof/persistenceProtocol.mjs`, `DocumentPersistenceProtocol` manages durable operation ownership tokens via `material_operation_claims (material_id, reserved_generation, cancelled_generation, updated_at)` created on-demand under the write lock.
- `reserveOperationOwnership(materialId, clientBase = null)` claims a unique, monotonically advancing reservation token inside `BEGIN IMMEDIATE TRANSACTION;`, independently from the last successfully saved reading tuple.
- In `proof/openerController.mjs`, `requestOpen` claims durable ownership before any asynchronous opener or persistence work.
- In `commitNavigation`, ownership is validated under the transaction write lock: an earlier pending operation is rejected if a newer claim has been reserved, ensuring that two overlapping controllers preserve the later request regardless of completion order.
- Regressions:
  - `[M4-R28] file-backed DB: overlapping controllers, earlier completion released first, later request wins`
  - `[M4-R28] file-backed DB: overlapping controllers, later completion released first, earlier completion rejected`
  - `[M4-R28] earlier pending operation is fenced from becoming a durable stale winner once later claim exists`
- Covered by copy-mutant `M14_DISABLE_DURABLE_OWNERSHIP_RESERVATION`, which fails an unchanged regression by name.

### M4-R29: Commit Boundary Cancellation Fence & Abort While Persistence Pending
- In `proof/openerController.mjs`, active operation tracking binds a cancellable operation token through normal saves and save-only retries (`destination.isCancelled = () => activeOp.cancelled`).
- Calling `abort()` triggers both in-memory cancellation and database-backed `cancelOperation(materialId, intentId)` under the write lock.
- In `proof/persistenceProtocol.mjs`, `commitNavigation` checks both `destination.isCancelled()` and the durable `cancelled_generation` claim before committing the transaction.
- Cancellation before commit prevents writing and preserves the previous saved tuple unchanged with an honest `cancelled` result.
- A legitimate completed commit retains its durable storage result while suppressing obsolete publication.
- Regressions:
  - `[M4-R29] abort while persistence is pending fences the operation before commit and preserves previous saved tuple`
  - `[M4-R29] an old operation cancellation cannot cancel or release a newer operation claim`
  - `[M4-R29] post-commit delayed acknowledgement retains storage result but suppresses publication`
- Covered by copy-mutant `M15_DISABLE_COMMIT_CANCELLATION_FENCE`, which fails an unchanged regression by name.

### M4-R30: Post-Await Ownership Recheck & Stale Callback Isolation
- In `proof/openerController.mjs`, immutable operation context is captured at entry and revalidated after every `await`:
  - After native opener invocation.
  - After persistence write in `requestOpen`.
  - After persistence write in `retrySave`.
- Post-await checks verify `this.currentIntentId === intentId && this.currentMaterialId === material.id && !activeOp.cancelled`.
- Late fulfilled commit acknowledgements, late retry acknowledgements, and late opener failures return operation-local superseded results without clearing or mutating the winning controller's page, notice, state, or verdict.
- Regressions:
  - `[M4-R30] late fulfilled commit acknowledgement cannot overwrite newer controller progress`
  - `[M4-R30] late retry acknowledgement cannot overwrite newer controller progress`
  - `[M4-R30] obsolete opener failure must leave winner notice and state intact`
  - `[M4-R30] route navigation A -> B -> A with delayed persistence leaves final winner intact`
- Covered by copy-mutant `M16_OMIT_POST_AWAIT_OWNERSHIP_RECHECK`, which fails an unchanged regression by name.

### M4-R31: Truthful Installation Records, Measured Outcomes, and Two-Stage Manifest
- Synthetic zero-exit install records removed. Step `01b` executes actual `npm ci` when `--install` is provided, or performs verified reuse by validating lockfile, package.json, and compiled engine artifact digests against `scratch-artifacts.json`, explicitly labeling the mode as `verified-reuse`.
- Two-stage manifest architecture resolves checksum self-reference without fabricating outcomes:
  - **Stage 1**: `PAYLOAD_SHA256SUMS` seals all 112 payload deliverables. Real command `shasum -a 256 -c PAYLOAD_SHA256SUMS` executes and writes measured exit and results to `receipts/16-manifest-verification.txt`.
  - `receipts/15-run-summary.json` records actual measured execution outcomes.
  - **Stage 2**: Outer `SHA256SUMS` seals all 115 final deliverables (including payload manifest and receipts 15 & 16). Final seal verification is executed as an outer measured check.
- Permanent negative probes:
  - `[M4-R31] delivered receipt altered after sealing causes runner verification failure and records truthful failure`
  - `[M4-R31] installer failure or verified reuse is recorded truthfully without fabricating zero-exit records`
  - `[M4-R31] payload verification failure records truthful failure and does not claim success`

### M4-R32: Execution-Derived Mutant Traceability, Active Claims, and Count Alignment
- Sensitivity runner emits `receipts/07b-executed-mutants.json` with machine-readable IDs and failure assertion messages for all 16 executed mutants.
- Step `08b` consumes this record dynamically, verifying that:
  - Every mutant cited in the report and README executed and passed.
  - Every executed mutant in `07b-executed-mutants.json` is cited.
  - Any unknown, fabricated, or unexecuted claim causes an immediate fatal runner error.
- Negative probes:
  - `[M4-R32] report and README validator rejects unknown mutant claims including unexecuted probe IDs`
  - `[M4-R32] report and README validator rejects cited tests that were not executed`
  - `[M4-R32] executed mutant IDs and failure outcomes are derived from execution records`
- Step counts and manifest counts aligned consistently across console, summary, report, and source:
  - Console: `steps: 23, mapped tests: 68`
  - Summary: `stepsExecuted: 23, mappedTests: 68, deliveryEntries: 115`
  - Payload manifest: 112 entries; delivery manifest: 115 entries.

---

## Verbatim Executed Sensitivity Mutants (M1 – M16)

All 16 sensitivity mutants are executed in disposable worktrees and verified against unchanged named regressions:

1. `M1_RELAX_SHARED_COUNT_VALIDATOR` — reverts totalPages check; fails regression: totalPages Infinity must not resolve
2. `M2_REJECT_NULLABLE_PARENT` — rejects nullable parent lineage; fails regression: first-level lineage must allow root navigation
3. `M3_OMIT_ATOMIC_BOOKMARK_INVALIDATION` — skips bookmark invalidation; fails regression: bookmark must not remain verified after content replacement
4. `M4_DISABLE_COMMIT_GENERATION_FENCE` — disables commit generation fence; fails regression: obsolete page 42 must never become durable
5. `M5_IGNORE_CONTENT_PROGRESS_SCOPE` — ignores content hash scope; fails regression: new content B cannot inherit page 42 from content A
6. `M6_DROP_DESTINATION_COUNT_REQUIREMENT` — drops destination count requirement; fails regression: unknown destination count must report DESTINATION_COUNT_UNKNOWN
7. `M7_DROP_LABEL_CONTENT_BINDING` — drops label content binding; fails regression: stale label map must not resolve
8. `M8_TRUST_CALLER_DESTINATION_BOUNDS` — trusts caller destination bounds; fails regression: caller-inflated count must not reach the opener
9. `M9_ALLOW_UNKNOWN_IDENTITY_ACTIVE` — allows unknown identity active; fails regression: unknown identity must never be active
10. `M10_HARDCODE_STALE_LEDGER_CEILING` — hardcodes ledger ceiling 13; fails regression: ledger must verify against the derived ceiling 13
11. `M11_OMIT_TUPLE_PROPAGATION` — omits winning tuple propagation; fails regression: durable hash must belong to winning operation
12. `M12_DISABLE_CROSS_SESSION_GENERATION_ORDERING` — ignores persisted generation across sessions; fails regression: new session on same database must commit new page
13. `M13_RETRY_SENDS_NEWEST_GENERATION` — allocates new generation on retry; fails regression: late retry must be rejected when superseded
14. `M14_DISABLE_DURABLE_OWNERSHIP_RESERVATION` — skips durable reservation; fails regression: later request must win even when earlier completion lands first
15. `M15_DISABLE_COMMIT_CANCELLATION_FENCE` — ignores cancellation at commit boundary; fails regression: abort before commit must preserve previous saved page
16. `M16_OMIT_POST_AWAIT_OWNERSHIP_RECHECK` — omits post-await check; fails regression: stale acknowledged operation must not replace winning controller progress

---

## Directory Inventory

```
docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/
├── README.md                                    # This guide
├── PAYLOAD_SHA256SUMS                           # Stage 1 payload manifest (112 entries)
├── SHA256SUMS                                   # Stage 2 outer delivery manifest (115 entries)
├── issue-to-test-map.json                       # Traceability matrix mapping R13–R32 to 68 tests & 16 mutants
├── candidate/
│   └── candidate_migration_0015.sql             # Provisional candidate migration DDL (unregistered)
├── fixtures/
│   ├── fixtures-manifest.json                   # Test PDF fixture manifest
│   ├── handbook_root_sample.pdf                 # 50-page root handbook PDF
│   ├── malformed_sample.pdf                     # Malformed syntax PDF fixture
│   ├── multi_page_sample.pdf                    # 10-page sample PDF
│   ├── single_page.pdf                          # 1-page sample PDF
│   └── split_part_sample.pdf                    # 16-page split chapter PDF
├── historical-specimens/
│   └── round3-submitted/                        # Preserved round 3 submitted specimens (report, SHA256SUMS, receipts)
├── proof/
│   ├── contractModel.mjs                        # Unified destination & coordinate contract (R15, R16, R17, R18)
│   ├── databaseLifecycle.test.mjs               # SQLite lifecycle with shipped 0014 + candidate 0015 (10 tests)
│   ├── openerController.mjs                     # Controller with atomic reservation, cancellation, & post-await rechecks (R28, R29, R30)
│   ├── persistenceProtocol.mjs                  # Injected persistence protocol with claims table & cancellation fence (R28, R29)
│   ├── proof.test.mjs                           # Regressions for R13-R32 (55 tests, all passing)
│   ├── realParserDemonstration.mjs              # PDF.js legacy engine demonstration (R22)
│   ├── sensitivityMutants.test.mjs              # 16 disposable mutation sensitivity tests (R13-R32)
│   └── shippedLedger.mjs                        # Real shipped migration ledger reader (R21)
├── receipts/
│   ├── 00-pre-edit-inventory.json               # Pre-edit workspace inventory
│   ├── 01-accepted-main.json                    # Accepted main commit & schema version receipt
│   ├── 01-toolchain.txt                         # Node & OS toolchain metadata, PINNED_REF source
│   ├── 01b-engine-install.txt                   # Scratch engine install / verified-reuse audit receipt (R31)
│   ├── 02-accepted-main.txt                     # Accepted main migration ledger verification
│   ├── 03-subject-pack-inventory.txt            # Subject pack inventory check (fails on added)
│   ├── 04-frozen-submitted-paths.txt            # Frozen submitted paths & prior packs published SHA256SUMS
│   ├── 05-suite-proof.txt                       # 55-test proof suite execution receipt
│   ├── 06-suite-lifecycle.txt                   # 10-test database lifecycle execution receipt
│   ├── 07-suite-sensitivity.txt                 # 16-mutant sensitivity test receipt
│   ├── 07b-executed-mutants.json                # Machine-readable executed mutants record (R32)
│   ├── 08-issue-map-traceability.txt            # Issue-to-test map traceability receipt
│   ├── 08b-report-readme-traceability.txt       # Report & README traceability validation receipt (R32)
│   ├── 09-parser-legacy.txt                     # Legacy entrypoint 5-fixture execution receipt
│   ├── 10-parser-modern-historical.txt          # Modern entrypoint probe receipt
│   ├── 11-historical-reproductions.txt          # Historical reproductions from frozen rereview pack
│   ├── 12-hygiene.txt                           # Whitespace, staged, and tracked state hygiene receipt
│   ├── 13-manifest.txt                          # Generated manifest receipt describing two-stage manifest
│   ├── 14-manifest-tamper-selftest.txt          # Manifest tamper self-test verification receipt (R31)
│   ├── 15-run-summary.json                      # Machine-readable execution summary (measured counts & exit)
│   └── 16-manifest-verification.txt             # Authoritative in-run payload manifest verification receipt (R31)
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

---

## Verification & Execution Commands

### Prerequisites
1. Install or verify the pinned scratch parser engine:
```bash
# Optional fresh install:
npm ci --prefix docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/scratch/pdfjs-engine --no-audit --no-fund --ignore-scripts
```
2. Run each engine lane **sequentially**, never concurrently.

### Lane 1: Project Lane (Node 22.23.3)
```bash
# 1. Run the unified integration runner (executes all steps):
PATH=/opt/homebrew/opt/node@22/bin:$PATH node docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/scripts/run_integration_proof.mjs

# 2. Verify evidence pack checksums independently:
shasum -a 256 -c docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/SHA256SUMS

# 3. Individual suite runs:
PATH=/opt/homebrew/opt/node@22/bin:$PATH node --test docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/proof/proof.test.mjs
PATH=/opt/homebrew/opt/node@22/bin:$PATH node --test docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/proof/databaseLifecycle.test.mjs
PATH=/opt/homebrew/opt/node@22/bin:$PATH node --test docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/proof/sensitivityMutants.test.mjs
```

### Lane 2: Second Lane (Node 26.10.0)
```bash
# 1. Run the unified integration runner (executes all steps):
/opt/homebrew/bin/node docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/scripts/run_integration_proof.mjs

# 2. Verify evidence pack checksums independently:
shasum -a 256 -c docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/SHA256SUMS

# 3. Individual suite runs:
/opt/homebrew/bin/node --test docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/proof/proof.test.mjs
/opt/homebrew/bin/node --test docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/proof/databaseLifecycle.test.mjs
/opt/homebrew/bin/node --test docs/evidence/m4-document-navigation-integration-corrections-r2-2026-10-11/proof/sensitivityMutants.test.mjs
```
