# M2 split lineage scope: acceptance (8 October 2026)

**Decision: the scope and proof are accepted for planning.** SL-R1–SL-R13 are closed. This accepts the design, candidate DDL and executable proof only.

**Production stays inactive** until the owner records SL-D1–D8. Not authorized yet:
- migration 0013 registration or a schema bump
- application source changes
- packaging, signing or release

## What was reviewed

- **Checkout:** `/Users/rickymac/code/Flight-training-split-lineage-scope`, branch `codex/m2-split-lineage-scope`, HEAD `11fb3ad`, uncommitted.
- **Index:** clean; `src/` and `src-tauri/` untouched.
- **origin/main:** `2a6a415`.
- **How it was run:** every run used an isolated copy, with the reviewer's own resolve-only redirect (`evidence/reviewer-adapter/`). The submitted checkout wasn't edited.

## Independent results (Node 22.23.3)

| Check | Result | Receipt |
| --- | --- | --- |
| Round-5 proof | 18 pass, exit 0 | `proof.txt` |
| Round-4 reviewer diagnostic, verbatim | **8/8 pass**, exit 0 (baseline 4/4) | `review4.txt` |
| Frozen round 1 | 7 pass, exit 0 | `frozen1.txt` |
| Frozen round 2 | 4 pass / 2 retired (the receipt-less controls), exit 1 as expected | `frozen2.txt` |
| Round-2 reviewer diagnostic | 8 pass / 3 retired (controls 1–2, case 11), as expected | `review2.txt` |
| Round-3 reviewer diagnostic | 10 pass / 2 retired: case 11 reads round-3's DDL path, case 12 uses the old `cancelBatch` signature. Case 11's intent was verified directly against the round-5 DDL. | `review3.txt` |
| Mutations, run from a third working directory | 14/14 killed by named assertions, exit 0, honest summary; the submitted pack unchanged afterwards | `mutations.txt`, `mutations-rerun/` |
| Evidence packs | All eight verify: 9, 20, 18, 19, 22, 38, 49 and 84 | — |

**Every retirement** is exactly the set the review predicted, and each is mapped to permanent proof coverage. **The adapter** is resolve-only.

**Probes** (`receipts/` and the review transcript):
- An identical pending receipt is reused, not duplicated.
- A committed operation survives deletion of its source, with `source_material_id` set to NULL, and still reconciles.
- The child part is kept.
- The old three-argument `cancelBatch` is refused.

## What the accepted contract guarantees

- **Provenance:**
  - a split saves only through a receipt issued from the stored source file and recorded in `split_operation_log`
  - edited receipts, missing files, replaced files and drifted nested snapshots are all refused
  - nothing reaches the database before the checks
- **Coordinates and tiers:**
  - two-tier coordinates (A20–40 of A = R101–300 ⇒ R120–140)
  - structural direct/nested tiers, enforced by DDL CHECKs
  - separate parent and root verdicts, and unknown never certified
  - siblings grouped only by known effective identity
- **Operations:**
  - replay is idempotent and reconciliation works by operation ID
  - cancellation is real and owner-scoped
  - cleanup runs exactly once
  - re-issuing never changes committed or cancelled operations
- **Lifecycle:** proven from the exact shipped 0001–0012 schema through the candidate 0013, a receipt save, in-place replacement, parent deletion and export/reopen, with full history-row comparison.

## Fix during integration (not blocking)

1. **A lost history line.** Restore the original **"8 October split-lineage scope review — corrections required"** (SL-R1–R3) entry to `STATUS.md` and `docs/PROJECT_HANDOFF.md`. It was dropped from both while origin/main's text was carried forward. Every other origin line is preserved.
2. **A mislabelled mutant.** The round-5 report lists MUTANT-12 as targeting `proof.test.mjs`; it targets `lineageContract.mjs` (the test helper). The receipts are correct.

## Before production

- **Owner decisions:** SL-D1–D8, summarised in plain language in `OWNER_DECISIONS.md`.
- **Assignment:** the conditional production assignment in scope §8 becomes active only after those decisions are recorded.
- **Schema:** adopting SL-D6 moves the app to schema 13. A Mac release that includes split lineage then needs the usual migration, upgrade-from-populated-12 and restore gates.
- **Planning a Mac release:** releasing the already-accepted work first, with split lineage in a following version, keeps that release on schema 12.
