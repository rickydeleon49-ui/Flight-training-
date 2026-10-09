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
  const envDir = process.env.SHIPPED_MIGRATIONS_DIR;
  if (envDir && existsSync(envDir) && existsSync(join(envDir, "0001_initial_schema.sql"))) {
    return envDir;
  }
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
 * Enforces positive 1-based safe integers:
 * firstPage >= 1, lastPage >= firstPage, totalPages >= lastPage.
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
 * Explicit bounded representation:
 * Can be called with positional arguments:
 *   mapChildPageToSource(childPage, sourcePageStart, sourceEndOrChildLength, explicitChildLength)
 * Or with an explicit options object as the 3rd argument:
 *   mapChildPageToSource(childPage, sourcePageStart, { sourcePageEnd, childLength })
 *
 * Bound enforcement notes:
 * - JavaScript engine enforces IEEE 754 safe integers (up to Number.MAX_SAFE_INTEGER = 2^53 - 1).
 * - SQLite integer storage accommodates signed 64-bit integers (up to 2^63 - 1).
 * - PDF specifications (ISO 32000-1 / 32000-2) and standard PDF engines constrain page counts to
 *   positive 32-bit signed integers (up to 2,147,483,647), with practical document sizes under 100,000 pages.
 *
 * @param {number} childPage 1-based page in the child document
 * @param {number} sourcePageStart 1-based start page in the source document
 * @param {number|object} [sourceEndOrChildLength] recorded range end in source OR child length OR options object
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

  if (sourceEndOrChildLength !== null && typeof sourceEndOrChildLength === "object") {
    // Explicit options object { sourcePageEnd, childLength }
    const opts = sourceEndOrChildLength;
    if (opts.childLength !== undefined && opts.childLength !== null) {
      if (typeof opts.childLength !== "number" || !Number.isSafeInteger(opts.childLength) || opts.childLength < 1) {
        throw new Error("Child length must be a positive integer >= 1.");
      }
      childLength = opts.childLength;
    } else if (opts.sourcePageEnd !== undefined && opts.sourcePageEnd !== null) {
      if (typeof opts.sourcePageEnd !== "number" || !Number.isSafeInteger(opts.sourcePageEnd) || opts.sourcePageEnd < sourcePageStart) {
        throw new Error(`sourcePageEnd must be an integer >= sourcePageStart (${sourcePageStart}).`);
      }
      childLength = opts.sourcePageEnd - sourcePageStart + 1;
    }
  } else if (explicitChildLength !== null && explicitChildLength !== undefined) {
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
 * Canonical example (SL-R4.4):
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
      details: "Current file contents could not be read or hashed.",
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

  // Track migrations using the app's real migration tables
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
  const derivedChildCount = childPageCount || (sourcePageEnd - sourcePageStart + 1);

  db.prepare(`
    INSERT INTO material_split_lineage (
      material_id, parent_material_id, root_material_id,
      source_page_start, source_page_end,
      parent_page_start, parent_page_end,
      child_page_count,
      source_file_name, source_title, source_content_sha256, source_total_pages,
      parent_file_name, parent_title, parent_content_sha256, parent_total_pages,
      nested_level, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    materialId, parentMaterialId, rootMaterialId,
    sourcePageStart, sourcePageEnd,
    parentPageStart, parentPageEnd,
    derivedChildCount,
    sourceFileName, sourceTitle, sourceContentSha256, sourceTotalPages,
    parentFileName, parentTitle, parentContentSha256, parentTotalPages,
    nestedLevel, createdAt
  );
}

/**
 * Reads a study material alongside its split lineage and source version statuses.
 *
 * SL-R4 Resolution:
 * For direct splits (nestedLevel = 1 or immediate parent is root), the immediate parent
 * IS the root document, so effective immediate parent hash is source_content_sha256.
 * For nested splits (nestedLevel > 1), immediate parent hash is parent_content_sha256,
 * while root hash is source_content_sha256.
 *
 * Evaluates both parentStatus and rootStatus distinctly.
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
      p.file_path AS live_parent_file_path,
      r.title AS live_root_title,
      r.file_path AS live_root_file_path
    FROM study_materials m
    LEFT JOIN material_split_lineage l ON l.material_id = m.id
    LEFT JOIN study_materials p ON p.id = l.parent_material_id
    LEFT JOIN study_materials r ON r.id = l.root_material_id
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

  // Determine if this is a direct split or nested split
  const isDirectSplit = (row.nested_level === 1) || (!row.parent_page_start && row.parent_material_id === row.root_material_id) || (!row.parent_content_sha256 && !!row.source_content_sha256);

  // Effective immediate parent hash: for direct split, use root hash; for nested, use parent hash
  const effectiveParentHash = row.parent_content_sha256 || (isDirectSplit ? row.source_content_sha256 : null);

  // Evaluate immediate parent status
  let parentStatus = "unknown";
  let parentVersionDetails = "";
  if (!row.parent_material_id || !row.live_parent_title) {
    parentStatus = "deleted";
    parentVersionDetails = "Immediate parent material was deleted from the library.";
  } else {
    const fileExists = options.fileExists ?? true;
    const currentBytes = options.currentFileBytes ?? null;
    const evaluation = evaluateSourceVersion({
      recordedHash: effectiveParentHash,
      currentBytes,
      currentHash: options.currentHash ?? null,
      fileExists,
      materialExists: true,
    });
    parentStatus = evaluation.status;
    parentVersionDetails = evaluation.details;
  }

  // Evaluate root status distinctly
  let rootStatus = "unknown";
  let rootVersionDetails = "";
  if (!row.root_material_id || !row.live_root_title) {
    rootStatus = "deleted";
    rootVersionDetails = "Root material was deleted from the library.";
  } else if (isDirectSplit) {
    // For direct split, root is the immediate parent
    rootStatus = parentStatus;
    rootVersionDetails = parentVersionDetails;
  } else {
    // For nested split, evaluate original root separately
    const rootFileExists = options.rootFileExists ?? true;
    const currentRootBytes = options.currentRootBytes ?? null;
    const rootEvaluation = evaluateSourceVersion({
      recordedHash: row.source_content_sha256,
      currentBytes: currentRootBytes,
      currentHash: options.currentRootHash ?? null,
      fileExists: rootFileExists,
      materialExists: true,
    });
    rootStatus = rootEvaluation.status;
    rootVersionDetails = rootEvaluation.details;
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
      rootStatus,
      rootVersionDetails,
      liveParentTitle: row.live_parent_title,
      liveParentFilePath: row.live_parent_file_path,
      liveRootTitle: row.live_root_title,
      liveRootFilePath: row.live_root_file_path,
    },
  };
}

/**
 * Lists siblings of a split part sharing the same immediate parent and matching edition hash.
 *
 * SL-R4 Rules:
 * 1. Immediate parent matching: l.parent_material_id = ?
 * 2. Edition isolation: COALESCE(l.parent_content_sha256, l.source_content_sha256) = effectiveParentHash.
 *    For direct splits, parts split from different root editions of the same material ID never mix.
 * 3. Conservative unknown policy: if current part has no recorded hash, return []
 *    (unknown hashes never establish edition equality).
 * 4. Independently imported materials (different parentMaterialId) remain strictly isolated.
 */
export function listSiblings(db, materialId) {
  const current = getMaterialWithLineage(db, materialId);
  if (!current?.lineage?.parentMaterialId) return [];

  const parentId = current.lineage.parentMaterialId;
  const effectiveParentHash = current.lineage.parentContentSha256 || current.lineage.sourceContentSha256;

  // Unknown hashes do not establish edition equality (conservative unknown policy)
  if (!effectiveParentHash) {
    return [];
  }

  const query = `
    SELECT
      m.id,
      m.title,
      l.source_page_start,
      l.source_page_end,
      l.parent_page_start,
      l.parent_page_end,
      l.child_page_count,
      COALESCE(l.parent_content_sha256, l.source_content_sha256) AS effective_parent_hash
    FROM material_split_lineage l
    JOIN study_materials m ON m.id = l.material_id
    WHERE l.parent_material_id = ?
      AND COALESCE(l.parent_content_sha256, l.source_content_sha256) = ?
      AND l.material_id != ?
    ORDER BY COALESCE(l.parent_page_start, l.source_page_start) ASC, m.title ASC
  `;

  const rows = db.prepare(query).all(parentId, effectiveParentHash, materialId);

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
 * If validation fails or any insert throws, rolls back completely and invokes onRollbackCleanup.
 *
 * SL-R5 Rules:
 * 1. Binds saves to authoritative source context.
 * 2. An expected hash with unavailable current verification (omitted/null currentParentBytes)
 *    refuses all writes and invokes cleanup.
 * 3. Stale source check: currentParentBytes hash must match expectedParentSha256.
 * 4. Derives or validates nested root range against parent's persisted lineage:
 *    parent covers root [pStart..pEnd]; child selects parent [cStart..cEnd];
 *    canonical root range is [pStart + cStart - 1 .. pStart + cEnd - 1].
 *    Rejects contradictory root ranges, IDs, totals, or levels.
 *
 * @param {DatabaseSync} db
 * @param {{
 *   parentMaterialId: string,
 *   expectedParentSha256?: string|null,
 *   currentParentBytes?: Buffer|Uint8Array|string|null,
 *   parts: Array<{
 *     id: string,
 *     title: string,
 *     sourcePageStart?: number,
 *     sourcePageEnd?: number,
 *     parentPageStart?: number,
 *     parentPageEnd?: number,
 *     childPageCount?: number,
 *     sourceFileName?: string,
 *     sourceTitle?: string,
 *     rootMaterialId?: string,
 *     sourceContentSha256?: string,
 *     sourceTotalPages?: number,
 *     parentFileName?: string,
 *     parentTitle?: string,
 *     parentContentSha256?: string,
 *     parentTotalPages?: number,
 *     nestedLevel?: number,
 *     filePath?: string,
 *     fileSize?: number,
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
  const invokeCleanup = () => {
    if (typeof onRollbackCleanup === "function") {
      try { onRollbackCleanup(); } catch (_) {}
    }
  };

  try {
    const parent = db.prepare("SELECT * FROM study_materials WHERE id = ?").get(parentMaterialId);
    if (!parent) {
      throw new Error(`Parent material ${parentMaterialId} does not exist in library.`);
    }

    // SL-R5: Expected hash with unavailable current verification refuses all writes
    if (expectedParentSha256) {
      if (!currentParentBytes) {
        throw new Error("Source verification unavailable: current source bytes/hash required when expectedParentSha256 is specified.");
      }
      const currentHash = calculateSha256(currentParentBytes);
      if (currentHash.toLowerCase() !== expectedParentSha256.toLowerCase()) {
        throw new Error("Stale source: parent material content hash has changed since split was initiated.");
      }
    }

    if (!parts || parts.length === 0) {
      throw new Error("Split batch must contain at least one part.");
    }

    // Check if the parent material itself has split lineage (meaning this is a nested split)
    const parentLineage = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = ?").get(parentMaterialId);

    const preparedParts = [];

    if (parentLineage) {
      // ----------------------------------------------------------------------
      // NESTED SPLIT: Parent A was already split from Root R
      // ----------------------------------------------------------------------
      const parentPageCount = parentLineage.child_page_count;
      const expectedRootId = parentLineage.root_material_id || parentLineage.parent_material_id;
      const expectedLevel = parentLineage.nested_level + 1;

      for (const part of parts) {
        if (part.parentPageStart === undefined || part.parentPageEnd === undefined) {
          throw new Error(`Nested split part ${part.id} must specify parentPageStart and parentPageEnd.`);
        }

        const parentRangeVal = validatePageRange(part.parentPageStart, part.parentPageEnd, parentPageCount);
        if (!parentRangeVal.ok) {
          throw new Error(`Invalid parent page range for part ${part.id}: ${parentRangeVal.error}`);
        }

        if (part.parentTotalPages !== undefined && part.parentTotalPages !== null && part.parentTotalPages !== parentPageCount) {
          throw new Error(`Nested part parentTotalPages ${part.parentTotalPages} contradicts parent length ${parentPageCount}.`);
        }

        // Canonical derived root coordinates:
        // parent covers root [pStart..pEnd]; child selects parent [cStart..cEnd]
        // canonical child in root covers [pStart + cStart - 1 .. pStart + cEnd - 1]
        const derivedRootStart = parentLineage.source_page_start + part.parentPageStart - 1;
        const derivedRootEnd = parentLineage.source_page_start + part.parentPageEnd - 1;

        if (part.sourcePageStart !== undefined && part.sourcePageStart !== null && part.sourcePageStart !== derivedRootStart) {
          throw new Error(`Nested part sourcePageStart ${part.sourcePageStart} contradicts parent-derived root start ${derivedRootStart}.`);
        }
        if (part.sourcePageEnd !== undefined && part.sourcePageEnd !== null && part.sourcePageEnd !== derivedRootEnd) {
          throw new Error(`Nested part sourcePageEnd ${part.sourcePageEnd} contradicts parent-derived root end ${derivedRootEnd}.`);
        }
        if (part.rootMaterialId && part.rootMaterialId !== expectedRootId) {
          throw new Error(`Nested part rootMaterialId ${part.rootMaterialId} contradicts parent rootMaterialId ${expectedRootId}.`);
        }
        if (part.sourceTotalPages !== undefined && part.sourceTotalPages !== null && part.sourceTotalPages !== parentLineage.source_total_pages) {
          throw new Error(`Nested part sourceTotalPages ${part.sourceTotalPages} contradicts parent sourceTotalPages ${parentLineage.source_total_pages}.`);
        }
        if (part.nestedLevel !== undefined && part.nestedLevel !== null && part.nestedLevel !== expectedLevel) {
          throw new Error(`Nested part nestedLevel ${part.nestedLevel} contradicts expected level ${expectedLevel}.`);
        }

        const childLength = part.parentPageEnd - part.parentPageStart + 1;

        preparedParts.push({
          ...part,
          sourcePageStart: derivedRootStart,
          sourcePageEnd: derivedRootEnd,
          parentPageStart: part.parentPageStart,
          parentPageEnd: part.parentPageEnd,
          childPageCount: childLength,
          rootMaterialId: expectedRootId,
          sourceFileName: part.sourceFileName || parentLineage.source_file_name,
          sourceTitle: part.sourceTitle || parentLineage.source_title,
          sourceContentSha256: part.sourceContentSha256 || parentLineage.source_content_sha256,
          sourceTotalPages: parentLineage.source_total_pages,
          parentFileName: part.parentFileName || parent.original_file_name || parent.file_path || "parent.pdf",
          parentTitle: part.parentTitle || parent.title,
          parentContentSha256: part.parentContentSha256 || expectedParentSha256 || (currentParentBytes ? calculateSha256(currentParentBytes) : null),
          parentTotalPages: parentPageCount,
          nestedLevel: expectedLevel,
        });
      }
    } else {
      // ----------------------------------------------------------------------
      // DIRECT SPLIT: Immediate parent is the root document (nestedLevel = 1)
      // ----------------------------------------------------------------------
      for (const part of parts) {
        const rangeVal = validatePageRange(part.sourcePageStart, part.sourcePageEnd, part.sourceTotalPages);
        if (!rangeVal.ok) {
          throw new Error(`Invalid page range for part ${part.id}: ${rangeVal.error}`);
        }
        if (part.rootMaterialId && part.rootMaterialId !== parentMaterialId) {
          throw new Error(`Direct split rootMaterialId must match parentMaterialId.`);
        }
        if (part.nestedLevel !== undefined && part.nestedLevel !== null && part.nestedLevel !== 1) {
          throw new Error(`Direct split nestedLevel must be 1.`);
        }

        const childLength = part.sourcePageEnd - part.sourcePageStart + 1;

        preparedParts.push({
          ...part,
          sourcePageStart: part.sourcePageStart,
          sourcePageEnd: part.sourcePageEnd,
          parentPageStart: null,
          parentPageEnd: null,
          childPageCount: childLength,
          rootMaterialId: parentMaterialId,
          sourceFileName: part.sourceFileName || parent.original_file_name || parent.file_path || "root.pdf",
          sourceTitle: part.sourceTitle || parent.title,
          sourceContentSha256: part.sourceContentSha256 || expectedParentSha256 || (currentParentBytes ? calculateSha256(currentParentBytes) : null),
          sourceTotalPages: part.sourceTotalPages || null,
          parentFileName: null,
          parentTitle: null,
          parentContentSha256: null,
          parentTotalPages: null,
          nestedLevel: 1,
        });
      }
    }

    // Atomic transaction execution
    db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      const now = new Date().toISOString();

      // Ensure tags exist in tags table
      for (const tag of tags) {
        db.prepare(`
          INSERT INTO tags (id, name, created_at)
          VALUES (?, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `).run(tag.tagId, tag.name, now);
      }

      for (const part of preparedParts) {
        // Insert child study material
        insertMaterial(db, {
          id: part.id,
          title: part.title,
          materialType: "study_guide",
          topic: parent.topic || "general",
          notes: `Split from ${parent.title} (${part.sourcePageStart}–${part.sourcePageEnd})`,
          filePath: part.filePath || parent.file_path,
          originalFileName: part.sourceFileName,
          fileSize: part.fileSize || 0,
          createdAt: now,
          updatedAt: now,
        });

        // Insert tag relationships
        for (const tag of tags) {
          db.prepare(`
            INSERT INTO material_tags (material_id, tag_id)
            VALUES (?, ?)
            ON CONFLICT(material_id, tag_id) DO NOTHING
          `).run(part.id, tag.tagId);
        }

        // Insert split lineage row
        insertSplitLineage(db, {
          materialId: part.id,
          parentMaterialId,
          rootMaterialId: part.rootMaterialId,
          sourcePageStart: part.sourcePageStart,
          sourcePageEnd: part.sourcePageEnd,
          parentPageStart: part.parentPageStart,
          parentPageEnd: part.parentPageEnd,
          childPageCount: part.childPageCount,
          sourceFileName: part.sourceFileName,
          sourceTitle: part.sourceTitle,
          sourceContentSha256: part.sourceContentSha256,
          sourceTotalPages: part.sourceTotalPages,
          parentFileName: part.parentFileName,
          parentTitle: part.parentTitle,
          parentContentSha256: part.parentContentSha256,
          parentTotalPages: part.parentTotalPages,
          nestedLevel: part.nestedLevel,
          createdAt: now,
        });
      }

      db.exec("COMMIT TRANSACTION;");

      return {
        ok: true,
        savedPartsCount: preparedParts.length,
        parts: preparedParts,
      };
    } catch (txError) {
      db.exec("ROLLBACK TRANSACTION;");
      invokeCleanup();
      throw txError;
    }
  } catch (error) {
    invokeCleanup();
    throw error;
  }
}

/**
 * Reconciles an acknowledged split save followed by a failed UI/cache refresh.
 *
 * Guaranteed to be idempotent and read-only:
 * Re-reads previously saved parts without creating duplicates or resplitting.
 *
 * @param {DatabaseSync} db
 * @param {{ savedPartIds: string[], expectedParentMaterialId: string }} param1
 * @returns {{ reconciled: boolean, parts: Array<object> }}
 */
export function reconcileFailedRefresh(db, { savedPartIds, expectedParentMaterialId }) {
  if (!Array.isArray(savedPartIds) || savedPartIds.length === 0) {
    return { reconciled: false, parts: [] };
  }

  const parts = [];
  for (const partId of savedPartIds) {
    const item = getMaterialWithLineage(db, partId);
    if (item && item.lineage && item.lineage.parentMaterialId === expectedParentMaterialId) {
      parts.push(item);
    }
  }

  const reconciled = parts.length === savedPartIds.length;
  return { reconciled, parts };
}

/**
 * Simulates older binary restore check behavior (src-tauri/src/backup.rs:631 numeric check).
 *
 * Explicitly labeled as a numeric boundary check simulation:
 * Confirms that backup archives stamped with schema version 13 are refused by an older binary
 * expecting schema <= 12, protecting against silent corruption.
 *
 * @param {number} backupSchemaVersion
 * @returns {{ allowed: boolean, reason: string }}
 */
export function simulateOlderBinaryNumericCheck(backupSchemaVersion) {
  const OLDER_BINARY_MAX_SCHEMA = 12;

  if (typeof backupSchemaVersion !== "number" || !Number.isSafeInteger(backupSchemaVersion)) {
    return { allowed: false, reason: "Invalid schema version format: non-integer" };
  }

  if (backupSchemaVersion > OLDER_BINARY_MAX_SCHEMA) {
    return {
      allowed: false,
      reason: `Backup schema version ${backupSchemaVersion} exceeds maximum supported version ${OLDER_BINARY_MAX_SCHEMA}. Please update the application.`,
    };
  }

  return { allowed: true, reason: "Schema version is compatible with binary." };
}
