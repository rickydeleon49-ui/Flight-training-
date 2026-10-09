# M2 split lineage scope: round-3 review (8 October 2026)

**Decision: changes requested, SL-R10–SL-R11.** This is planning and proof work only. SL-D1–D8 remain proposed.

Round 3 fixed most of what was asked. Tier classification is now structural, unknown parent tiers stay unknown, and siblings group only on known effective identity. Contract 14 was properly rebuilt, cleanup runs once, and the four new mutants target the new logic. One gap remains: the receipt exists but is not yet the *only* authority. A save can still go through without a receipt, with a missing source file, with an edited receipt, or with caller parts that replace the receipt's plan.

## What was reviewed

- **Checkout:** `/Users/rickymac/code/Flight-training-split-lineage-scope`, branch `codex/m2-split-lineage-scope`, HEAD `11fb3ad`, uncommitted.
- **Index:** clean; the 22 previously staged reviewer files are now correctly unstaged.
- **origin/main:** `2a6a415`.
- **How it was run:** every run used an isolated copy. The submitted checkout wasn't edited.

## Verified and retained

| Check | Result | Receipt |
| --- | --- | --- |
| Round-3 proof | 18 pass, exit 0 | `evidence/receipts/proof.txt` |
| Round-2 reviewer diagnostic via adapter | 11 pass, exit 0 | `review2-final.txt` |
| Frozen round 1 / round 2 via adapter | 7 / 6 pass, exit 0 | `frozen1.txt`, `frozen2.txt` |
| Mutations | 8/8 killed by named assertions | `mutations.txt` |
| **Round-3 reviewer diagnostic** | 5 controls pass / **7 fail**, exit 1, all assertion failures | `review.txt` |

**Packs:**
- All six packs verify: 9, 20, 18, 19, 22 and 38 entries.
- The diagnostic copy is verbatim.
- The adapter is import-only.
- The baseline receipt shows 3 pass / 8 fail, but its exit file was written by hand (`echo "1"`), not captured.

**These stand and should not be redone:**
- the structural tiers and the DDL tier CHECK
- the two-tier verdicts read from real files
- effective-identity siblings
- receipt creation from the stored file
- the disk-versus-receipt stale check
- in-transaction existence and path checks
- cleanup exactly once
- receipt-derived operation-ID replay
- the rebuilt Contract 14: seeded before migration, receipt save, distinct files, in-place replacement giving `changed`, deletion, and an export/reopen with full-row comparisons
- the eight named mutants

## SL-R10 (P1): the receipt is optional and not authoritative

All references are to `validateAndSaveSplitBatch` in `proof/lineageContract.mjs`, lines 598–905.

1. **The receipt-less path survives.** `expectedParentSha256` plus `currentParentBytes` still saves. When the source has no file, the caller Buffer is accepted as verification (lines 663–669). Direct saves without a receipt use `parts[0].sourceTotalPages`, or an invented **1,000-page fallback** (lines 683–691). Contracts 12 and 18 rely on this path, including a caller-chosen operation ID.
2. **Missing files are bypassed.** When the recorded file is missing, `createSplitSourceReceipt` falls back to caller `sourceBytes` and the save then trusts `receipt.sourceContentSha256` (lines 333–341 and 670–671). A missing source should be refused as `missing`.
3. **Receipts are plain objects.** Any caller can edit one. An edited `sourceTotalPages`/plan saves pages 1–5000 of a 400-page source. Caller `parts` also override `receipt.plan` (line 615).
4. **The nested snapshot is never compared with the receipt.** The "pinned" check compares two reads made inside the same save call, so it can't detect anything. A parent whose lineage changed between split and save is silently saved with new coordinates. The receipt's `parentRootPageStart` and related fields are never compared.

Diagnostic cases 6–10 fail.

**Note on my previous diagnostic.** `lineage-round2-review.test.mjs` controls 1–2 (and the setup of its cleanup case) used file-less sources with caller bytes. That encouraged keeping the caller-bytes path. **That diagnostic is now superseded.** Once the receipt is mandatory, its controls 1–2 and case 11 are expected to fail, and they may be retired with a disclosed note. Its other cases, and its intent (now with a receipt), are carried by the new diagnostic.

## SL-R11 (P2): idempotency, cancellation and evidence integrity

1. **The operation log isn't in the candidate DDL.** `split_operation_log` is created by the test helper `createDisposableLineageDb`, even for the "shipped 0001–0012" baseline. So the baseline is no longer faithful, and production 0013 would lack the table that idempotency depends on. It needs a complete schema (FKs, status values, timestamps) in the candidate DDL. Scope §3 and §8 must describe it.
2. **`cancelBatch` is a stub.** It reports `removedFiles` but deletes nothing and doesn't touch the database. Contract 18 asserts only the returned flags, with fake file names.
3. **Conflicting resubmission depends on caller IDs.** Detection is reachable only with a caller-supplied operation ID. With receipt-derived IDs, a different plan gets a different ID and fails later on a primary-key conflict instead.
4. **The mutation driver rewrites the pack.** It writes `receipts/mutations/*.txt` into the submitted pack. Rerunning it, as any verification does, changes 9 files and breaks the pack's `SHA256SUMS`. Receipts must go to a caller-chosen output directory, never into a sealed pack on rerun.
5. **A hand-written exit file.** The baseline exit was typed, not captured. Every exit file must come from `$?`.

## Reviewer diagnostic

`evidence/diagnostics/lineage-round3-review.test.mjs` contains 12 cases:
- 5 controls, all passing now: a receipt direct save, a receipt nested save (R120–140), the file replaced before save, receipt replay, and cleanup once with a receipt
- 7 reproductions, all failing now

Every source uses a real file. It imports `../../m2-split-lineage-scope-round3-2026-10-08/proof/lineageContract.mjs` and reads that pack's `candidate_migration_0013.sql`. Run it verbatim, or through a disclosed import-only adapter.

## Next action

[Round-4 prompt](M2_SPLIT_LINEAGE_SCOPE_ROUND4_PROMPT_2026-10-08.md).

Not authorized:
- production code, migrations or a schema bump
- provider or account tests
- packaging, signing or release
