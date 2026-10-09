# M2 split-source lineage: production implementation evidence (8 October 2026)

**State: implemented, pending independent source review.** The work is uncommitted and unpushed:
- Worktree: `/Users/rickymac/code/Flight-training-split-lineage-implementation`
- Branch: `codex/m2-split-lineage-implementation`
- Base and HEAD: `2a6a41536b676559db94b476c71dd645af03fbab` (origin/main, #124)
- Nothing staged

**Authority:**
- The owner approved SL-D1–D8 ("i approve SL-D1 through SL-D8"); see [OWNER_APPROVAL.md](OWNER_APPROVAL.md).
- The accepted scope and proof are `docs/M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md` and the round-5 pack. These live in the uncommitted scope checkout and the reviewer folders, and **are not yet on main**. This worktree was cut from main as instructed.

## How this round went

An earlier implementer started this assignment and ran out of usage. Their partial work was reviewed before anything was changed, and is preserved byte-for-byte in [`implementer-partial/`](implementer-partial/): the tracked diff, both new files and the status.

**What was kept:**
- migration 0013, byte-identical to the accepted round-5 candidate DDL
- its registration in Rust and TypeScript, and the checksum entry
- `CURRENT_SCHEMA_VERSION = 13`
- the receipt idea

**What was replaced, and why:**
1. **It did not compile.** It used `chrono`, which is not a dependency, and the existing `save_split_materials` tests no longer matched.
2. **It broke ordinary saves.** It repurposed `save_split_materials`, which every desktop `createMany` still calls with `{ materials }`. Every multi-part save would have been refused.
3. **The new save regressed what a part keeps.** It hard-coded type, priority and notes and dropped the goal, event and inherited tags.
4. **The hashed bytes were not the split bytes.** The source was read once for the hash and opened again for the split.
5. **The webview could name the source.** `source_material_id` was optional, with a lookup by file path, and nothing checked that the material owns the file.
6. **Absolute paths were accepted** for the source and the parts.
7. **Cancellation could race the save.** The `pending` status was checked only outside the transaction.
8. **A deleted original was misrecorded.** The root fell back to the immediate parent, and a missing root fingerprint fell back to the parent's own.
9. **The browser bundle would fail.** `src/logic/splitLineage.ts` imported `node:crypto`.

`documents.rs`, `pdf.rs`, `types.ts`, `db.ts` and `tauriDb.ts` were reset to base and the work redone. Nothing the implementer wrote is lost; see `implementer-partial/`.

## What was built

| Area | Files |
| --- | --- |
| Migration | `src-tauri/migrations/0013_split_source_lineage.sql` (new); `src/data/migrations.ts`, `src/data/migration-checksums.json`, `src-tauri/src/lib.rs` (schema 13, the migration, 4 new commands) |
| Native receipts and save | `src-tauri/src/lineage.rs` (new). See the first list below. |
| Native splitter | `src-tauri/src/pdf.rs`. See the second list below. |
| Restore validator | `verify_schema_13_lineage_semantics` in `backup.rs`, with its TypeScript twin `validateSplitLineageState` in `practiceStateValidation.ts`. They check the exact table shape, foreign keys, CHECKs and indexes against the shipped migrations, well-formed fingerprints, and that each split record's hash is the hash of its receipt. |
| Desktop adapter | `src/data/splitLineageShapes.ts` (new, strict shape checks), `tauriDb.ts` (invoke helpers), `db.ts` (optional driver methods) |
| Repository | `documentRepository.ts`. See the third list below. |
| Pure logic | `src/logic/splitLineage.ts` (new): structural tiers, verdicts, related parts, navigation targets and page arithmetic |
| Interface | `SplitLineageDetails.tsx` (new) on `MaterialDetail`; `splitSave.ts` (new) shared by both split dialogs, which now save through the receipt (`ManualSplitDialog.tsx`, `SplitPdfDialog.tsx`); `services/pdf.ts` |
| Other | `documents.rs` exposes `DOCUMENTS_DIR` and a root-based `stored_destination_in` |

**Native receipts and save (`lineage.rs`):**
- `issue_receipt` is bound to the material that owns the file. It is recorded `pending` with a plain conditional `INSERT`, so a re-issue never changes a committed or cancelled record. When the root is gone it keeps a NULL root id rather than using the parent.
- `save_split_batch_at` performs these checks, in order:
  - the hash is recomputed and matched against the recorded row
  - committed receipts replay, and cancelled ones are refused
  - the source file is re-hashed (outside the transaction)
  - part files must exist at the size recorded
  - inside `BEGIN IMMEDIATE`, it re-checks the record is still pending, the source row and file path, the nested snapshot, and output-id collisions

  It then inserts the parts (type, topic, priority, goal, event and tags copied from the source; title and notes from the interface) and the lineage, and marks the record committed under `WHERE status = 'pending'`.
- `cancel_split_batch_at` marks the record cancelled and removes only the plan's own files, and only when no material uses them.
- `reconcile_split_batch_at` reads a split back by operation id.
- `fingerprint_stored_documents_at` hashes at most 20 files, off thread, using safe paths only.

**Native splitter (`pdf.rs`):** `split_pdf` and `split_pdf_automatically` now read the source **once**, hash those bytes, and split the same in-memory document. They require `source_material_id` and return a receipt. Testable cores are `split_range_at` and `split_automatically_at`. `PdfPart` was removed, and the generic `save_split_materials` is **unchanged** (it is still used by `createMany`).

**Repository (`documentRepository.ts`):**
- `list()` attaches `lineage`.
- `saveSplitBatch` retries brief locks, like `createMany`.
- `cancelSplitBatch`, `reconcileSplitBatch` and `fingerprintDocuments` are added.
- Drivers that cannot split refuse with `SplitNeedsDesktopError`.

## Deliberate decisions (disclosed)

1. **Browser and test drivers do not write lineage.** Splitting reads and writes files, which browser mode already cannot do. The native command is therefore the only writer; the TypeScript drivers read lineage and refuse split saves clearly. Scope §7 mentions "native and browser drivers" for receipt verification. Native tests cover the writer, and the TS drivers are covered for reading, refusal and restore validation (three engines). `executeMaterialsBatch` is unchanged.
2. **A refused or failed save leaves the record `pending` and the files in place.** The interface then reads the split back by operation id. If it landed, it is kept; otherwise it is cancelled, which deletes exactly that split's files. This is the "at most once, only its own files" cleanup, and a split whose save answer was lost is never deleted by mistake.
3. **Display text is not provenance.** Titles and notes come from the interface, checked against the plan ids and bounded in length. Everything else comes from the receipt or the source row.
4. **Lineage loads alongside materials.** It is attached in `list()` rather than queried per page, so related parts come from data already in memory. Fingerprinting is the only native work, and it runs after render.
5. **A nested split checks its parent's page count.** It is refused when the parent's recorded page count disagrees with the engine's count of its PDF.
6. **Ceiling tests now follow the latest schema.** Three existing tests (two TS, one Rust) pinned "latest is 12" or "13 is newer". They now assert "the latest" and "one past the latest", the same edit migration 12 needed.

## Results (actual)

Toolchain: Node 22.23.3, npm 10.9.9, rustc/cargo 1.99.0, Xcode 27.0 with the MacOSX27.0 SDK, macOS arm64.

**Sequential gate** (`receipts/final/`, one run after the source settled):

| Step | Result |
| --- | --- |
| Focused Vitest (7 files) | 110 passed, exit 0 |
| Focused native (`lineage`, `split`, `newer_database`) | 41 passed, exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | 107 files (3 skipped); **2,862 passed / 5 skipped**, 0 failed, no unhandled errors, exit 0 |
| `npm run build` | exit 0 |
| `cargo test --locked --all-targets` | **444 passed / 6 ignored**, exit 0 |
| Clippy `-D warnings`, `cargo fmt --check`, `npm run test:cargo-lock` | exit 0 each. Clippy finished from cache, since the source had not changed since its last full run. |
| Whitespace hygiene (tracked diff + 22 new files) | 0 problems |
| Preservation | Migrations 0001–0012 byte-identical to base. The registry changes only by adding 0013 (checksum `4118a789…b106`). Schema version 13. All 104 evidence packs on base unchanged. Nothing staged. |

**New tests:**
- **Native: 24.** That is 21 in `lineage_tests.rs` (including the 15-case shared validator contract and the receipt-fixture parity test) and 3 end-to-end splitter tests in `pdf.rs`.
- **Frontend: 48:**
  - logic: 14
  - shapes: 5
  - storage: 3
  - validator parity: 17 (15 node cases, 1 sql.js run, 1 coverage)
  - UI: 9
- **Existing ceiling tests:** 3 updated.

**Sensitivity** (`run_sensitivity.py`, an isolated scratch copy, each file restored and SHA-checked, `receipts/sensitivity/`). Every reverted guard is caught by its named test:

| Variant | Caught by |
| --- | --- |
| S1: receipt hash check skipped | `an_edited_or_unrecorded_receipt_saves_nothing` |
| S2: nested snapshot re-check removed | `a_parent_whose_lineage_changed_after_the_split_is_refused` |
| S3: re-issue overwrites the record | `a_cancelled_split_stays_cancelled_and_cannot_be_saved` |
| S4: the tier decided by hash nullness | `a matching original never vouches for a parent whose fingerprint is unknown` |
| S5: receipt shape allows extra provenance | `refuses extra provenance…` |

**Flaky test noted, not touched:** the existing `documents::tests::save_split_materials_waits_for_transient_exclusive_lock_and_succeeds` failed once during development under heavy parallel load (a setup statement hit the lock it simulates). It passed 3/3 alone and in both full runs. The test and its function are unchanged.

## Limitations

- **Never run as the real app.** There was no installed app, signing or release work, and the desktop IPC path was never exercised end to end in a launched app. The commands are covered by Rust tests on real files and databases, and by adapter tests with injected `invoke`.
- **Not looked at on screen.** The lineage card was not checked visually in browser mode, which cannot create lineage; it is covered by jsdom component tests.
- **No startup cleanup.** A split abandoned by a crash before save or cancel leaves a `pending` record and its part files. The library check already reports such files as unlinked; there is no automatic sweep.
- **No PDF page targeting** (SL-D8): the Mac viewer opens a part at page 1, hence the copy-page button.

## Manifests

- `source-hashes.json`: every changed or new delivery file outside this directory, rooted at the repository (a `files` object).
- `SHA256SUMS`: every file in this directory except itself, rooted here.
- `generate_lineage_validation_cases.py` regenerates the shared validator fixture.
