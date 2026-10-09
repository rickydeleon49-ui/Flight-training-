# M2 Split-Source Lineage — Concrete Contract, Owner Defaults, and Scope Proposal (8 October 2026)

> [!IMPORTANT]
> **PLANNING SCOPE & EXECUTABLE PROOF CORRECTED (ROUND 5) — PRODUCT DEFAULTS PENDING OWNER APPROVAL.**
> This document specifies the concrete domain contract, current-code audit, schema design, user experience, and verified executable proof for Milestone 2, Split-Source Lineage.
> Findings **SL-R12 through SL-R13** from senior review have been addressed in this round.
> All recommended defaults (**SL-D1 through SL-D8**) remain **PROPOSED** pending independent review and recorded owner choices.
> This task prepares the next implementation; it does not authorize production migrations, schema modifications, or feature activation.
>
> **Status:** SL-R12–SL-R13 corrected, pending independent scope review; SL-D1–D8 proposed.

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
| **SL-D2** | **Relationship Storage Architecture** | **Dedicated `material_split_lineage` and `split_operation_log` tables** (Candidate Migration 0013). For lineage: `CHECK (TYPEOF(...) = 'integer')`, foreign keys (`ON DELETE CASCADE` for child, `ON DELETE SET NULL` for parent/root), and cycle prevention (`material_id != parent_material_id` AND `material_id != root_material_id`). For operation log: `source_material_id` uses `ON DELETE SET NULL` on nullable source ID, retaining committed split audit records and reconciliation history even if the source handbook is deleted from the library. | Additive nullable columns on `study_materials`. | Keeps `study_materials` lean for non-split materials. Strict SQLite engine-level constraint enforcement prevents corrupted or fractional bounds. `ON DELETE SET NULL` preserves operational history and reconciliation status across parent lifecycle events. | **Proposed** |
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

### Source Version Verdict & Boundary Comparison (SL-R1, SL-R4, SL-R8)

Rather than superficial string comparison, `evaluateSourceVersion` compares source bytes against the recorded split-time hash outside the render loop and returns a read-only verdict:
- `"matching"`: Live PDF content hash matches the recorded split-time hash.
- `"changed"`: Live PDF content has been modified or replaced since the split was performed.
- `"missing"`: PDF file is absent from disk at its recorded path.
- `"deleted"`: Parent `study_materials` entity was deleted from the library (`parent_material_id IS NULL` or live entity removed).
- `"unknown"`: Legacy material, material imported without a cryptographic hash, or unread file bytes.

**Structural Tier Classification & Two-Tier Verdicts (SL-R8):**
Tier classification is strictly structural, never derived from hash presence or nullness:
1. **Direct Splits (`nested_level = 1` AND `parent_page_start IS NULL`):**
   - The effective immediate identity is the root tier.
   - `parentStatus` evaluates the root tier against current root bytes or on-disk file.
   - `rootStatus` evaluates the root tier.
2. **Nested Splits (`nested_level > 1` AND `parent_page_start IS NOT NULL`):**
   - The immediate identity is the parent tier only.
   - If `parent_content_sha256` is NULL, `parentStatus` is strictly `"unknown"`, even when root bytes match. Matching root bytes never certify an unknown parent tier.
   - `rootStatus` evaluates original root $R$ independently using `source_content_sha256`.

### Sibling Isolation Across Document Editions (SL-R1, SL-R4, SL-R8)

When a pilot imports an updated edition of a handbook:
- Sibling grouping operates on the same effective identity:
  - **Direct Parts:** Both parts must have `nested_level = 1`, matching root ID, and matching recorded root hash (`source_content_sha256`).
  - **Nested Parts:** Both parts must have `nested_level > 1`, matching `parent_material_id`, and matching recorded parent hash (`parent_content_sha256`).
- **Unknown Never Establishes Siblinghood:** If the effective parent hash is NULL/unknown, sibling grouping returns an empty list (`[]`). Unknown never matches anything, including another unknown.
- Independently imported materials (different parent ID) remain strictly isolated even if PDF bytes are identical.

### The Receipt is the Only Authority (SL-R10)

To eliminate caller-forged provenance and ensure cryptographic and database binding:
1. **Removal of Receipt-less Save Path Entirely:**
   - No `expectedParentSha256` or `currentParentBytes` save inputs are accepted.
   - No caller `parts` alongside a receipt, no caller operation ID, no `parts[0].sourceTotalPages`, and no 1,000-page fallback.
   - `validateAndSaveSplitBatch` accepts only `{ receipt, tags, onRollbackCleanup }`; anything else is refused before any write.
2. **Tamper-Evident Receipts Bound to Database (`split_operation_log`):**
   - At split time, the receipt is persisted in `split_operation_log` with status `pending`, canonical JSON (deterministic sorted keys), and the SHA-256 hash of that canonical JSON.
   - At save time, the receipt's canonical hash is verified against the recorded `pending` row for the same source material.
   - Any modification to total, plan, hash, or snapshot is refused before write.
   - **Unconditional Tamper Verification (SL-R12):** Verification against `split_operation_log` is unconditional. If the `split_operation_log` table does not exist or has not been created, the save is strictly refused (`split_operation_log table does not exist; cannot verify split operation`).
   - **Production Contract:** In production, the native split worker in `src-tauri/src/pdf.rs` issues the receipt, and the frontend webview cannot mint one.
3. **Receipt Re-issue Policy (SL-R12):**
   - Re-issuing an identical receipt uses a plain `INSERT` with an explicit existing-row policy, never `INSERT OR REPLACE`.
   - If already **`committed`**, it remains committed; idempotent replay and reconciliation continue to work seamlessly.
   - If already **`cancelled`**, it remains cancelled; saving that receipt is refused.
   - If **`pending`**, the existing row is returned unchanged.
4. **Missing or Unreadable Source File Refusal:**
   - A missing or unreadable source file on disk refuses both receipt creation and save, yielding a `missing` verdict. Caller bytes are never an accepted substitute. A material with no stored file cannot be split.
5. **Nested Snapshot Comparison Inside `BEGIN IMMEDIATE` (SL-R12):**
   - Inside `BEGIN IMMEDIATE`, the engine re-checks the parent's lineage row (root ID, root hash, root range, total, nested level) and the parent's file path against the receipt's snapshot.
   - For nested parts, `parent_title` and `parent_file_name` capture the immediate parent's title and file name, while `source_*` preserves the root snapshot.
   - Any concurrent discrepancy immediately refuses save and triggers rollback cleanup strictly for this operation's staged files.
6. **Authoritative Page Total:**
   - The receipt's total is the engine's physical page count determined at split time.
   - In the JS model, it is taken as input from the split engine. In production, it must be extracted by `pdf.rs` via `lopdf`, never supplied by or trusted from the webview.

### Idempotency, Real Cancellation, Delete Policy & Evidence Integrity (SL-R11–SL-R13)

1. **Operation IDs Derived Exclusively from Receipt:**
   - `operationId` comes only from the receipt.
   - **Idempotent Replay:** Resubmission of an already committed receipt replays the persisted material rows without duplicating database records or re-writing files.
   - **Output Identity Conflict Refusal:** A *different* receipt whose parts attempt to reuse output identities already committed in the library is refused before write with a named error (`Planned output material ID already exists in library: ...`), rather than failing on database primary-key constraints.
   - **Reconciliation:** `reconcileBatch(db, operationId)` reads exclusively by operation ID.
2. **Strict Real Cancellation (`cancelBatch` — SL-R11, SL-R13):**
   - The compatibility 3-argument signature has been completely removed. Only `cancelBatch(db, operationId)` is supported.
   - **Before Commit:** Marks the operation as `cancelled` in `split_operation_log` and unlinks *only* the staged files explicitly recorded in that operation's receipt plan.
   - **After Commit:** Changes nothing, returning status `committed` and preserving committed files.
   - **Subsequent Save Refusal:** Any subsequent save attempt for a cancelled receipt is refused (`Cannot save a cancelled split operation`).
   - Ownerless file deletions are impossible because file unlinking is strictly bound to the operation's recorded receipt.
3. **Operation-Log Delete Policy (`ON DELETE SET NULL` — SL-R12):**
   - In `split_operation_log`, `source_material_id` is defined as nullable with `REFERENCES study_materials(id) ON DELETE SET NULL`.
   - When a source handbook is deleted from the library, the operation log row is preserved, setting `source_material_id` to NULL.
   - This ensures that operational audit history, canonical receipts, and batch reconciliation (`reconcileBatch`) remain functional and truthful for already-committed split children even after the source handbook is removed.
4. **Isolated Rollback Cleanup:**
   - Mid-transaction failure rolls back the SQLite transaction and invokes `onRollbackCleanup` exactly once, deleting only staging files belonging to this operation.

---

## 4. Storage & Transaction Contract (Candidate Migration 0013)

### Authoritative Candidate DDL (`candidate_migration_0013.sql`)

`split_operation_log` is fully designed as part of `candidate_migration_0013.sql`, not part of the shipped baseline 0001–0012:

```sql
-- Candidate Migration 0013: Split-source lineage metadata and operation tracking log
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
  CHECK ((parent_page_start IS NULL AND parent_page_end IS NULL) OR (parent_page_start IS NOT NULL AND parent_page_end IS NOT NULL)),
  CHECK (
    (nested_level = 1 AND parent_page_start IS NULL AND parent_page_end IS NULL AND parent_total_pages IS NULL)
    OR
    (nested_level > 1 AND parent_page_start IS NOT NULL AND parent_page_end IS NOT NULL AND parent_total_pages IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_split_lineage_parent ON material_split_lineage(parent_material_id);
CREATE INDEX IF NOT EXISTS idx_split_lineage_root ON material_split_lineage(root_material_id);

CREATE TABLE IF NOT EXISTS split_operation_log (
  operation_id           TEXT PRIMARY KEY NOT NULL,
  source_material_id     TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
  receipt_canonical_json TEXT NOT NULL,
  receipt_hash           TEXT NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('pending', 'committed', 'cancelled')),
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_split_op_log_source ON split_operation_log(source_material_id);
CREATE INDEX IF NOT EXISTS idx_split_op_log_status ON split_operation_log(status);
```

### Relational & Engine-Level Invariants (SL-R2, SL-R8, SL-R10, SL-R11, SL-R12)

1. **Child Identity Mandatory (`NOT NULL`):** `material_id TEXT PRIMARY KEY NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE` rejects NULL child IDs.
2. **Physical Page Integer Storage:** SQLite `CHECK (TYPEOF(...) = 'integer')` prevents loose type affinity from admitting fractional page numbers (e.g. `101.5`).
3. **Child Length Matching:** `CHECK (child_page_count = (source_page_end - source_page_start + 1))` guarantees that child page length matches the root slice window.
4. **Self-Parent & Self-Root Refusal:** `CHECK (material_id != parent_material_id)` and `CHECK (material_id != root_material_id)` prevent immediate cycle formation.
5. **Structural Tier Classification:** DDL CHECK constraint enforces that `nested_level = 1` requires NULL parent coordinates and totals, while `nested_level > 1` strictly requires non-NULL parent coordinates and totals.
6. **Parent Deletion Preservation (`ON DELETE SET NULL`):** Deleting a parent or root material sets `parent_material_id` and `root_material_id` to `NULL`. The child material survives intact, and all snapshot metadata remain permanently preserved.
7. **Operation Log Bound to Source Material (`ON DELETE SET NULL` — SL-R12):** `split_operation_log` records each split attempt's canonical receipt, hash, and status (`pending`, `committed`, `cancelled`). `source_material_id` is nullable with `ON DELETE SET NULL`; if the source material is deleted from the library, the operation log row is retained so reconciliation and operational history remain intact.
8. **Shipped Baseline Fidelity (SL-R11):** The shipped schema 0001–0012 contains neither `material_split_lineage` nor `split_operation_log`. Both tables are exclusively created by candidate migration 0013. Contract 13 explicitly verifies this invariant.

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

## 6. Executable Proof Summary & Verification Results (SL-R12–SL-R13)

The corrected contract model, authoritative DDL, and disposable SQLite schema were executed and verified in `docs/evidence/m2-split-lineage-scope-round5-2026-10-08/proof/`:

### Requirements-to-Proof Mapping

| Contract / Requirement | Test Case in `proof.test.mjs` | Key Invariants Verified | Result |
| --- | --- | --- | :---: |
| **1-Based Inclusive Bounds** | `Contract 1: Page Range Validation` | Verifies `first >= 1`, `last >= first`, `last <= totalPages`. Rejects 0, negatives, reversed ranges, non-integers, unsafe floats. | **PASS** |
| **Child Bounds & Explicit Options** | `Contract 2: Page Translation Maps Child Position` | Refuses child page 201 for a 200-page child. Supports explicit options `{ sourcePageEnd, childLength }` as main API. Positional magnitude-guessing moved to narrow adapter. Rejects non-integers, negative, non-finite (`NaN`, `Infinity`), and unsafe values. | **PASS** |
| **Nested Navigation Coordinates** | `Contract 3: Nested Range Composition & Navigation` | Persists Root $R=400$, Part $A=101..300$, Child $B=20..40$. Composed $R=120..140$. Opening $A$ uses page 20; opening $R$ uses page 120. Child length is 21. | **PASS** |
| **Multi-Level Nesting** | `Contract 4: Multi-Level Transitive Composition` | 3-level transitive composition: [201, 600] $\to$ [51, 150] $\to$ [11, 20] composes to [261, 270], length 10. | **PASS** |
| **DDL Constraints (SL-R8, SL-R12)** | `Contract 5: Structural Tiers and Strict DDL CHECK Constraints` | Rejects NULL child ID (`NOT NULL`), rejects fractional pages (`101.5` via `TYPEOF = 'integer'`), enforces range order and totals. Enforces structural tier CHECK constraints tying `nested_level = 1` to NULL parent fields and `nested_level > 1` to present parent coordinates and totals. Cycle prevention rejects self-parenting and self-root. | **PASS** |
| **Two-Tier Veracity Verification** | `Contract 6: Two-Tier Veracity Verification from Real Files` | Verifies two-tier verdicts (`matching`, `changed`, `missing`, `unknown`) against real physical files on disk. | **PASS** |
| **Sibling Edition Isolation (SL-R8)** | `Contract 7: Direct & Nested Sibling Disambiguation` | Sibling grouping matches on effective identity: root ID + root hash for direct parts; parent ID + parent hash for nested parts. Unknown never matches anything. Independent parent IDs remain isolated. | **PASS** |
| **Legacy NULL Parent Hash** | `Contract 8: Legacy NULL Parent Hash is Handled as Unknown` | Explicitly verifies that legacy rows with NULL `parent_content_sha256` evaluate to `unknown` rather than matching or guessing. | **PASS** |
| **Unknown Parent Editions** | `Contract 9: Unknown Parent Editions Are Not Grouped as Siblings` | Unknown parent editions return empty sibling lists, preventing accidental grouping of unrelated parts. | **PASS** |
| **Parent Deletion Safety (SL-R12)** | `Contract 10: Parent Deletion Preserves Child Material` | Parent deletion sets parent ID to NULL via `ON DELETE SET NULL`. Preserves historical root snapshot with NULL ID. Immediate parent is never recorded as root. Child material survives intact. `split_operation_log` row is preserved via `ON DELETE SET NULL`. | **PASS** |
| **Authoritative Receipt & Save Contract (SL-R10, SL-R12)** | `Contract 11: Atomic Batch Save Binds to Authoritative Receipt` | Requires typed `SplitSourceReceipt` bound to `split_operation_log`. Receipt-less save is completely refused. Tamper verification is unconditional. Nested part records immediate parent title/file name while preserving root snapshot. In-transaction re-checks verify source existence and compare nested parent snapshot. Cleanup runs exactly once on rollback. | **PASS** |
| **Save/Refresh Idempotency** | `Contract 12: Acknowledged Save Followed by Failed Refresh` | Verified that transient UI refresh failure reconciles idempotently via `reconcileBatch` reading by operation ID without duplicating parts or re-splitting. | **PASS** |
| **Shipped Migrations Baseline & 0013 Scope (SL-R11)** | `Contract 13: Shipped Migrations 0001–0012 Faithful Schema Baseline` | Asserts that `split_operation_log` and `material_split_lineage` do NOT exist in shipped migrations 0001–0012. Both tables are created exclusively by candidate migration 0013. | **PASS** |
| **Populated Lifecycle & Preservation** | `Contract 14: Disposable Schema Migration Lifecycle` | Seeds parent and child history in shipped 0001–0012; applies candidate 0013; splits child via validated save with receipt creating distinct file; adds retained-child practice and card histories; replaces source bytes in-place showing `changed` verdict; deletes parent; exports and reopens DB with `foreign_keys` ON; verifies all seeded history rows intact. | **PASS** |
| **Restore Simulation** | `Contract 15: Restore Simulation Boundaries` | Explicitly distinguishes numeric version check simulation (`backup.rs:631`) from native backup validator. | **PASS** |
| **Storage & Engine Bounds** | `Contract 16: Explicit Page Bounds & Storage Limits` | States JS safe-integer limits ($2^{53}-1$) vs SQLite 64-bit integer limits ($2^{63}-1$) vs PDF 32-bit limits ($2^{31}-1$). | **PASS** |
| **Concurrent Staging Cleanup** | `Contract 17: Concurrent Staged Operations and Cleanup Isolation` | `onRollbackCleanup` runs exactly once per failed operation and removes only files owned by that failed operation, leaving concurrent staged operations intact. | **PASS** |
| **Operation-ID Idempotency & Real Cancellation (SL-R11, SL-R12, SL-R13)** | `Contract 18: Idempotent Resubmission, Reconciliation, and Real Cancellation` | Replay of committed receipt returns persisted rows; re-issuing receipt does not reset status; conflicting reuse of output IDs throws named error before write; `cancelBatch(db, opId)` strictly takes `(db, opId)`, unlinks only recorded staged files, preserves committed data after commit, and refuses subsequent saves. | **PASS** |

### Execution Metrics & Sensitivity Results

- **Proof Test Suite (`proof.test.mjs`):** 18 tests passed / 0 failed, exit code **0**.
- **Verbatim Reviewer Diagnostic (`lineage-round4-review.test.mjs`):**
  - Baseline execution: 4 passed / 4 failed, exit code **1** (reproduced verbatim).
  - Final execution against Round 5 contract: 8 passed / 0 failed, exit code **0**.
  - Verified verbatim without modifying the diagnostic file.
- **Disclosed Diagnostic Retirements (via import-only redirect loader):**
  - **Frozen Round 1 Diagnostic (`lineage-review.test.mjs`):** 7 passed / 0 failed, exit code **0**.
  - **Frozen Round 2 Diagnostic (`lineage-round2.test.mjs`):** 4 passed / 2 retired, exit code **1**. The two receipt-less controls (controls 1–2) fail honestly under mandatory receipt enforcement and are mapped to permanent coverage in Contract 11.
  - **Superseded Round 2 Reviewer Diagnostic (`lineage-round2-review.test.mjs`):** 8 passed / 3 retired, exit code **1**. Controls 1–2 and case 11 retired under mandatory receipt enforcement; mapped to Contract 11.
  - **Round 3 Reviewer Diagnostic (`lineage-round3-review.test.mjs`):** 10 passed / 2 retired, exit code **1**. Case 11 (hard-coded Round 3 DDL path; passes directly against Round 5 DDL) and Case 12 (retired 3-argument `cancelBatch` signature; mapped to Contract 18 strict 2-arg signature).
- **Genuine Mutation Checks (`mutationChecks.mjs`):**
  - Pinned `--test-reporter=tap`, matching on failing test name in TAP stream plus expected assertion error message.
  - Prints exact killed count, exits 1 on any miss, and writes receipts only to the specified output directory (`argv[2]`).
  - 14 mutants evaluated across two independent runs from different working directories (14/14 caught, exit code **0** on both):
    - Mutant 1 (Range composition arithmetic off-by-one): killed by Contract 3 assertion.
    - Mutant 2 (Child upper-bound enforcement removed): killed by Contract 2 assertion.
    - Mutant 3 (TYPEOF integer checks removed from DDL): killed by Contract 5 assertion.
    - Mutant 4 (Self-parent cycle check removed from DDL): killed by Contract 5 assertion.
    - Mutant 5 (Hash-nullness tier heuristic restored): killed by Contract 8 assertion.
    - Mutant 6 (Sibling COALESCE grouping restored): killed by Contract 9 assertion.
    - Mutant 7 (Output identity collision check omitted): killed by Contract 18 assertion.
    - Mutant 8 (Cancellation of committed batch permitted): killed by Contract 18 assertion.
    - Mutant 9 (Receipt-less save restored): killed by Contract 11 assertion.
    - Mutant 10 (Receipt hash verification skipped): killed by Contract 11 assertion.
    - Mutant 11 (Parent lineage snapshot comparison removed): killed by Contract 11 assertion.
    - Mutant 12 (Operation log table created in test helper): killed by Contract 13 assertion.
    - Mutant 13 (Parent tier mislabel): killed by Contract 11 assertion.
    - Mutant 14 (Receipt re-issue reset): killed by Contract 18 assertion.
- **Round Five Evidence Pack:** `docs/evidence/m2-split-lineage-scope-round5-2026-10-08/` with full receipts, authoritative candidate DDL, tests, loader, and checksums.

---

## 7. Implementation Acceptance Criteria

When production implementation is authorized by the repository owner following approval of defaults **SL-D1 through SL-D8**, the implementation must satisfy:

1. **Schema & Migration:**
   - Add Migration `0013_split_source_lineage.sql` matching the authoritative candidate DDL (defining both `material_split_lineage` and `split_operation_log`).
   - Update `CURRENT_SCHEMA_VERSION = 13` in `src-tauri/src/lib.rs`.
   - Register migration in `src-tauri/src/lib.rs` and frontend migration list.
2. **Native Splitter Commands:**
   - Update `split_pdf` and `split_pdf_automatically` in `src-tauri/src/pdf.rs` to compute parent SHA-256 and produce structured `SplitSourceReceipt`.
   - Take total page count strictly from the native PDF engine (`lopdf`), never trusting or accepting values from the webview.
   - Persist receipt as `pending` in `split_operation_log`.
   - Preserve existing 50 MiB and 1,000-page bounds.
3. **Repository & Transaction Updates:**
   - Update `save_split_materials_at` (`documents.rs`) and `executeMaterialsBatch` (`materialTransaction.ts`) to require `SplitSourceReceipt`, verify its canonical hash against `split_operation_log`, perform pinned in-transaction re-checks inside `BEGIN IMMEDIATE` (including nested snapshot comparison), and insert into `material_split_lineage` and update `split_operation_log` to `committed` in the same immediate transaction.
   - Enforce operation-ID idempotency and isolated cleanup.
   - Implement `cancelBatch(db, operationId)` to mark cancelled and clean staged files.
   - Update `documentRepository.ts` to query lineage via `LEFT JOIN` and populate domain `lineage` field.
4. **UI Integration:**
   - Update `MaterialDetail.tsx` to render source title, original range, parent navigation link, sibling selector, and copy-page fallback.
   - Classify direct vs nested structurally; handle deleted-parent, missing-bytes, and changed-source states honestly.
5. **Test Matrix:**
   - Unit tests covering range arithmetic and nested composition.
   - Repository tests verifying atomic persistence, receipt verification, and idempotency across native and browser drivers.
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
   - Add `src-tauri/migrations/0013_split_source_lineage.sql` from authoritative candidate DDL (including both `material_split_lineage` and `split_operation_log`).
   - Define `split_operation_log.source_material_id` as nullable with `ON DELETE SET NULL`, preserving operational audit history and reconciliation status across source material deletions.
   - Bump `CURRENT_SCHEMA_VERSION = 13` in `src-tauri/src/lib.rs`.
   - Register Migration 0013 in `src-tauri/src/lib.rs` and frontend database drivers.
2. Authoritative Receipt & Engine Authority:
   - In `src-tauri/src/pdf.rs`, the split command generates a typed `SplitSourceReceipt` containing source material ID, path, size, SHA-256 of exact bytes split, authoritative engine page total (from `lopdf`), lineage snapshot for nested sources (including immediate parent title and file name), and deterministic plan.
   - Persist receipt in `split_operation_log` as `pending` via a plain `INSERT` that never overwrites an existing row (`INSERT OR REPLACE` prohibited). If already `committed`, it remains committed; if `cancelled`, it remains cancelled.
   - The file-read boundary for verification sits honestly outside the SQLite transaction.
   - Receipt-less save is completely refused. Tamper verification is unconditional: if `split_operation_log` does not exist, save is refused.
3. Pinned-Transaction Owner Re-checks & Atomic Save:
   - In `src-tauri/src/documents.rs` and `materialTransaction.ts`, `save_split_materials_at` requires a valid receipt matching a `pending` log row.
   - Inside `BEGIN IMMEDIATE`, re-check before any write: source material row still exists and points to receipt's file; nested parent lineage snapshot is unchanged.
   - For nested splits, populate `parent_title` and `parent_file_name` from immediate parent $A$, while preserving root $R$ snapshot in `source_*`.
   - Atomically insert `study_materials`, `material_tags`, and `material_split_lineage`, and mark `split_operation_log` as `committed`.
   - Cleanup runs at most once per failed operation and only touches staging files owned by that operation.
4. Structural Tiers & Edition Isolation:
   - Classify direct (`nested_level = 1` AND `parent_page_start IS NULL`) vs nested (`nested_level > 1`) strictly by structure, never hash nullness.
   - Sibling grouping operates on effective identity: root ID + root hash for direct parts; parent ID + parent hash for nested parts. Unknown never matches anything.
5. Idempotency, Cancellation & Reconciliation:
   - Derive deterministic `operationId` exclusively from receipt. Resubmitting a committed batch returns existing parts without duplicating rows or files.
   - Conflicting reuse of output identities is refused before write with a named error.
   - Implement `cancelBatch(db, operationId)` strictly taking `(db, operationId)`. It marks the operation `cancelled` and unlinks only files recorded in the receipt plan. Ownerless file deletions are prohibited. Subsequent saves of cancelled receipts are refused.
   - Reconciliation reads by operation ID.
6. Frontend Layer:
   - In `src/domain/types.ts`, add `SplitLineage` interface and update `StudyMaterial`.
   - In `src/pages/StudyLibrary/SplitPdfDialog.tsx` and `ManualSplitDialog.tsx`, pass receipt and plan to repository.
   - In `src/pages/StudyLibrary/MaterialDetail.tsx`, render source lineage, parent link, edition-correct sibling selector, two-tier verdicts, and copy-page fallback.
7. Verification:
   - Add comprehensive tests covering arithmetic, atomic saves, in-transaction re-checks, structural tiers, idempotency, cancellation, parent deletion, and UI states.
   - Verify full local test suite passes with zero regressions.
   - Leave changes uncommitted and unpushed for independent review.
```

