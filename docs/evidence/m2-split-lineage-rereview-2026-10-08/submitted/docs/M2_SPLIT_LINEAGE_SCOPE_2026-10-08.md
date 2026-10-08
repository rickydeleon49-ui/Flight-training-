# M2 Split-Source Lineage — Concrete Contract, Owner Defaults, and Scope Proposal (8 October 2026)

> [!IMPORTANT]
> **PLANNING SCOPE & EXECUTABLE PROOF CORRECTED (ROUND 1) — PRODUCT DEFAULTS PENDING OWNER APPROVAL.**
> This document specifies the concrete domain contract, current-code audit, schema design, user experience, and verified executable proof for Milestone 2, Split-Source Lineage.
> Findings **SL-R1 through SL-R3** from the independent review have been addressed in this correction round.
> All recommended defaults (**SL-D1 through SL-D8**) remain **PROPOSED** pending independent review and recorded owner choices.
> This task prepares the next implementation; it does not authorize production migrations, schema modifications, or feature activation.
>
> **Status:** SL-R1–SL-R3 corrected, pending independent scope re-review; owner defaults not approved.

---

## Executive Summary & Problem Framing

In Her Flight Deck, pilots frequently import large FAA handbooks (such as the *Airplane Flying Handbook* or *Instrument Flying Handbook*) that exceed Google Gemini's processing limit (50 MB or 1,000 pages). To make these materials studyable, the application provides automatic splitting (consecutive study-sized parts) and manual splitting ("Take out a chapter").

While the accepted native PDF splitter operates robustly on the local machine without modifying the source PDF:
- Generated split parts currently exist as isolated `study_materials` records.
- The parent material's identity, source PDF file path, and exact 1-based page range are known in memory during splitting, but are **discarded** from structured persistence.
- The only trace of provenance today is an unindexed, human-readable text string formatted into the `notes` field (e.g., `"Pages 1–100 of Airplane Flying Handbook."`).
- A pilot viewing a chapter part in `MaterialDetail` cannot navigate back to the original handbook or switch between companion chapters without manual searching.
- If a parent handbook is deleted or replaced, there is no structured record of what handbook or edition a chapter originated from.

This scope proposal defines the **smallest durable relationship** that establishes structured parent/child split lineage, defines exact page-translation arithmetic for direct and nested splits, separates root and immediate parent identities, enforces physical bounds and type constraints at both database and model boundaries, preserves historical study history and PDF bytes, provides clean fallback for desktop PDF viewers, and maintains full compatibility with existing databases and backups.

---

## 1. Current Code Trace & Persistence Gap Map

The following table traces the split and material lifecycle across the codebase, identifying exactly where original-source identity and page ranges are known versus what is persisted:

| Area | File & Symbol | Line References | Known in Memory at Execution | Persisted State Today | Gap / Limitation |
| --- | --- | --- | --- | --- | --- |
| **Native Automatic Splitter** | `src-tauri/src/pdf.rs`<br>`split_pdf_automatically` | `pdf.rs:402-479` | Source file path, total pages, each part's `first_page` and `last_page` (1-based), `file_size`, part name. | Only files on disk in `documents/`. No database writes in Rust. | Returns `Vec<PdfPart>` with `first_page` and `last_page`, but caller only stores them in text notes. |
| **Native Manual Splitter** | `src-tauri/src/pdf.rs`<br>`split_pdf` | `pdf.rs:339-374` | Source path, material ID, `first_page`, `last_page`, destination path. | Only split PDF file written to `documents/`. | Returns `ImportedDocument` which **omits** `first_page` and `last_page` entirely. |
| **Native Split Bounds & Limits** | `src-tauri/src/pdf.rs`<br>`MAX_PAGES`, `MAX_PDF_BYTES` | `pdf.rs:40-41, 89-102, 385-395` | `MAX_PAGES = 1_000`, `MAX_PDF_BYTES = 50 * 1024 * 1024` (50 MiB). | N/A (runtime bounds). | Accepted bounds preserved without alteration. |
| **Frontend Auto Split Dialog** | `src/pages/StudyLibrary/SplitPdfDialog.tsx`<br>`save` | `SplitPdfDialog.tsx:58-79` | `material.id` (parent), `material.title`, `document.firstPage`, `document.lastPage`. | Invokes `repos.documents.createMany(inputs)`. Passes `notes: pdfPartNotes(material.title, document)`. | Discards parent ID and numeric range; only writes formatted string to `notes`. |
| **Frontend Manual Split Dialog** | `src/pages/StudyLibrary/ManualSplitDialog.tsx`<br>`save` | `ManualSplitDialog.tsx:85-108` | `material.id` (parent), `material.title`, `first` and `last` from user input. | Invokes `repos.documents.createMany([input])`. Passes `notes: pdfPartNotes(...)`. | Discards parent ID and numeric range; only writes formatted string to `notes`. |
| **Notes Formatting Helper** | `src/logic/pdfParts.ts`<br>`pdfPartNotes` | `pdfParts.ts:10-12` | `sourceTitle`, `range.firstPage`, `range.lastPage`. | String: `"Pages ${range.firstPage}–${range.lastPage} of ${sourceTitle}."` | Free-form text cannot be reliably queried, sorted, or joined. |
| **Domain Types** | `src/domain/types.ts`<br>`interface StudyMaterial` | `types.ts:218-236` | Standard fields (`id`, `title`, `filePath`, `fileSize`, etc.). | Zero lineage fields on `StudyMaterial`. | No `parentMaterialId`, `sourcePageStart`, or `sourcePageEnd` properties. |
| **Repository Batch Creation** | `src/data/repositories/documentRepository.ts`<br>`createMany` | `documentRepository.ts:333-356` | List of `NewMaterial` objects. | Calls `db.saveMaterialsAtomically(materials)`. | Passes only standard `StudyMaterial` properties. |
| **Native Atomic Batch Save** | `src-tauri/src/documents.rs`<br>`save_split_materials_at` | `documents.rs:1351-1420` | `SplitMaterial` list, file metadata checks, SQLite transaction. | `INSERT INTO study_materials (id, title, ...)` + `material_tags`. | Schema lacks lineage columns; no relation established in database. |
| **Browser/Test Batch Save** | `src/data/materialTransaction.ts`<br>`executeMaterialsBatch` | `materialTransaction.ts:348-384` | `StudyMaterial[]`. | `INSERT INTO study_materials (...)` + `material_tags`. | Mirrors native batch; lacks lineage columns. |
| **Material Detail View** | `src/pages/StudyLibrary/MaterialDetail.tsx`<br>File Card | `MaterialDetail.tsx:653-708` | `material.filePath`, `originalFileName`, `fileSize`. | Renders file row, "Open", "Reveal", "Split", "Delete". | Does not show parent handbook, original pages, or sibling navigation. |
| **System Document Launch** | `src/services/documents.ts`<br>`openDocument`, `revealDocument` | `documents.ts:90-101` | System file path passed to `@tauri-apps/plugin-opener`. | Launches OS default viewer via `openPath` or Finder via `revealItemInDir`. | Cannot jump to a specific page number in arbitrary external viewers. |
| **Backup Export & Validation** | `src-tauri/src/backup.rs`<br>`archive_database` | `backup.rs:2806-2850` | Validates `study_materials` table and `file_path` column. | Verifies all referenced document files exist on disk before archiving. | Works on document paths; database tables are backed up intact. |
| **Backup Restore & Version Gate** | `src-tauri/src/backup.rs`<br>`restore_database` | `backup.rs:631-638` | `newest_migration` from restored database vs `CURRENT_SCHEMA_VERSION`. | If `newest_migration > CURRENT_SCHEMA_VERSION`, refuses restore cleanly. | Older binaries cleanly refuse newer schema versions without corrupting data. |

---

## 2. Recommended Owner Defaults (SL-D1 – SL-D8)

The following decision table defines the proposed product defaults for split-source lineage. All defaults remain **PROPOSED** pending owner approval:

| ID | Decision Area | Recommended Default | Alternative Considered | Impact / Rationale | Status |
| --- | --- | --- | --- | --- | :---: |
| **SL-D1** | **Source Identity & Content Hashing** | **Asynchronous SHA-256 at split time in native worker, outside UI render loop.** Rust computes SHA-256 of the exact parent PDF bytes during split and returns it in `PdfPart`. Live verification uses cached or background file hashing outside render; equality is unknown if unhashed. | 1. No content hash (relational ID only).<br>2. On-demand synchronous hashing in frontend render loop. | Cryptographically binds lineage to the exact source bytes split without blocking UI threads. Avoids synchronous hashing during view rendering. | **Proposed** |
| **SL-D2** | **Relationship Storage Architecture** | **Dedicated `material_split_lineage` table** (Candidate Migration 0013) with `CHECK (TYPEOF(...) = 'integer')`, foreign keys (`ON DELETE CASCADE` for child, `ON DELETE SET NULL` for parent/root), and cycle prevention (`material_id != parent_material_id` AND `material_id != root_material_id`). | Additive nullable columns on `study_materials`. | Keeps `study_materials` lean for non-split materials. Strict SQLite engine-level constraint enforcement prevents corrupted or fractional bounds. | **Proposed** |
| **SL-D3** | **Two-Tier Source Coordinates & Navigation** | **Persist both root-source range and immediate-parent range.** For nested splits, child records original root coordinates $[S_R, E_R]$ and immediate parent coordinates $[S_A, E_A]$. Child page count is $E_R - S_R + 1 = E_A - S_A + 1$. Opening parent part uses parent coordinates; opening root handbook uses root coordinates. | 1. Recording only root coordinates (losing parent navigation).<br>2. Recording only parent coordinates (requiring recursive SQL queries). | Disambiguates navigation targets immediately: pilot opening Part A jumps to page $S_A$; opening Root R jumps to page $S_R$. Child length reflects the part itself. | **Proposed** |
| **SL-D4** | **Legacy Rows with Unknown Lineage** | **Truthful absence (NULL lineage).** Existing pre-migration split parts return `lineage: null`. Never infer lineage from filenames or title strings (e.g. `" — Part 1 of 5"`). | Heuristic regex parsing of existing titles/notes to invent synthetic lineage rows. | ROADMAP §7 and engineering guidelines strictly forbid inventing provenance or guessing relationships from strings. Avoids erroneous relationships. | **Proposed** |
| **SL-D5** | **Parent Deletion & Replacement Retention** | **Preserve children; retain immutable snapshot metadata.** Foreign keys use `ON DELETE SET NULL`. If parent material is deleted, child survives completely intact. Child's lineage row retains `source_title`, `source_file_name`, `source_content_sha256`, `parent_title`, `parent_file_name`, and ranges. | 1. Cascade-deleting children when parent is deleted.<br>2. Cascade-deleting lineage row (losing all history). | A child part has its own notes, flashcards, practice tests, and review history. Silently deleting children would cause catastrophic user data loss. | **Proposed** |
| **SL-D6** | **Schema Migration & Restore Compatibility** | **Allocate Migration 0013; increment `CURRENT_SCHEMA_VERSION = 13` in `src-tauri/src/lib.rs`.** Restores into older binaries are cleanly refused per `backup.rs:631`. | Staying on Schema 12 and storing lineage as unvalidated JSON inside an existing column. | Clean relational schema with engine-level integrity. Older binaries cleanly refuse newer backups with a clear user prompt, preventing corrupt state. | **Proposed** |
| **SL-D7** | **MaterialDetail UI & Version Verdict** | **Display source title, validated range, parent link, edition-correct sibling selector, and copy-page fallback.** Surface read-only version verdict (`matching`, `changed`, `missing`, `deleted`, `unknown`). Restrict sibling parts to matching parent edition hash. | Integrating an embedded web PDF viewer (PDF.js) into Tauri. | Embedded viewer adds multi-megabyte bundle weight, CSP complications, and memory bloat. Native viewer + explicit page guidance is simple, fast, and reliable. | **Proposed** |
| **SL-D8** | **Scope Boundaries & Exclusions** | **Strict scope boundaries:** Embedded PDF viewers, PDF annotation/highlighting, OCR/text extraction, and full-library text indexing are explicitly **OUT OF SCOPE** for M2. | Expanding M2 to include PDF viewer enhancements. | Maintains milestone focus; protects offline performance and memory budgets. | **Proposed** |

---

## 3. Concrete Range Mapping & Arithmetic Specifications (SL-R1, SL-R2)

### Physical PDF Page Positions vs Printed Page Labels

1. **Physical PDF Page Positions (Contractual Standard):**
   - The contract strictly specifies **1-based, inclusive physical integer page positions** ($1 \le \text{start} \le \text{end} \le \text{total}$).
   - Lopdf, Tauri commands, and AI document ingestion index pages strictly by their 1-based sequential position in the PDF file container.
   - All range validation, database storage, and mapping arithmetic operate exclusively on physical positions.
   - Fractional numbers (e.g. `101.5`), non-finite values (`NaN`, `Infinity`), negative numbers, and numbers exceeding safe integer bounds are strictly rejected at the helper boundary and database engine level.
2. **Printed Page Labels (Display Guidance Only):**
   - Aviation handbooks frequently use Roman numerals (i, ii, iii) for front matter and section-based numbering (e.g., "1-1", "A-1") for chapters.
   - Printed labels may be non-consecutive, missing, or duplicated across document sections.
   - Printed labels are non-contractual advisory strings and must **never** be used for split slice boundaries or arithmetic mapping.

### Two-Tier Identity & Coordinate Separation (SL-R1)

When a document undergoes splitting, two distinct document roles must be preserved:
1. **Original Root Document ($R$):** The primary handbook or imported file at the base of the split tree (e.g. *FAA Airplane Flying Handbook*, 400 pages).
2. **Immediate Parent Part ($A$):** The material directly divided to create the child (e.g. *AFH — Chapter 3*, covering pages 101–300 of $R$, 200 pages total).

Every field in the lineage contract unambiguously represents one of these tiers:
- `source_page_start`, `source_page_end`: 1-based inclusive range relative to **Root $R$**.
- `source_file_name`, `source_title`, `source_content_sha256`, `source_total_pages`: Snapshot metadata of **Root $R$**.
- `parent_page_start`, `parent_page_end`: 1-based inclusive range relative to **Parent $A$** (NULL for direct 1-level splits).
- `parent_file_name`, `parent_title`, `parent_content_sha256`, `parent_total_pages`: Snapshot metadata of **Parent $A$** (NULL for direct 1-level splits).
- `child_page_count`: Length of **THIS child part** ($E_R - S_R + 1$).

### Concrete Two-Tier Persisted Example

Consider the canonical multi-level split hierarchy:
- **Root $R$:** 400 total pages.
- **Part $A$:** Covers $R$ pages 101–300 (length = 200 pages).
- **Child $B$:** Cut from $A$, selecting $A$ pages 20–40 (length = 21 pages).

**Navigation & Coordinate Resolution:**
- $B$ in $A$ coordinates: $[S_A = 20, \; E_A = 40]$.
- $B$ in $R$ coordinates: $[S_R = 101 + 20 - 1 = 120, \; E_R = 101 + 40 - 1 = 140]$.
- **Opening $A$ in viewer at the start of $B$ requires page 20.**
- **Opening $R$ in viewer at the start of $B$ requires page 120.**
- **Child $B$ page length is 21**, NOT 400 (root total) and NOT 200 (parent total).
- Resolving child page $p$ within $B$ ($1 \le p \le 21$):
  - In parent $A$: $\text{targetPage}_A = S_A + p - 1 = 20 + p - 1$. (For $p = 1 \implies 20$; for $p = 21 \implies 40$).
  - In root $R$: $\text{targetPage}_R = S_R + p - 1 = 120 + p - 1$. (For $p = 1 \implies 120$; for $p = 21 \implies 140$).

### Upper-Bound & Safe Integer Enforcement (SL-R2)

`mapChildPageToSource(childPage, sourcePageStart, sourceEndOrChildLength)` enforces:
1. `childPage` must be an integer $\ge 1$.
2. `sourcePageStart` must be an integer $\ge 1$.
3. When recorded range end or child length is provided:
   $$\text{childLength} = \begin{cases} \text{arg} - \text{sourcePageStart} + 1 & \text{if } \text{arg} \ge \text{sourcePageStart} \\ \text{arg} & \text{if } \text{arg} < \text{sourcePageStart} \end{cases}$$
4. **Child positions beyond the child document length are refused:**
   If $\text{childPage} > \text{childLength}$, throws an error (e.g. child covering 101–300 has length 200; page 201 is rejected).
5. Output position $\text{sourcePageStart} + \text{childPage} - 1$ is verified to not exceed `Number.MAX_SAFE_INTEGER`.

### Source Version Verdict & Boundary Comparison (SL-R1)

Rather than superficial string comparison, `evaluateSourceVersion` compares source bytes against the recorded split-time hash outside the render loop and returns a read-only verdict:
- `"matching"`: Live PDF content hash matches the recorded split-time hash.
- `"changed"`: Live PDF content has been modified or replaced since the split was performed.
- `"missing"`: PDF file is absent from disk at its recorded path.
- `"deleted"`: Parent `study_materials` entity was deleted from the library (`parent_material_id IS NULL`).
- `"unknown"`: Legacy material or material imported without a cryptographic hash.

### Sibling Isolation Across Document Editions (SL-R1)

When a pilot imports an updated edition of a handbook (e.g. *Instrument Flying Handbook 2026* replacing *2024*):
- Sibling navigation lists parts sharing the same `parent_material_id` **AND** matching `parent_content_sha256`.
- Parts from Edition 2024 do not mix with parts from Edition 2026, preventing cross-edition pollution in the UI.

---

## 4. Storage & Transaction Contract (Candidate Migration 0013)

### Authoritative Candidate DDL (`candidate_migration_0013.sql`)

```sql
-- Candidate Migration 0013: Split-source lineage metadata
CREATE TABLE IF NOT EXISTS material_split_lineage (
  material_id            TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
  parent_material_id     TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
  root_material_id       TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
  source_page_start      INTEGER NOT NULL CHECK (TYPEOF(source_page_start) = 'integer' AND source_page_start >= 1),
  source_page_end        INTEGER NOT NULL CHECK (TYPEOF(source_page_end) = 'integer' AND source_page_end >= source_page_start),
  parent_page_start      INTEGER CHECK (parent_page_start IS NULL OR (TYPEOF(parent_page_start) = 'integer' AND parent_page_start >= 1)),
  parent_page_end        INTEGER CHECK (parent_page_end IS NULL OR (TYPEOF(parent_page_end) = 'integer' AND parent_page_end >= parent_page_start)),
  child_page_count       INTEGER NOT NULL CHECK (TYPEOF(child_page_count) = 'integer' AND child_page_count >= 1),
  source_file_name       TEXT NOT NULL,
  source_title           TEXT NOT NULL,
  source_content_sha256  TEXT,
  source_total_pages     INTEGER CHECK (source_total_pages IS NULL OR (TYPEOF(source_total_pages) = 'integer' AND source_total_pages >= source_page_end)),
  parent_file_name       TEXT,
  parent_title           TEXT,
  parent_content_sha256  TEXT,
  parent_total_pages     INTEGER CHECK (parent_total_pages IS NULL OR (TYPEOF(parent_total_pages) = 'integer' AND (parent_page_end IS NULL OR parent_total_pages >= parent_page_end))),
  nested_level           INTEGER NOT NULL DEFAULT 1 CHECK (TYPEOF(nested_level) = 'integer' AND nested_level >= 1),
  created_at             TEXT NOT NULL,
  CHECK (material_id != parent_material_id),
  CHECK (material_id != root_material_id),
  CHECK (child_page_count = (source_page_end - source_page_start + 1)),
  CHECK (parent_page_start IS NULL OR child_page_count = (parent_page_end - parent_page_start + 1)),
  CHECK ((parent_page_start IS NULL AND parent_page_end IS NULL) OR (parent_page_start IS NOT NULL AND parent_page_end IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_split_lineage_parent ON material_split_lineage(parent_material_id);
CREATE INDEX IF NOT EXISTS idx_split_lineage_root ON material_split_lineage(root_material_id);
```

### Relational & Engine-Level Invariants (SL-R2)

1. **Child Identity Mandatory (`NOT NULL`):** `material_id TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE` rejects NULL child IDs.
2. **Physical Page Integer Storage:** SQLite `CHECK (TYPEOF(...) = 'integer')` prevents loose type affinity from admitting fractional page numbers (e.g. `101.5`).
3. **Child Length Matching:** `CHECK (child_page_count = (source_page_end - source_page_start + 1))` guarantees that child page length matches the root slice window.
4. **Self-Parent & Self-Root Refusal:** `CHECK (material_id != parent_material_id)` and `CHECK (material_id != root_material_id)` prevent immediate cycle formation.
5. **Parent Deletion Preservation (`ON DELETE SET NULL`):** Deleting a parent or root material sets `parent_material_id` and `root_material_id` to `NULL`. The child material survives intact, and all snapshot metadata (titles, file names, hashes, page ranges) remain permanently preserved.
6. **Atomic Split Batch Save & Rollback:**
   - Pre-validates all part ranges and confirms the source parent exists and matches expected content hash.
   - Pinned transaction writes `study_materials`, `material_tags`, and `material_split_lineage`.
   - If any insert fails, `ROLLBACK` executes and staging cleanup callback is invoked to delete temporary files on disk. Zero orphan materials or partial lineage rows are permitted.
   - **Acknowledged Save Followed by Failed UI Refresh:** If the SQLite transaction commits successfully but the subsequent UI/IPC refresh encounters an error, the database state remains permanently acknowledged and intact. Subsequent views read the persisted records without re-splitting.

---

## 5. Minimal MaterialDetail UI Specification

### Layout & Information Architecture

Within `src/pages/StudyLibrary/MaterialDetail.tsx`, the file card renders lineage metadata when present:

```
+-----------------------------------------------------------------------------------+
|  [Document Icon]  airplane-flying-handbook-part-2.pdf                   (14.2 MB) |
|                                                                                   |
|  Source Lineage:                                                                  |
|  From: Airplane Flying Handbook (FAA-H-8083-3C) [Source Verified ✓]               |
|  Pages: 101–300 of 400 (200 pages total)                                          |
|                                                                                   |
|  [View Parent Handbook]    [Related Parts v]    [Open]    [Reveal in Finder]       |
+-----------------------------------------------------------------------------------+
```

### State-Specific UI Behaviors

1. **Active Parent Available & Matching:**
   - Displays parent title, verified badge, and page range.
   - `[View Parent Handbook]`: Navigates to `/study/:parentMaterialId`.
   - `[Related Parts (Dropdown)]`: Lists companion sibling parts sharing the same parent and matching edition hash.
2. **Parent Content Modified or Replaced:**
   - Displays warning badge: `"Source document modified since split"`.
   - Navigation links remain accessible with an advisory note.
3. **Parent Material Deleted from Library:**
   - Displays: `"From: Airplane Flying Handbook (original material removed from library) — Pages 101–300"`.
   - Replaces link with muted badge: `"Parent material removed"`. Child notes, cards, and attempts remain completely functional.
4. **Parent File Missing from Disk:**
   - Displays standard missing file indicator.
5. **Desktop Page-Jump Limitation & Fallback:**
   - Desktop system viewers launched via `openPath` do not accept cross-platform page arguments.
   - UI discloses: `"System viewer opens page 1. In original handbook, this corresponds to page 101."`
   - Supplies `"Copy page 101"` button so the pilot can jump to the page in their viewer immediately.
6. **Legacy Material (No Lineage):**
   - Zero lineage UI displayed; standard file card rendered.

---

## 6. Executable Proof Summary & Verification Results (SL-R3)

The corrected contract model, authoritative DDL, and disposable SQLite schema were executed and verified in `docs/evidence/m2-split-lineage-scope-corrections-2026-10-08/proof/`:

### Requirements-to-Proof Mapping

| Contract / Requirement | Test Case in `proof.test.mjs` | Key Invariants Verified | Result |
| --- | --- | --- | :---: |
| **1-Based Inclusive Bounds** | `Contract 1: Page Range Validation` | Verifies `first >= 1`, `last >= first`, `last <= totalPages`. Rejects 0, negatives, reversed ranges, non-integers, unsafe floats. | **PASS** |
| **Child Bounds & Overflow** | `Contract 2: Page Translation Maps Child Position` | Refuses child page 201 for a 200-page child. Rejects non-integers, negative, non-finite (`NaN`, `Infinity`), and unsafe values. | **PASS** |
| **Nested Navigation Coordinates** | `Contract 3: Nested Range Composition & Navigation` | Persists Root $R=400$, Part $A=101..300$, Child $B=20..40$. Composed $R=120..140$. Opening $A$ uses page 20; opening $R$ uses page 120. Child length is 21. | **PASS** |
| **Multi-Level Nesting** | `Contract 4: Multi-Level Transitive Composition` | 3-level transitive composition: [201, 600] $\to$ [51, 150] $\to$ [11, 20] composes to [261, 270], length 10. | **PASS** |
| **SHA-256 Hashing** | `Contract 5: SHA-256 Content Hashing` | Deterministic 64-char lowercase hex digest computation. | **PASS** |
| **DDL Constraints** | `Contract 6: Candidate DDL Constraints` | Rejects NULL child ID (`NOT NULL`), rejects fractional pages (`101.5` via `TYPEOF = 'integer'`), enforces range order and totals. | **PASS** |
| **Cycle Prevention** | `Contract 7: Cycle Prevention Refuses Self-Parenting/Root` | Rejects `material_id == parent_material_id` and `material_id == root_material_id`. | **PASS** |
| **Source Version Verdict** | `Contract 8: Source Version Evaluation` | Evaluates live bytes against recorded hash: `matching`, `changed`, `missing`, `deleted`, `unknown`. | **PASS** |
| **Sibling Edition Isolation** | `Contract 9: Sibling Navigation Isolates Editions` | Queries siblings by parent ID and edition content hash. Edition 1 parts do not mix with Edition 2 parts. | **PASS** |
| **Parent Deletion Safety** | `Contract 10: Parent Deletion Preserves Child Material` | Parent deletion sets parent ID to NULL via `ON DELETE SET NULL`. Child material and lineage snapshot survive. | **PASS** |
| **Atomic Save & Rollback** | `Contract 11: Atomic Batch Save & Rollback` | Refuses stale parent when hash changed; rolls back transaction and cleans up staged files on failure. | **PASS** |
| **Save/Refresh Idempotency** | `Contract 12: Acknowledged Save Followed by Failed Refresh` | Verified that transient UI refresh failure does not compromise committed database state. | **PASS** |
| **Shipped Migrations Baseline** | `Contract 13: Shipped Migrations 0001–0012 Faithful Schema` | Executes actual shipped migrations 0001–0012. Populates actual `practice_attempts` and `card_review_state` tables. Zero invented tables. | **PASS** |
| **Export/Reopen & File Proof** | `Contract 14: Disposable Export/Reopen & File Preservation` | Applies candidate migration 0013 to populated schema 12 DB; performs split; deletes parent; verifies synthetic PDF on disk is unaltered; verifies DB export/reopen. | **PASS** |
| **Restore Simulation** | `Contract 15: Restore Simulation Boundaries` | Explicitly distinguishes numeric version check simulation (`backup.rs:631`) from native backup validator. | **PASS** |

### Execution Metrics & Sensitivity Results

- **Proof Test Suite (`proof.test.mjs`):** 15 tests passed / 0 failed, exit code **0** (125 ms).
- **Reviewer Diagnostic (`lineage-review.test.mjs`):**
  - Baseline execution against previous pack: 2 passed / 5 failed, exit code **1**.
  - Final execution against corrected contract: 7 passed / 0 failed, exit code **0**.
  - Verified both directly and via loader forwarding adapter without modifying frozen reviewer files.
- **Genuine Mutation Checks (`mutationChecks.mjs`):**
  - Mutant 1 (Arithmetic off-by-one in `composeNestedRanges`): caught with Contract 3 failure, exit 1.
  - Mutant 2 (Removal of upper bound in `mapChildPageToSource`): caught with Contract 2 failure, exit 1.
  - Mutant 3 (Removal of `TYPEOF` integer checks in candidate DDL): caught with Contract 6 failure, exit 1.
  - Mutant 4 (Removal of self-root check in candidate DDL): caught with Contract 7 failure, exit 1.
  - All 4 mutants caught; baseline files restored to exact initial SHA-256 hashes.

---

## 7. Implementation Acceptance Criteria

When production implementation is authorized by the repository owner following approval of defaults **SL-D1 through SL-D8**, the implementation must satisfy:

1. **Schema & Migration:**
   - Add Migration `0013_split_source_lineage.sql` matching the authoritative candidate DDL.
   - Update `CURRENT_SCHEMA_VERSION = 13` in `src-tauri/src/lib.rs`.
   - Register migration in `src-tauri/src/lib.rs` and frontend migration list.
2. **Native Splitter Commands:**
   - Update `split_pdf` and `split_pdf_automatically` in `src-tauri/src/pdf.rs` to compute parent SHA-256 and return structured range and hash metadata.
   - Preserve existing 50 MiB and 1,000-page bounds.
3. **Repository & Transaction Updates:**
   - Update `save_split_materials_at` (`documents.rs`) and `executeMaterialsBatch` (`materialTransaction.ts`) to insert into `material_split_lineage` in the same immediate transaction.
   - Update `documentRepository.ts` to query lineage via `LEFT JOIN` and populate domain `lineage` field.
4. **UI Integration:**
   - Update `MaterialDetail.tsx` to render source title, original range, parent navigation link, sibling selector, and copy-page fallback.
   - Handle deleted-parent and changed-source states honestly.
5. **Test Matrix:**
   - Unit tests covering range arithmetic and nested composition.
   - Repository tests verifying atomic persistence across native and browser drivers.
   - Component tests verifying parent and sibling navigation in `MaterialDetail`.
   - Restore tests verifying Schema 13 backups restore cleanly and older binaries refuse safely.

---

## 8. Conditional Production Implementation Prompt

*The following prompt is prepared for the implementer and becomes active only upon scope acceptance and recorded owner choices for defaults SL-D1 through SL-D8:*

```markdown
# M2 Split-Source Lineage — Production Implementation Assignment

Implement Milestone 2 split-source lineage in accordance with the accepted corrected scope specification
(`docs/M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md`) and owner-approved defaults SL-D1 through SL-D8.

## Constraints & Requirements
1. Schema & Migration:
   - Add `src-tauri/migrations/0013_split_source_lineage.sql` from candidate DDL.
   - Bump `CURRENT_SCHEMA_VERSION = 13` in `src-tauri/src/lib.rs`.
   - Register Migration 0013 in `src-tauri/src/lib.rs` and frontend database drivers.
2. Native Layer:
   - In `src-tauri/src/pdf.rs`, compute parent SHA-256 in background worker during split.
   - In `src-tauri/src/documents.rs`, update `save_split_materials_at` to atomically insert into `material_split_lineage`.
3. Frontend Layer:
   - In `src/domain/types.ts`, add `SplitLineage` interface and update `StudyMaterial`.
   - In `src/data/materialTransaction.ts`, update `executeMaterialsBatch` and `executeMaterialSave` for lineage.
   - In `src/pages/StudyLibrary/SplitPdfDialog.tsx` and `ManualSplitDialog.tsx`, pass parent ID and range to repository.
   - In `src/pages/StudyLibrary/MaterialDetail.tsx`, render source lineage, parent link, sibling selector, and copy-page fallback.
4. Verification:
   - Add comprehensive tests covering arithmetic, atomic saves, parent deletion, and UI states.
   - Verify full local test suite passes with zero regressions.
   - Leave changes uncommitted and unpushed for independent review.
```
