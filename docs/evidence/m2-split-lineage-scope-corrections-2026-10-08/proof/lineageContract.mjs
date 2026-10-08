import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Locate candidate migration DDL (authoritative file)
const candidateMigrationSqlPath = join(__dirname, "../candidate_migration_0013.sql");
export const CANDIDATE_MIGRATION_0013_SQL = readFileSync(candidateMigrationSqlPath, "utf8");

// Locate shipped migrations 0001 - 0012
function findShippedMigrationsDir() {
  const candidates = [
    join(__dirname, "../../../../src-tauri/migrations"),
    join(__dirname, "../../../../../src-tauri/migrations"),
    "/Users/rickymac/code/Flight-training-split-lineage-scope/src-tauri/migrations",
  ];
  for (const dir of candidates) {
    if (existsSync(dir) && existsSync(join(dir, "0001_initial_schema.sql"))) {
      return dir;
    }
  }
  throw new Error("Unable to locate shipped migrations directory src-tauri/migrations");
}

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
  if (!Number.isSafeInteger(firstPage) || !Number.isSafeInteger(lastPage)) {
    return { ok: false, error: "Page numbers must be integers." };
  }
  if (firstPage < 1) {
    return { ok: false, error: "Pages are numbered from 1." };
  }
  if (lastPage < firstPage) {
    return { ok: false, error: "The last page comes before the first one." };
  }
  if (totalPages !== null && totalPages !== undefined) {
    if (typeof totalPages !== "number" || !Number.isSafeInteger(totalPages) || totalPages < 1) {
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
 * page position in the source document.
 *
 * Rejects zero, negative, fractional, non-finite, unsafe numbers and positions
 * beyond the recorded child length.
 *
 * @param {number} childPage 1-based page in the child document
 * @param {number} sourcePageStart 1-based start page in the source document
 * @param {number} [sourceEndOrChildLength] recorded range end in source OR child length
 * @param {number|null} [explicitChildLength] optional explicit child length
 * @returns {number}
 */
export function mapChildPageToSource(childPage, sourcePageStart, sourceEndOrChildLength, explicitChildLength = null) {
  if (typeof childPage !== "number" || !Number.isSafeInteger(childPage) || childPage < 1) {
    throw new Error("Child page must be a positive integer >= 1.");
  }
  if (typeof sourcePageStart !== "number" || !Number.isSafeInteger(sourcePageStart) || sourcePageStart < 1) {
    throw new Error("Source start page must be a positive integer >= 1.");
  }

  let childLength = null;
  if (explicitChildLength !== null && explicitChildLength !== undefined) {
    if (typeof explicitChildLength !== "number" || !Number.isSafeInteger(explicitChildLength) || explicitChildLength < 1) {
      throw new Error("Child length must be a positive integer >= 1.");
    }
    childLength = explicitChildLength;
  } else if (sourceEndOrChildLength !== undefined && sourceEndOrChildLength !== null) {
    if (typeof sourceEndOrChildLength !== "number" || !Number.isSafeInteger(sourceEndOrChildLength) || sourceEndOrChildLength < 1) {
      throw new Error("Recorded source end or child length must be a positive integer >= 1.");
    }
    if (sourceEndOrChildLength >= sourcePageStart) {
      childLength = sourceEndOrChildLength - sourcePageStart + 1;
    } else {
      childLength = sourceEndOrChildLength;
    }
  }

  if (childLength !== null && childPage > childLength) {
    throw new Error(`Child page ${childPage} exceeds child length ${childLength}.`);
  }

  const mapped = sourcePageStart + childPage - 1;
  if (!Number.isSafeInteger(mapped)) {
    throw new Error("Mapped source page exceeds safe integer bounds.");
  }
  return mapped;
}

/**
 * Composes nested split page ranges.
 *
 * When taking a split out of an already-split parent document:
 * - parentRange is the parent's page range relative to the root source: { sourcePageStart, sourcePageEnd }
 * - childSelection is the selected range within the parent: { firstPage, lastPage }
 *
 * Returns the composed range relative to the original root source document:
 * { sourcePageStart, sourcePageEnd, parentPageStart, parentPageEnd, childPageCount, totalPages }
 *
 * @param {{ sourcePageStart: number, sourcePageEnd: number }} parentRange
 * @param {{ firstPage: number, lastPage: number }} childSelection
 * @returns {{ sourcePageStart: number, sourcePageEnd: number, parentPageStart: number, parentPageEnd: number, childPageCount: number, totalPages: number }}
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
  const childPageCount = childSelection.lastPage - childSelection.firstPage + 1;

  return {
    sourcePageStart: composedStart,
    sourcePageEnd: composedEnd,
    parentPageStart: childSelection.firstPage,
    parentPageEnd: childSelection.lastPage,
    childPageCount,
    totalPages: childPageCount,
  };
}

/**
 * Resolves opening navigation page targets for a child material.
 *
 * For example:
 * Root R has 400 pages.
 * Part A covers R pages 101–300 (length 200).
 * Child B takes A pages 20–40 (length 21).
 * B in R covers pages 120–140.
 *
 * To open A at the beginning of B: page 20.
 * To open R at the beginning of B: page 120.
 * Length of B is 21 (neither 400 nor 200).
 *
 * @param {{ sourcePageStart: number, sourcePageEnd: number, parentPageStart?: number|null, parentPageEnd?: number|null, childPageCount: number }} lineage
 * @param {number} [childPage=1] 1-based page within the child document
 * @returns {{ childPage: number, parentTargetPage: number|null, rootTargetPage: number, childPageCount: number }}
 */
export function resolveNavigationTargets(lineage, childPage = 1) {
  if (typeof childPage !== "number" || !Number.isSafeInteger(childPage) || childPage < 1) {
    throw new Error("Child page must be a positive integer >= 1.");
  }
  if (childPage > lineage.childPageCount) {
    throw new Error(`Child page ${childPage} exceeds child length ${lineage.childPageCount}.`);
  }

  const rootTargetPage = mapChildPageToSource(childPage, lineage.sourcePageStart, lineage.sourcePageEnd);

  let parentTargetPage = null;
  if (lineage.parentPageStart !== null && lineage.parentPageStart !== undefined) {
    parentTargetPage = mapChildPageToSource(childPage, lineage.parentPageStart, lineage.parentPageEnd);
  }

  return {
    childPage,
    parentTargetPage,
    rootTargetPage,
    childPageCount: lineage.childPageCount,
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
 * Evaluates the read-only availability and version comparison verdict for a source document.
 * Returns one of: "matching", "changed", "missing", "deleted", or "unknown".
 *
 * @param {{
 *   recordedHash?: string|null,
 *   currentHash?: string|null,
 *   currentBytes?: Buffer|Uint8Array|string|null,
 *   fileExists?: boolean,
 *   materialExists?: boolean,
 * }} options
 * @returns {{ status: "matching"|"changed"|"missing"|"deleted"|"unknown", matches: boolean|null, details: string }}
 */
export function evaluateSourceVersion({
  recordedHash = null,
  currentHash = null,
  currentBytes = null,
  fileExists = true,
  materialExists = true,
}) {
  if (!materialExists) {
    return {
      status: "deleted",
      matches: false,
      details: "The source material entity was deleted from the library.",
    };
  }
  if (!fileExists) {
    return {
      status: "missing",
      matches: false,
      details: "The source PDF file could not be found at its recorded path.",
    };
  }
  if (!recordedHash) {
    return {
      status: "unknown",
      matches: null,
      details: "No reference hash was recorded for this source document.",
    };
  }

  const activeCurrentHash = currentBytes ? calculateSha256(currentBytes) : currentHash;
  if (!activeCurrentHash) {
    return {
      status: "unknown",
      matches: null,
      details: "Current file content has not been hashed.",
    };
  }

  if (activeCurrentHash.toLowerCase() === recordedHash.toLowerCase()) {
    return {
      status: "matching",
      matches: true,
      details: "Source PDF content matches the split snapshot.",
    };
  } else {
    return {
      status: "changed",
      matches: false,
      details: "Source PDF content has been modified or replaced since the split.",
    };
  }
}

/**
 * Sets up a disposable in-memory SQLite database initialized by executing
 * the actual shipped migrations 0001 through 0012, and optionally applies
 * Candidate Migration 0013 from candidate_migration_0013.sql.
 *
 * @param {boolean} [applyMigration0013=true]
 * @param {object} [options={}]
 * @returns {DatabaseSync}
 */
export function createDisposableLineageDb(applyMigration0013 = true, options = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");

  // Track migrations using the app's real migration table
  db.exec("CREATE TABLE IF NOT EXISTS _sqlx_migrations (version INTEGER PRIMARY KEY);");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);");

  // Shipped migrations 0001 - 0012
  const migrationsDir = options.migrationsDir || findShippedMigrationsDir();
  const shippedFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of shippedFiles) {
    const versionMatch = file.match(/^(\d+)_/);
    if (!versionMatch) continue;
    const version = parseInt(versionMatch[1], 10);
    if (version >= 1 && version <= 12) {
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      db.exec(sql);
      db.prepare("INSERT OR IGNORE INTO _sqlx_migrations (version) VALUES (?)").run(version);
      db.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)").run(version);
    }
  }

  if (applyMigration0013) {
    db.exec(CANDIDATE_MIGRATION_0013_SQL);
    db.prepare("INSERT INTO _sqlx_migrations (version) VALUES (13)").run();
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
  materialType = "study_guide",
  topic = "general",
  reviewStatus = "needs_review",
  priority = "later",
  goalId = null,
  eventId = null,
  notes = "",
  filePath = null,
  originalFileName = null,
  fileSize = null,
  createdAt = new Date().toISOString(),
  updatedAt = new Date().toISOString(),
}) {
  db.prepare(`
    INSERT INTO study_materials (
      id, title, material_type, topic, review_status, priority, goal_id, event_id,
      notes, file_path, original_file_name, file_size, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, title, materialType, topic, reviewStatus, priority, goalId, eventId,
    notes, filePath, originalFileName, fileSize, createdAt, updatedAt
  );
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
  parentPageStart = null,
  parentPageEnd = null,
  childPageCount = null,
  sourceFileName,
  sourceTitle,
  sourceContentSha256 = null,
  sourceTotalPages = null,
  parentFileName = null,
  parentTitle = null,
  parentContentSha256 = null,
  parentTotalPages = null,
  nestedLevel = 1,
  createdAt = new Date().toISOString(),
}) {
  const calculatedChildPageCount = childPageCount ?? (sourcePageEnd - sourcePageStart + 1);

  db.prepare(`
    INSERT INTO material_split_lineage (
      material_id, parent_material_id, root_material_id,
      source_page_start, source_page_end, parent_page_start, parent_page_end,
      child_page_count, source_file_name, source_title, source_content_sha256, source_total_pages,
      parent_file_name, parent_title, parent_content_sha256, parent_total_pages,
      nested_level, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    materialId,
    parentMaterialId,
    rootMaterialId,
    sourcePageStart,
    sourcePageEnd,
    parentPageStart,
    parentPageEnd,
    calculatedChildPageCount,
    sourceFileName,
    sourceTitle,
    sourceContentSha256,
    sourceTotalPages,
    parentFileName,
    parentTitle,
    parentContentSha256,
    parentTotalPages,
    nestedLevel,
    createdAt
  );
}

/**
 * Reads a study material alongside its split lineage and parent version status.
 */
export function getMaterialWithLineage(db, materialId, options = {}) {
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
      l.parent_page_start,
      l.parent_page_end,
      l.child_page_count,
      l.source_file_name,
      l.source_title,
      l.source_content_sha256,
      l.source_total_pages,
      l.parent_file_name,
      l.parent_title,
      l.parent_content_sha256,
      l.parent_total_pages,
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
  if (!hasLineage) {
    return {
      id: row.id,
      title: row.title,
      filePath: row.file_path,
      originalFileName: row.original_file_name,
      fileSize: row.file_size,
      notes: row.notes,
      lineage: null,
    };
  }

  let parentStatus = "unknown";
  let parentVersionDetails = "";
  if (!row.parent_material_id || !row.live_parent_title) {
    parentStatus = "deleted";
    parentVersionDetails = "Immediate parent material was deleted from the library.";
  } else {
    const fileExists = options.fileExists ?? true;
    const currentBytes = options.currentFileBytes ?? null;
    const evaluation = evaluateSourceVersion({
      recordedHash: row.parent_content_sha256,
      currentBytes,
      currentHash: options.currentHash ?? null,
      fileExists,
      materialExists: true,
    });
    parentStatus = evaluation.status;
    parentVersionDetails = evaluation.details;
  }

  return {
    id: row.id,
    title: row.title,
    filePath: row.file_path,
    originalFileName: row.original_file_name,
    fileSize: row.file_size,
    notes: row.notes,
    lineage: {
      parentMaterialId: row.parent_material_id,
      rootMaterialId: row.root_material_id,
      sourcePageStart: row.source_page_start,
      sourcePageEnd: row.source_page_end,
      parentPageStart: row.parent_page_start,
      parentPageEnd: row.parent_page_end,
      childPageCount: row.child_page_count,
      sourceFileName: row.source_file_name,
      sourceTitle: row.source_title,
      sourceContentSha256: row.source_content_sha256,
      sourceTotalPages: row.source_total_pages,
      parentFileName: row.parent_file_name,
      parentTitle: row.parent_title,
      parentContentSha256: row.parent_content_sha256,
      parentTotalPages: row.parent_total_pages,
      nestedLevel: row.nested_level,
      lineageCreatedAt: row.lineage_created_at,
      parentStatus,
      parentVersionDetails,
      liveParentTitle: row.live_parent_title,
      liveParentFilePath: row.live_parent_file_path,
    },
  };
}

/**
 * Lists siblings of a split part sharing the same immediate parent and matching edition hash.
 */
export function listSiblings(db, materialId) {
  const current = getMaterialWithLineage(db, materialId);
  if (!current?.lineage?.parentMaterialId) return [];

  const parentId = current.lineage.parentMaterialId;
  const parentHash = current.lineage.parentContentSha256;

  let query = "";
  let params = [];

  if (parentHash) {
    query = `
      SELECT
        m.id,
        m.title,
        l.source_page_start,
        l.source_page_end,
        l.parent_page_start,
        l.parent_page_end,
        l.child_page_count,
        l.parent_content_sha256
      FROM material_split_lineage l
      JOIN study_materials m ON m.id = l.material_id
      WHERE l.parent_material_id = ?
        AND l.parent_content_sha256 = ?
        AND l.material_id != ?
      ORDER BY COALESCE(l.parent_page_start, l.source_page_start) ASC, m.title ASC
    `;
    params = [parentId, parentHash, materialId];
  } else {
    query = `
      SELECT
        m.id,
        m.title,
        l.source_page_start,
        l.source_page_end,
        l.parent_page_start,
        l.parent_page_end,
        l.child_page_count,
        l.parent_content_sha256
      FROM material_split_lineage l
      JOIN study_materials m ON m.id = l.material_id
      WHERE l.parent_material_id = ?
        AND (l.parent_content_sha256 IS NULL OR l.parent_content_sha256 = '')
        AND l.material_id != ?
      ORDER BY COALESCE(l.parent_page_start, l.source_page_start) ASC, m.title ASC
    `;
    params = [parentId, materialId];
  }

  const rows = db.prepare(query).all(...params);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    sourcePageStart: r.source_page_start,
    sourcePageEnd: r.source_page_end,
    parentPageStart: r.parent_page_start,
    parentPageEnd: r.parent_page_end,
    childPageCount: r.child_page_count,
  }));
}

/**
 * Validates and atomically saves a batch of split parts with materials, tags, and lineage.
 * If validation fails or any insert throws, rolls back completely and invokes cleanup.
 *
 * @param {DatabaseSync} db
 * @param {{
 *   parentMaterialId: string,
 *   expectedParentSha256?: string|null,
 *   currentParentBytes?: Buffer|string|null,
 *   parts: Array<{
 *     id: string,
 *     title: string,
 *     filePath?: string,
 *     originalFileName?: string,
 *     fileSize?: number,
 *     sourcePageStart: number,
 *     sourcePageEnd: number,
 *     parentPageStart?: number,
 *     parentPageEnd?: number,
 *     rootMaterialId?: string,
 *     sourceFileName: string,
 *     sourceTitle: string,
 *     sourceContentSha256?: string,
 *     sourceTotalPages?: number,
 *     parentFileName?: string,
 *     parentTitle?: string,
 *     parentContentSha256?: string,
 *     parentTotalPages?: number,
 *     nestedLevel?: number,
 *   }>,
 *   tags?: Array<{ tagId: string, name: string }>,
 *   onRollbackCleanup?: () => void,
 * }} param1
 */
export function validateAndSaveSplitBatch(db, {
  parentMaterialId,
  expectedParentSha256 = null,
  currentParentBytes = null,
  parts = [],
  tags = [],
  onRollbackCleanup = null,
}) {
  try {
    const parent = db.prepare("SELECT * FROM study_materials WHERE id = ?").get(parentMaterialId);
    if (!parent) {
      throw new Error(`Parent material ${parentMaterialId} does not exist in library.`);
    }

    // Stale-source validation
    if (expectedParentSha256) {
      if (currentParentBytes) {
        const currentHash = calculateSha256(currentParentBytes);
        if (currentHash.toLowerCase() !== expectedParentSha256.toLowerCase()) {
          throw new Error("Stale source: parent material content hash has changed since split was initiated.");
        }
      }
    }

    if (!parts || parts.length === 0) {
      throw new Error("Split batch must contain at least one part.");
    }

    // Pre-validate part ranges
    for (const part of parts) {
      const rangeVal = validatePageRange(part.sourcePageStart, part.sourcePageEnd, part.sourceTotalPages);
      if (!rangeVal.ok) {
        throw new Error(`Invalid page range for part ${part.id}: ${rangeVal.error}`);
      }
      if (part.parentPageStart !== undefined && part.parentPageEnd !== undefined) {
        const parentRangeVal = validatePageRange(part.parentPageStart, part.parentPageEnd, part.parentTotalPages);
        if (!parentRangeVal.ok) {
          throw new Error(`Invalid parent page range for part ${part.id}: ${parentRangeVal.error}`);
        }
      }
    }

    db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      for (const part of parts) {
        insertMaterial(db, {
          id: part.id,
          title: part.title,
          filePath: part.filePath,
          originalFileName: part.originalFileName,
          fileSize: part.fileSize,
        });

        for (const t of tags) {
          db.prepare("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)").run(t.tagId, t.name, new Date().toISOString());
          db.prepare("INSERT OR IGNORE INTO material_tags (material_id, tag_id) VALUES (?, ?)").run(part.id, t.tagId);
        }

        insertSplitLineage(db, {
          materialId: part.id,
          parentMaterialId,
          rootMaterialId: part.rootMaterialId || parentMaterialId,
          sourcePageStart: part.sourcePageStart,
          sourcePageEnd: part.sourcePageEnd,
          parentPageStart: part.parentPageStart,
          parentPageEnd: part.parentPageEnd,
          childPageCount: part.sourcePageEnd - part.sourcePageStart + 1,
          sourceFileName: part.sourceFileName,
          sourceTitle: part.sourceTitle,
          sourceContentSha256: part.sourceContentSha256,
          sourceTotalPages: part.sourceTotalPages,
          parentFileName: part.parentFileName,
          parentTitle: part.parentTitle,
          parentContentSha256: part.parentContentSha256,
          parentTotalPages: part.parentTotalPages,
          nestedLevel: part.nestedLevel || 1,
        });
      }

      db.exec("COMMIT;");
      return { ok: true, savedPartsCount: parts.length };
    } catch (txErr) {
      try {
        db.exec("ROLLBACK;");
      } catch {
        // rollback error suppressed
      }
      throw txErr;
    }
  } catch (err) {
    if (typeof onRollbackCleanup === "function") {
      try {
        onRollbackCleanup();
      } catch {
        // cleanup error suppressed
      }
    }
    throw err;
  }
}

/**
 * Pure simulation of the application's older binary restore refusal check.
 * This explicitly models src-tauri/src/backup.rs:631 without claiming
 * a native binary for a future schema has been compiled or tested.
 */
export function simulateOlderBinaryRestore(newestMigration, currentBinarySchema) {
  if (newestMigration > currentBinarySchema) {
    return {
      ok: false,
      error: `That backup was made by a newer version of Her Flight Deck (database schema ${newestMigration}, this version reads up to ${currentBinarySchema}). Update the application to restore it.`,
    };
  }
  return { ok: true };
}
