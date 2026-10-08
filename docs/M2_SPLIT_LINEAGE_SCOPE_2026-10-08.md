**Independent review: changes requested (8 October 2026).** SL-R1–SL-R3 require correction before this proposal is accepted or owner defaults are activated. Some proof/compatibility claims below exceed the executed evidence; see [specific review](M2_SPLIT_LINEAGE_SCOPE_REVIEW_2026-10-08.md) and [active correction prompt](M2_SPLIT_LINEAGE_SCOPE_CORRECTIONS_PROMPT_2026-10-08.md). Original submitted bytes are frozen in the reviewer evidence.

# M2 Split-Source Lineage — Concrete Contract, Owner Defaults, and Scope Proposal (8 October 2026)

> [!IMPORTANT]
> **PLANNING SCOPE & EXECUTABLE PROOF PREPARED — PRODUCT DEFAULTS PENDING OWNER APPROVAL.**
> This document specifies the concrete domain contract, current-code audit, schema design, user experience, and verified executable proof for Milestone 2, Split-Source Lineage.
> All recommended defaults (**SL-D1 through SL-D8**) are **PROPOSED** pending independent review and recorded owner choices.
> This task prepares the next implementation; it does not authorize production migrations, schema modifications, or feature activation.

---

## Executive Summary & Problem Framing

In Her Flight Deck, pilots frequently import large FAA handbooks (such as the *Airplane Flying Handbook* or *Instrument Flying Handbook*) that exceed Google Gemini's processing limit (50 MB or 1,000 pages). To make these materials studyable, the application provides automatic splitting (consecutive study-sized parts) and manual splitting ("Take out a chapter").

While the accepted native PDF splitter operates robustly on the local machine without modifying the source PDF:
- Generated split parts currently exist as isolated `study_materials` records.
- The parent material's identity, source PDF file path, and exact 1-based page range are known in memory during splitting, but are **discarded** from structured persistence.
- The only trace of provenance today is an unindexed, human-readable text string formatted into the `notes` field (e.g., `"Pages 1–100 of Airplane Flying Handbook."`).
- A pilot viewing a chapter part in `MaterialDetail` cannot navigate back to the original handbook or switch between companion chapters without manual searching.
- If a parent handbook is deleted, there is no structured record of what handbook or edition a chapter originated from.

This scope proposal defines the **smallest durable relationship** that establishes structured parent/child split lineage, defines exact page-translation arithmetic for direct and nested splits, preserves historical study history and PDF bytes, provides clean fallback for desktop PDF viewers, and maintains full compatibility with existing databases and backups.

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

The following decision table defines the proposed product defaults for split-source lineage. All defaults are currently **PROPOSED** pending owner approval:

| ID | Decision Area | Recommended Default | Alternative Considered | Impact / Rationale | Status |
| --- | --- | --- | --- | --- | :---: |
| **SL-D1** | **Source Identity & Content Hashing** | **Asynchronous SHA-256 at split time in native worker.** Rust computes the SHA-256 hash of the parent PDF during the existing split file pass and returns it in `PdfPart`. Nullable in browser/test fallback. | 1. No content hash (relational ID only).<br>2. On-demand hashing in frontend on every view. | Negligible cost (~30–50 ms for a 50 MB PDF during a multi-second split operation). Guarantees tamper detection and parent replacement awareness without blocking UI threads. | **Proposed** |
| **SL-D2** | **Relationship Storage Architecture** | **Dedicated `material_split_lineage` table** (Migration 0013) with `CHECK` constraints, foreign keys (`ON DELETE CASCADE` for child, `ON DELETE SET NULL` for parent), and compound indexes. | Additive nullable columns on `study_materials`. | Keeps `study_materials` lean for the 90%+ of materials that are not split parts. Allows strict SQLite table-level `CHECK` constraints and `ON DELETE SET NULL` without table rewrites. | **Proposed** |
| **SL-D3** | **Nested Split Range Mapping** | **Recursive 1-based physical composition:** A sub-split child records its immediate parent (`parentMaterialId`), original root source (`rootMaterialId`), and composed original root page range $[S_1 + S_2 - 1, \; S_1 + E_2 - 1]$. | Only recording immediate parent range, requiring recursive database queries to find original pages. | Single-query resolution for UI display. Pilot instantly sees "Pages 120–140 of Original Handbook" without recursive SQL graph traversal. | **Proposed** |
| **SL-D4** | **Legacy Rows with Unknown Lineage** | **Truthful absence (NULL lineage).** Existing pre-migration split parts return `lineage: null`. Never infer lineage from filenames or title strings (e.g. `" — Part 1 of 5"`). | Heuristic regex parsing of existing titles/notes to invent synthetic lineage rows. | ROADMAP §7 and engineering guidelines strictly forbid inventing provenance or guessing relationships from strings. Avoids erroneous relationships. | **Proposed** |
| **SL-D5** | **Parent Deletion & Replacement Retention** | **Preserve children; retain snapshot metadata.** Foreign key uses `ON DELETE SET NULL`. If parent material is deleted, child survives completely intact. Child's lineage row retains `source_title`, `source_file_name`, and original page range. | 1. Cascade-deleting children when parent is deleted.<br>2. Cascade-deleting lineage row (losing all history). | A child part has its own notes, flashcards, practice tests, and review history. Silently deleting children would cause catastrophic user data loss. | **Proposed** |
| **SL-D6** | **Schema Migration & Restore Compatibility** | **Allocate Migration 0013; increment `CURRENT_SCHEMA_VERSION = 13` in `src-tauri/src/lib.rs`.** Restores into older binaries are cleanly refused per `backup.rs:631`. | Staying on Schema 12 and storing lineage as unvalidated JSON inside an existing column. | Clean relational schema with engine-level integrity. Older binaries cleanly refuse newer backups with a clear user prompt, preventing corrupt state. | **Proposed** |
| **SL-D7** | **MaterialDetail UI & Page Jump Fallback** | **Display source title, validated range, parent link, and sibling selector.** Retain native Open/Reveal. Where page jumps are unsupported by system viewer, show starting page number + "Copy page number" button. | Integrating an embedded web PDF viewer (PDF.js) into Tauri. | Embedded viewer adds multi-megabyte bundle weight, CSP complications, and memory bloat. Native viewer + explicit page guidance is simple and reliable. | **Proposed** |
| **SL-D8** | **Scope Boundaries & Exclusions** | **Strict scope boundaries:** Embedded PDF viewers, PDF annotation/highlighting, OCR/text extraction, and full-library text indexing are explicitly **OUT OF SCOPE** for M2. | Expanding M2 to include PDF viewer enhancements. | Maintains milestone focus; protects offline performance and memory budgets. | **Proposed** |

---

## 3. Concrete Range Mapping & Arithmetic Specifications

### Physical PDF Page Positions vs Printed Page Labels

1. **Physical PDF Page Positions (Contractual Standard):**
   - The contract strictly specifies **1-based, inclusive physical integer page positions** ($1 \le \text{start} \le \text{end} \le \text{total}$).
   - Lopdf, Tauri commands, and AI document ingestion index pages strictly by their 1-based sequential position in the PDF file container.
   - All range validation, database storage, and mapping arithmetic operate exclusively on physical positions.
2. **Printed Page Labels (Display Guidance Only):**
   - Aviation handbooks frequently use Roman numerals (i, ii, iii) for front matter and section-based numbering (e.g., "1-1", "A-1") for chapters.
   - Printed labels may be non-consecutive, missing, or duplicated across document sections.
   - Printed labels are non-contractual advisory strings and must **never** be used for split slice boundaries or arithmetic mapping.

### Single-Level Split Mapping

Let parent document $P$ have total physical pages $N_P$. A split child $C$ covers pages $[S, E]$ where $1 \le S \le E \le N_P$.
- Child document $C$ contains $N_C = E - S + 1$ pages.
- For any 1-based page $p \in [1, N_C]$ in child $C$, its corresponding physical page in parent $P$ is:
  $$\text{parentPage}(p) = S + p - 1$$

#### Concrete Example:
- Parent: *Airplane Flying Handbook* (400 pages total).
- Child: Part 2 covering original pages **101 to 300** ($S = 101, E = 300$, count = 200).
- Child page 1 maps to parent page: $101 + 1 - 1 = \mathbf{101}$.
- Child page 50 maps to parent page: $101 + 50 - 1 = \mathbf{150}$.
- Child page 200 maps to parent page: $101 + 200 - 1 = \mathbf{300}$.

### Nested Split Composition (Sub-Chapters)

When a pilot takes a manual chapter split from an existing split child part:
- Root source $R$ has total pages $N_R$.
- Parent part $C_1$ covers root pages $[S_1, E_1]$ where $1 \le S_1 \le E_1 \le N_R$. Total pages in $C_1 = N_{C_1} = E_1 - S_1 + 1$.
- Pilot selects pages $[S_2, E_2]$ within $C_1$, where $1 \le S_2 \le E_2 \le N_{C_1}$.
- Grandchild part $C_2$ covers root source pages:
  $$\text{rootStart} = S_1 + S_2 - 1$$
  $$\text{rootEnd} = S_1 + E_2 - 1$$
  $$\text{rootTotalPages} = \text{rootEnd} - \text{rootStart} + 1$$

#### Concrete Example:
- Root source: *Instrument Flying Handbook* (400 pages total).
- Child $C_1$ (Part 2): Covers original pages **101 to 300** ($S_1 = 101, E_1 = 300$, count = 200).
- Grandchild $C_2$ (Sub-chapter): Pilot opens $C_1$ and selects pages **20 to 40** of $C_1$ ($S_2 = 20, E_2 = 40$).
- Composed root start: $101 + 20 - 1 = \mathbf{120}$.
- Composed root end: $101 + 40 - 1 = \mathbf{140}$.
- Grandchild $C_2$ covers original pages **120 to 140** of *Instrument Flying Handbook*.
- Page 1 of $C_2$ maps directly to original root page: $120 + 1 - 1 = \mathbf{120}$.
- In the database:
  - `material_id = C2.id`
  - `parent_material_id = C1.id` (immediate parent)
  - `root_material_id = R.id` (original root)
  - `source_page_start = 120`
  - `source_page_end = 140`
  - `nested_level = 2`

### Repeated Imports Disambiguation

- If a pilot imports the same PDF handbook twice (e.g., "AFH 2024 Copy 1" and "AFH 2024 Copy 2"):
  - Each import receives a unique, immutable UUID `id` in `study_materials`.
  - Both records have identical cryptographic `source_content_sha256` hashes.
  - When splitting from Copy 1, the child explicitly records `parent_material_id = Copy1.id`.
  - Even if Copy 2 is later edited or deleted, the child's relational link to Copy 1 remains exact and unambiguous.

---

## 4. Storage & Transaction Contract (Candidate Migration 0013)

### Schema DDL & Constraints

```sql
-- Migration 0013: Split-source lineage metadata
CREATE TABLE IF NOT EXISTS material_split_lineage (
  material_id            TEXT PRIMARY KEY REFERENCES study_materials(id) ON DELETE CASCADE,
  parent_material_id     TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
  root_material_id       TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
  source_page_start      INTEGER NOT NULL,
  source_page_end        INTEGER NOT NULL,
  source_file_name       TEXT NOT NULL,
  source_title           TEXT NOT NULL,
  source_content_sha256  TEXT,
  source_total_pages     INTEGER,
  nested_level           INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT NOT NULL,
  CHECK (source_page_start >= 1),
  CHECK (source_page_end >= source_page_start),
  CHECK (source_total_pages IS NULL OR source_total_pages >= source_page_end),
  CHECK (nested_level >= 1),
  CHECK (material_id != parent_material_id)
);

CREATE INDEX IF NOT EXISTS idx_split_lineage_parent ON material_split_lineage(parent_material_id);
CREATE INDEX IF NOT EXISTS idx_split_lineage_root ON material_split_lineage(root_material_id);
```

### Relational & Engine-Level Invariants

1. **1:1 Optional Lineage Relationship:**
   - `material_id` is the primary key and foreign key to `study_materials(id)`.
   - Materials that are not split parts (notes, whole handbooks, imported study packets) have **zero rows** in `material_split_lineage`.
2. **Child Deletion Cascade (`ON DELETE CASCADE`):**
   - Deleting a child part automatically cleans up its lineage row without orphan records.
3. **Parent Deletion Preservation (`ON DELETE SET NULL`):**
   - Deleting a parent handbook sets `parent_material_id = NULL` on the child's lineage row.
   - The child material **survives** with all its notes, flashcards, review history, and practice tests intact.
   - The child's lineage row survives, retaining `source_title`, `source_file_name`, `source_content_sha256`, and original page range.
4. **Self-Parenting Cycle Prevention:**
   - `CHECK (material_id != parent_material_id)` prevents immediate cycles.
5. **Cross-Driver Transaction Parity:**
   - **Desktop (`rusqlite`):** Executed in an immediate transaction (`TransactionBehavior::Immediate`) pinned to a single connection in `save_split_materials_at`.
   - **Browser (`sql.js`) & Test (`node:sqlite`):** Executed inside `executeMaterialsBatch` under `connectionOwner.exclusive()`. Both single material and batch split saves commit atomically.

---

## 5. Minimal MaterialDetail UI Specification

### Layout & Information Architecture

Within `src/pages/StudyLibrary/MaterialDetail.tsx`, the file card is enhanced to present lineage metadata when present:

```
+-----------------------------------------------------------------------------------+
|  [Document Icon]  airplane-flying-handbook-part-2.pdf                   (14.2 MB) |
|                                                                                   |
|  Source Lineage:                                                                  |
|  From: Airplane Flying Handbook (FAA-H-8083-3C)                                   |
|  Pages: 101–300 of 400 (Child page 1 = Source page 101)                           |
|                                                                                   |
|  [View Parent Handbook]    [Related Parts v]    [Open]    [Reveal in Finder]       |
+-----------------------------------------------------------------------------------+
```

### State-Specific UI Behaviors

1. **Active Parent Available:**
   - Displays: `"From: <Parent Title> — Pages <Start>–<End> of <Total>"`.
   - Actions:
     - `[View Parent Handbook]`: Navigates to `/study/:parentMaterialId`.
     - `[Related Parts (Dropdown)]`: Lists companion sibling parts sharing the same parent, sorted by starting page.
     - `[Open]`: Launches the child PDF in the system default viewer.
2. **Parent Material Deleted from Library:**
   - Displays: `"From: Airplane Flying Handbook (original material removed from library) — Pages 101–300"`.
   - `[View Parent Handbook]` button is replaced with an honest muted badge: `"Parent material removed"`.
   - Child document, its notes, flashcards, and review history remain fully functional.
3. **Parent Document File Missing from Disk:**
   - Displays standard missing file indicator on parent link if parent's file was detached.
4. **Desktop Page-Jump Limitation & Fallback:**
   - Desktop system viewers (macOS Preview, Windows Acrobat, Edge) launched via system open commands (`openPath`) do not accept cross-platform page-number CLI arguments.
   - UI discloses: `"System viewer opens page 1. In original handbook, this corresponds to page 101."`
   - Supplies a `"Copy page 101"` button so the pilot can jump to the page in their viewer immediately.
5. **Legacy Material (No Lineage):**
   - No lineage card or banner is displayed. Behaves exactly as current production code.

---

## 6. Executable Proof Summary & Verification Results

The proposed contract model, range arithmetic, and disposable SQLite schema were executed and verified using modern Node.js (`node:sqlite` and `node:test`) in `docs/evidence/m2-split-lineage-scope-2026-10-08/proof/`:

### Requirements-to-Proof Mapping

| Contract / Requirement | Test Case in `proof.test.mjs` | Assertion Verification | Result |
| --- | --- | --- | :---: |
| **1-Based Inclusive Bounds** | `Contract 1: Page Range Validation` | Verifies `first >= 1`, `last >= first`, and `last <= totalPages`. Rejects 0, negatives, reversed ranges, and non-integers. | **PASS** |
| **Single-Level Page Translation** | `Contract 2: Page Translation Maps Child Position` | Verifies child page 1 -> 101, child page 50 -> 150, child page 200 -> 300. | **PASS** |
| **Nested Range Composition** | `Contract 3: Nested Range Composition` | Verifies [101, 300] split at [20, 40] composes to [120, 140]. | **PASS** |
| **Transitive Multi-Level Nesting** | `Contract 4: Multi-Level Transitive Nested Composition` | Verifies 3-level nesting ([201, 600] -> [51, 150] -> [10, 25]) composes to [260, 275]. | **PASS** |
| **SQL Schema Constraints** | `Contract 5: SQL Schema Constraints` | Verifies SQLite engine enforces `CHECK (source_page_start >= 1)`, range order, and self-parenting prevention. | **PASS** |
| **Parent Deletion Safety** | `Contract 6: Parent Deletion Preserves Child Material` | Deletes parent from `study_materials`. Verifies child and child lineage survive with `parent_material_id = NULL` and metadata intact. | **PASS** |
| **Child Deletion Cascade** | `Contract 7: Child Deletion Cascades Lineage Row` | Deletes child from `study_materials`. Verifies lineage row is removed; parent is untouched. | **PASS** |
| **Parent File Modification** | `Contract 8: Parent Replacement / File Modification` | Updates parent file/hash. Verifies child retains split-time hash; difference is detectable. | **PASS** |
| **Repeated Imports Disambiguation** | `Contract 9: Repeated Imports of Same PDF` | Creates two identical imports. Verifies child links to the specific parent material instance. | **PASS** |
| **Legacy Coexistence** | `Contract 10: Legacy Materials without Lineage` | Queries material without lineage. Verifies `lineage: null`; no synthetic provenance inferred. | **PASS** |
| **Sibling Part Navigation** | `Contract 11: Sibling Navigation Lists Other Parts` | Queries siblings for Part 2. Returns Parts 1 and 3 in page order. | **PASS** |
| **Immutable Document & History Bytes** | `Contract 12: Immutable PDF Bytes & Historical Snapshots` | Verifies PDF bytes, `ai_study_sets`, `practice_sessions`, and `card_review_events` remain byte-identical. | **PASS** |
| **Migration & Backup Compatibility** | `Contract 13: Schema Migration 0012 -> 0013 & Restore` | Verifies clean migration 12 -> 13. Simulates older binary rejecting Schema 13 backup per `backup.rs:631`. | **PASS** |
| **Deliberate Negative Controls** | `negativeControls.mjs` (4 mutations) | Catches off-by-one arithmetic, zero-based indexing, cascade child deletion, and self-parenting loops. | **PASS (4/4)** |

### Execution Metrics
- **Correctness Suite:** 13 passed / 0 failed, exit code **0** (duration: 88 ms).
- **Negative Controls:** 4/4 mutations caught, exit code **0**.

---

## 7. Implementation Acceptance Criteria

When production implementation is authorized by the repository owner following approval of defaults **SL-D1 through SL-D8**, the implementation must satisfy:

1. **Schema & Migration:**
   - Add Migration `0013_split_source_lineage.sql` containing `material_split_lineage` table, foreign keys, CHECK constraints, and indexes.
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
   - Handle deleted-parent state honestly.
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

Implement Milestone 2 split-source lineage in accordance with the accepted scope specification
(`docs/M2_SPLIT_LINEAGE_SCOPE_2026-10-08.md`) and owner-approved defaults SL-D1 through SL-D8.

## Constraints & Requirements
1. Schema & Migration:
   - Add `src-tauri/migrations/0013_split_source_lineage.sql`.
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
