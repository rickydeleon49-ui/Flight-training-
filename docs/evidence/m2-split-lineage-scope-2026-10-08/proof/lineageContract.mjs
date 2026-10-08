import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

/**
 * M2 Split-Source Lineage Contract Model & Helper Functions
 *
 * Enforces the domain rules, page translation arithmetic, nested range composition,
 * and database schema constraints for Her Flight Deck's split-source lineage.
 */

/**
 * Validates a 1-based, inclusive physical PDF page range.
 *
 * @param {number} firstPage 1-based start page
 * @param {number} lastPage 1-based end page
 * @param {number|null} [totalPages] optional total pages of the source document
 * @returns {{ ok: boolean, count?: number, error?: string }}
 */
export function validatePageRange(firstPage, lastPage, totalPages = null) {
  if (typeof firstPage !== "number" || typeof lastPage !== "number") {
    return { ok: false, error: "Page numbers must be numeric." };
  }
  if (!Number.isInteger(firstPage) || !Number.isInteger(lastPage)) {
    return { ok: false, error: "Page numbers must be integers." };
  }
  if (firstPage < 1) {
    return { ok: false, error: "Pages are numbered from 1." };
  }
  if (lastPage < firstPage) {
    return { ok: false, error: "The last page comes before the first one." };
  }
  if (totalPages !== null && totalPages !== undefined) {
    if (typeof totalPages !== "number" || !Number.isInteger(totalPages) || totalPages < 1) {
      return { ok: false, error: "Total pages must be a positive integer." };
    }
    if (firstPage > totalPages) {
      return {
        ok: false,
        error: `This PDF has ${totalPages} pages, so there is no page ${firstPage}.`,
      };
    }
    if (lastPage > totalPages) {
      return {
        ok: false,
        error: `This PDF has ${totalPages} pages, so there is no page ${lastPage}.`,
      };
    }
  }
  return { ok: true, count: lastPage - firstPage + 1 };
}

/**
 * Translates a 1-based page position within a child document to its corresponding
 * page position in the original source document.
 *
 * For example: if a child covers original pages 101–300, child page 1 maps to original page 101,
 * and child page 50 maps to original page 150.
 *
 * @param {number} childPage 1-based page in the child document
 * @param {number} sourcePageStart 1-based start page in the original source document
 * @returns {number}
 */
export function mapChildPageToSource(childPage, sourcePageStart) {
  if (!Number.isInteger(childPage) || childPage < 1) {
    throw new Error("Child page must be a positive integer >= 1.");
  }
  if (!Number.isInteger(sourcePageStart) || sourcePageStart < 1) {
    throw new Error("Source start page must be a positive integer >= 1.");
  }
  return sourcePageStart + childPage - 1;
}

/**
 * Composes nested split page ranges.
 *
 * When taking a split out of an already-split child document:
 * - parentRange is the parent's page range relative to the root source: { sourcePageStart, sourcePageEnd }
 * - childSelection is the selected range within the child: { firstPage, lastPage }
 *
 * Returns the composed range relative to the original root source document:
 * { sourcePageStart, sourcePageEnd, totalPages }
 *
 * @param {{ sourcePageStart: number, sourcePageEnd: number }} parentRange
 * @param {{ firstPage: number, lastPage: number }} childSelection
 * @returns {{ sourcePageStart: number, sourcePageEnd: number, totalPages: number }}
 */
export function composeNestedRanges(parentRange, childSelection) {
  const parentValidation = validatePageRange(parentRange.sourcePageStart, parentRange.sourcePageEnd);
  if (!parentValidation.ok) {
    throw new Error(`Invalid parent range: ${parentValidation.error}`);
  }

  const parentTotalPages = parentRange.sourcePageEnd - parentRange.sourcePageStart + 1;
  const childValidation = validatePageRange(childSelection.firstPage, childSelection.lastPage, parentTotalPages);
  if (!childValidation.ok) {
    throw new Error(`Invalid child selection: ${childValidation.error}`);
  }

  const composedStart = parentRange.sourcePageStart + childSelection.firstPage - 1;
  const composedEnd = parentRange.sourcePageStart + childSelection.lastPage - 1;

  return {
    sourcePageStart: composedStart,
    sourcePageEnd: composedEnd,
    totalPages: composedEnd - composedStart + 1,
  };
}

/**
 * Computes SHA-256 hex digest of a byte buffer or UTF-8 string.
 *
 * @param {Buffer|string} input
 * @returns {string} 64-char lowercase hex string
 */
export function calculateSha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * SQL DDL for Candidate Migration 0013.
 */
export const CANDIDATE_MIGRATION_0013_SQL = `
-- Migration 0013: Split-source lineage metadata
-- Links split PDF materials to their original source document and page range.

CREATE TABLE material_split_lineage (
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

CREATE INDEX idx_split_lineage_parent ON material_split_lineage(parent_material_id);
CREATE INDEX idx_split_lineage_root ON material_split_lineage(root_material_id);
`;

/**
 * Sets up a disposable in-memory SQLite database initialized with schemas 0001 through 0012,
 * and conditionally applies Candidate Migration 0013.
 *
 * @param {boolean} [applyMigration0013=true]
 * @returns {DatabaseSync}
 */
export function createDisposableLineageDb(applyMigration0013 = true) {
  const db = new DatabaseSync(":memory:");

  // SQLite foreign key enforcement is per-connection and must be enabled
  db.exec("PRAGMA foreign_keys = ON;");

  // Schema baseline (migrations 0001 - 0012)
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY
    );

    CREATE TABLE study_materials (
      id                 TEXT PRIMARY KEY,
      title              TEXT NOT NULL,
      material_type      TEXT NOT NULL DEFAULT 'study_guide',
      topic              TEXT NOT NULL DEFAULT 'general',
      review_status      TEXT NOT NULL DEFAULT 'needs_review',
      priority           TEXT NOT NULL DEFAULT 'later',
      goal_id            TEXT,
      event_id           TEXT,
      notes              TEXT NOT NULL DEFAULT '',
      file_path          TEXT,
      original_file_name TEXT,
      file_size          INTEGER,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL,
      last_reviewed_at   TEXT
    );

    CREATE TABLE ai_study_sets (
      source_material_id TEXT PRIMARY KEY REFERENCES study_materials(id) ON DELETE CASCADE,
      title              TEXT NOT NULL,
      summary            TEXT NOT NULL,
      sections_json      TEXT NOT NULL,
      flashcards_json    TEXT NOT NULL,
      source_notes       TEXT NOT NULL,
      provider           TEXT NOT NULL DEFAULT 'gemini',
      model              TEXT NOT NULL DEFAULT '',
      generated_at       TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );

    CREATE TABLE practice_sessions (
      id                 TEXT PRIMARY KEY,
      source_material_id TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
      started_at         TEXT NOT NULL,
      completed_at       TEXT,
      score              INTEGER,
      total_questions    INTEGER
    );

    CREATE TABLE card_review_states (
      source_material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
      card_id            TEXT NOT NULL,
      step               INTEGER NOT NULL,
      due_at             TEXT NOT NULL,
      updated_at         TEXT NOT NULL,
      PRIMARY KEY (source_material_id, card_id)
    );

    CREATE TABLE card_review_events (
      id                 TEXT PRIMARY KEY,
      source_material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
      card_id            TEXT NOT NULL,
      rating             TEXT NOT NULL,
      reviewed_at        TEXT NOT NULL
    );
  `);

  // Record baseline migrations 1..12
  for (let i = 1; i <= 12; i++) {
    db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(i);
  }

  if (applyMigration0013) {
    db.exec(CANDIDATE_MIGRATION_0013_SQL);
    db.prepare("INSERT INTO schema_migrations (version) VALUES (13)").run();
  }

  return db;
}

/**
 * Inserts a study material row into the disposable database.
 */
export function insertMaterial(db, {
  id,
  title,
  filePath = null,
  originalFileName = null,
  fileSize = null,
  notes = "",
  createdAt = new Date().toISOString(),
  updatedAt = new Date().toISOString(),
}) {
  db.prepare(`
    INSERT INTO study_materials (
      id, title, notes, file_path, original_file_name, file_size, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, notes, filePath, originalFileName, fileSize, createdAt, updatedAt);
}

/**
 * Inserts split lineage metadata into the disposable database.
 */
export function insertSplitLineage(db, {
  materialId,
  parentMaterialId = null,
  rootMaterialId = null,
  sourcePageStart,
  sourcePageEnd,
  sourceFileName,
  sourceTitle,
  sourceContentSha256 = null,
  sourceTotalPages = null,
  nestedLevel = 1,
  createdAt = new Date().toISOString(),
}) {
  db.prepare(`
    INSERT INTO material_split_lineage (
      material_id, parent_material_id, root_material_id,
      source_page_start, source_page_end, source_file_name, source_title,
      source_content_sha256, source_total_pages, nested_level, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    materialId,
    parentMaterialId,
    rootMaterialId,
    sourcePageStart,
    sourcePageEnd,
    sourceFileName,
    sourceTitle,
    sourceContentSha256,
    sourceTotalPages,
    nestedLevel,
    createdAt,
  );
}

/**
 * Reads a study material alongside its split lineage and parent status.
 */
export function getMaterialWithLineage(db, materialId) {
  const row = db.prepare(`
    SELECT
      m.id,
      m.title,
      m.file_path,
      m.original_file_name,
      m.file_size,
      m.notes,
      l.parent_material_id,
      l.root_material_id,
      l.source_page_start,
      l.source_page_end,
      l.source_file_name,
      l.source_title,
      l.source_content_sha256,
      l.source_total_pages,
      l.nested_level,
      l.created_at AS lineage_created_at,
      p.title AS live_parent_title,
      p.file_path AS live_parent_file_path
    FROM study_materials m
    LEFT JOIN material_split_lineage l ON l.material_id = m.id
    LEFT JOIN study_materials p ON p.id = l.parent_material_id
    WHERE m.id = ?
  `).get(materialId);

  if (!row) return null;

  const hasLineage = row.source_page_start !== null && row.source_page_start !== undefined;
  return {
    id: row.id,
    title: row.title,
    filePath: row.file_path,
    originalFileName: row.original_file_name,
    fileSize: row.file_size,
    notes: row.notes,
    lineage: hasLineage
      ? {
          parentMaterialId: row.parent_material_id,
          rootMaterialId: row.root_material_id,
          sourcePageStart: row.source_page_start,
          sourcePageEnd: row.source_page_end,
          sourceFileName: row.source_file_name,
          sourceTitle: row.source_title,
          sourceContentSha256: row.source_content_sha256,
          sourceTotalPages: row.source_total_pages,
          nestedLevel: row.nested_level,
          lineageCreatedAt: row.lineage_created_at,
          parentStatus: row.parent_material_id
            ? row.live_parent_title !== null
              ? "available"
              : "deleted"
            : "deleted",
          liveParentTitle: row.live_parent_title,
          liveParentFilePath: row.live_parent_file_path,
        }
      : null,
  };
}

/**
 * Lists siblings of a split part (parts sharing the same parent).
 */
export function listSiblings(db, materialId) {
  const current = getMaterialWithLineage(db, materialId);
  if (!current?.lineage?.parentMaterialId) return [];

  const rows = db.prepare(`
    SELECT
      m.id,
      m.title,
      l.source_page_start,
      l.source_page_end
    FROM material_split_lineage l
    JOIN study_materials m ON m.id = l.material_id
    WHERE l.parent_material_id = ? AND l.material_id != ?
    ORDER BY l.source_page_start ASC, m.title ASC
  `).all(current.lineage.parentMaterialId, materialId);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    sourcePageStart: r.source_page_start,
    sourcePageEnd: r.source_page_end,
  }));
}
