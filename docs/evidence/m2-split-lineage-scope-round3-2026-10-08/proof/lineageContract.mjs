// Round 3 Corrected Split-Source Lineage Model and Contract Implementation
// Milestone 2 (M2) — Her Flight Deck
// Addresses SL-R7, SL-R8, SL-R9

import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const ENGINE_LIMITS = Object.freeze({
  MIN_PAGE: 1,
  MAX_PAGE: 10_000,
  MAX_PARTS_PER_BATCH: 200,
  MIN_PART_LENGTH: 1,
});

/**
 * Computes deterministic SHA-256 hex digest of a Buffer or string.
 * @param {Buffer | string} data
 * @returns {string}
 */
export function calculateSha256(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Validates a physical page range.
 */
export function validatePageRange(start, end, totalPages = null) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error(`Page range bounds must be integers: start=${start}, end=${end}`);
  }
  if (start < ENGINE_LIMITS.MIN_PAGE) {
    throw new Error(`Start page (${start}) must be >= ${ENGINE_LIMITS.MIN_PAGE}`);
  }
  if (end < start) {
    throw new Error(`End page (${end}) cannot be less than start page (${start})`);
  }
  if (end > ENGINE_LIMITS.MAX_PAGE) {
    throw new Error(`End page (${end}) exceeds maximum allowed pages (${ENGINE_LIMITS.MAX_PAGE})`);
  }
  if (totalPages !== null) {
    if (!Number.isInteger(totalPages) || totalPages < 1) {
      throw new Error(`Total pages (${totalPages}) must be a positive integer`);
    }
    if (end > totalPages) {
      throw new Error(`End page (${end}) exceeds total pages (${totalPages})`);
    }
  }
  return { start, end, pageCount: end - start + 1 };
}

/**
 * Modern named options API for mapping child page to source.
 * @param {{
 *   childPage?: number,
 *   sourcePageStart: number,
 *   childPageCount?: number,
 *   childPageEnd?: number,
 *   start?: number,
 *   end?: number,
 *   sourceStart?: number
 * }} options
 * @returns {number}
 */
export function mapChildPageToSource(options) {
  // If invoked with legacy positional arguments, delegate to positional adapter
  if (arguments.length > 1 || typeof options === "number") {
    return mapChildPageToSourcePositional(arguments[0], arguments[1], arguments[2]);
  }

  const childPage = options.childPage ?? options.start ?? 1;
  const sourceStart = options.sourcePageStart ?? options.sourceStart;
  if (!Number.isInteger(sourceStart) || sourceStart < 1) {
    throw new Error(`Invalid sourceStart: ${sourceStart}`);
  }
  if (!Number.isInteger(childPage) || childPage < 1) {
    throw new Error(`Invalid childPage: ${childPage}`);
  }

  const count = options.childPageCount ??
    (options.childPageEnd ? options.childPageEnd - sourceStart + 1 :
      (options.end ? options.end - options.start + 1 : null));

  if (count !== null && count !== undefined) {
    if (childPage > count) {
      throw new Error(`Child page ${childPage} exceeds child page count ${count}`);
    }
  }

  return sourceStart + childPage - 1;
}

/**
 * Narrow, named compatibility adapter for positional calls from frozen suites.
 * Positional signature: (sourcePageStart, childPage, parentTotalPagesOrEnd)
 */
export function mapChildPageToSourcePositional(sourcePageStart, childPage, parentTotalPagesOrEnd = null) {
  if (!Number.isInteger(sourcePageStart) || sourcePageStart < 1) {
    throw new Error(`Invalid sourcePageStart: ${sourcePageStart}`);
  }
  if (!Number.isInteger(childPage) || childPage < 1) {
    throw new Error(`Invalid childPage: ${childPage}`);
  }

  if (parentTotalPagesOrEnd !== null) {
    let bound = parentTotalPagesOrEnd;
    if (parentTotalPagesOrEnd >= sourcePageStart) {
      bound = parentTotalPagesOrEnd - sourcePageStart + 1;
    }
    if (childPage > bound) {
      throw new Error(`Child page ${childPage} exceeds bound ${bound}`);
    }
  }

  return sourcePageStart + childPage - 1;
}

/**
 * Composes a child part selection relative to its parent's range.
 * Formula: S_R = S_A + s_c - 1, E_R = S_A + e_c - 1
 */
export function composeNestedRanges(parentRange, childSelection) {
  const p = validatePageRange(parentRange.start, parentRange.end, parentRange.totalPages || null);
  const parentLength = p.end - p.start + 1;
  const c = validatePageRange(childSelection.start, childSelection.end, parentLength);

  const rootStart = p.start + c.start - 1;
  const rootEnd = p.start + c.end - 1;
  const childLength = c.end - c.start + 1;

  return {
    rootPageStart: rootStart,
    rootPageEnd: rootEnd,
    parentPageStart: c.start,
    parentPageEnd: c.end,
    childPageCount: childLength,
  };
}

/**
 * Transitive multi-level nested range composition.
 */
export function composeMultiLevelRanges(levels) {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error("Multi-level composition requires at least one range level");
  }
  let currentRootRange = {
    start: levels[0].start,
    end: levels[0].end,
    totalPages: levels[0].totalPages || null,
  };
  for (let i = 1; i < levels.length; i++) {
    const composed = composeNestedRanges(currentRootRange, levels[i]);
    currentRootRange = {
      start: composed.rootPageStart,
      end: composed.rootPageEnd,
      totalPages: levels[0].totalPages || null,
    };
  }
  return currentRootRange;
}

/**
 * Finds shipped migrations directory (0001 - 0012).
 */
export function findShippedMigrationsDir() {
  const envDir = process.env.SHIPPED_MIGRATIONS_DIR;
  if (envDir && existsSync(envDir) && existsSync(join(envDir, "0001_initial_schema.sql"))) {
    return envDir;
  }
  const candidates = [
    join(__dirname, "../../../../src-tauri/migrations"),
    join(__dirname, "../../../../../src-tauri/migrations"),
    join(process.cwd(), "src-tauri/migrations"),
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
 * Creates an in-memory SQLite database initialized with shipped migrations 0001-0012,
 * optionally applying candidate migration 0013.
 */
export function createDisposableLineageDb(applyMigration0013 = true, options = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec("CREATE TABLE IF NOT EXISTS _sqlx_migrations (version INTEGER PRIMARY KEY);");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);");

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

  // Create an operation tracking table for idempotency and reconciliation (SL-R9)
  db.exec(`
    CREATE TABLE IF NOT EXISTS split_operation_log (
      operation_id TEXT PRIMARY KEY,
      source_material_id TEXT NOT NULL,
      status TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  if (applyMigration0013) {
    const ddlPath = options.candidateMigrationPath || join(__dirname, "../candidate_migration_0013.sql");
    const ddlSql = readFileSync(ddlPath, "utf8");
    db.exec(ddlSql);
    db.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (13)").run();
  }

  return db;
}

/**
 * Inserts a minimal study material record.
 */
export function insertMaterial(db, material) {
  const stmt = db.prepare(`
    INSERT INTO study_materials (
      id, title, material_type, topic, review_status, priority,
      notes, file_path, original_file_name, file_size, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  stmt.run(
    material.id,
    material.title,
    material.materialType || "study_guide",
    material.topic || "general",
    material.reviewStatus || "needs_review",
    material.priority || "later",
    material.notes || "",
    material.filePath || null,
    material.originalFileName || null,
    material.fileSize || null
  );
  return material.id;
}

/**
 * Inserts a split lineage row into material_split_lineage.
 */
export function insertSplitLineage(db, lineage) {
  const childPageCount = lineage.childPageCount || (lineage.sourcePageEnd - lineage.sourcePageStart + 1);
  const stmt = db.prepare(`
    INSERT INTO material_split_lineage (
      material_id, parent_material_id, root_material_id,
      source_page_start, source_page_end, parent_page_start, parent_page_end,
      child_page_count, source_file_name, source_title, source_content_sha256,
      source_total_pages, parent_file_name, parent_title, parent_content_sha256,
      parent_total_pages, nested_level, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(
    lineage.materialId,
    lineage.parentMaterialId ?? null,
    lineage.rootMaterialId ?? null,
    lineage.sourcePageStart,
    lineage.sourcePageEnd,
    lineage.parentPageStart ?? null,
    lineage.parentPageEnd ?? null,
    childPageCount,
    lineage.sourceFileName,
    lineage.sourceTitle,
    lineage.sourceContentSha256 ?? null,
    lineage.sourceTotalPages ?? null,
    lineage.parentFileName ?? null,
    lineage.parentTitle ?? null,
    lineage.parentContentSha256 ?? null,
    lineage.parentTotalPages ?? null,
    lineage.nestedLevel ?? 1
  );
}

/**
 * SL-R7: Produces an authoritative, typed SplitSourceReceipt.
 * This is the only accepted provenance input to validateAndSaveSplitBatch.
 *
 * @param {DatabaseSync} db
 * @param {{
 *   sourceMaterialId: string,
 *   sourceFilePath?: string,
 *   sourceBytes?: Buffer,
 *   sourceTotalPages: number,
 *   plan: Array<{ id: string, title?: string, selection: { start: number, end: number }, filePath?: string, fileSize?: number }>
 * }} param1
 * @returns {SplitSourceReceipt}
 */
export function createSplitSourceReceipt(db, {
  sourceMaterialId,
  sourceFilePath = null,
  sourceBytes = null,
  sourceTotalPages,
  plan = [],
}) {
  if (!sourceMaterialId) {
    throw new Error("SplitSourceReceipt requires a sourceMaterialId");
  }
  const sourceMat = db.prepare("SELECT * FROM study_materials WHERE id = ?").get(sourceMaterialId);
  if (!sourceMat) {
    throw new Error(`Source material ${sourceMaterialId} does not exist in library`);
  }

  const effectivePath = sourceFilePath || sourceMat.file_path || null;
  let effectiveBytes = sourceBytes;
  let fileSize = sourceMat.file_size || null;

  if (effectivePath && existsSync(effectivePath)) {
    const stats = statSync(effectivePath);
    fileSize = stats.size;
    effectiveBytes = readFileSync(effectivePath);
  }

  if (!effectiveBytes) {
    throw new Error(`Source bytes or readable file required to generate SplitSourceReceipt for ${sourceMaterialId}`);
  }

  const sourceContentSha256 = calculateSha256(effectiveBytes);

  if (!Number.isInteger(sourceTotalPages) || sourceTotalPages < 1) {
    throw new Error(`Invalid sourceTotalPages: ${sourceTotalPages}`);
  }

  // Check if source is nested
  const parentLineage = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = ?").get(sourceMaterialId);
  const isNested = !!parentLineage;

  let rootMaterialId = sourceMaterialId;
  let rootTitle = sourceMat.title;
  let rootFileName = sourceMat.original_file_name || (effectivePath ? basename(effectivePath) : "source.pdf");
  let rootContentSha256 = sourceContentSha256;
  let rootTotalPages = sourceTotalPages;
  let parentRootPageStart = null;
  let parentRootPageEnd = null;
  let parentTotalPages = null;
  let nestedLevel = 1;

  if (isNested) {
    rootMaterialId = parentLineage.root_material_id;
    rootTitle = parentLineage.source_title;
    rootFileName = parentLineage.source_file_name;
    rootContentSha256 = parentLineage.source_content_sha256;
    rootTotalPages = parentLineage.source_total_pages;
    parentRootPageStart = parentLineage.source_page_start;
    parentRootPageEnd = parentLineage.source_page_end;
    parentTotalPages = parentLineage.child_page_count;
    nestedLevel = (parentLineage.nested_level || 1) + 1;
  }

  // Validate plan selections against source authoritative total
  const maxAllowed = isNested ? parentTotalPages : sourceTotalPages;
  const validatedPlan = plan.map((p) => {
    const s = p.selection.start;
    const e = p.selection.end;
    if (s < 1 || e < s || e > maxAllowed) {
      throw new Error(`Selection ${s}–${e} exceeds authoritative source limit ${maxAllowed}`);
    }
    const count = e - s + 1;
    let canonicalRootStart = s;
    let canonicalRootEnd = e;
    if (isNested) {
      canonicalRootStart = parentRootPageStart + s - 1;
      canonicalRootEnd = parentRootPageStart + e - 1;
    }
    return {
      id: p.id,
      title: p.title || p.id,
      selection: { start: s, end: e },
      childPageCount: count,
      canonicalRootStart,
      canonicalRootEnd,
      filePath: p.filePath || null,
      fileSize: p.fileSize || null,
    };
  });

  const operationId = createHash("sha256")
    .update(sourceMaterialId + ":" + sourceContentSha256 + ":" + JSON.stringify(validatedPlan.map((p) => ({ id: p.id, s: p.selection.start, e: p.selection.end }))))
    .digest("hex");

  return Object.freeze({
    sourceMaterialId,
    sourceFilePath: effectivePath,
    sourceFileSize: fileSize,
    sourceContentSha256,
    sourceTotalPages,
    isNested,
    rootMaterialId,
    rootTitle,
    rootFileName,
    rootContentSha256,
    rootTotalPages,
    parentRootPageStart,
    parentRootPageEnd,
    parentTotalPages,
    nestedLevel,
    plan: validatedPlan,
    operationId,
  });
}

/**
 * Retrieves a material and its split lineage.
 * SL-R8:
 * - Structural tier classification: nested_level === 1 && parent_page_start === null => Direct split.
 * - Direct: effective immediate identity is root tier; parentStatus returns root verdict.
 * - Nested: immediate identity is parent tier only; NULL parent hash means parentStatus: unknown.
 * - Unknown never established through matching root bytes.
 */
export function getMaterialWithLineage(db, materialId, options = {}) {
  const material = db.prepare("SELECT * FROM study_materials WHERE id = ?").get(materialId);
  if (!material) return null;

  const lineage = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = ?").get(materialId);
  if (!lineage) {
    return { material, lineage: null };
  }

  const isDirectSplit = lineage.nested_level === 1 && lineage.parent_page_start === null;

  // Root tier evaluation
  let rootStatus = "unknown";
  if (!lineage.source_content_sha256) {
    rootStatus = "unknown";
  } else if (lineage.root_material_id) {
    const rootMat = db.prepare("SELECT * FROM study_materials WHERE id = ?").get(lineage.root_material_id);
    if (!rootMat) {
      rootStatus = "deleted";
    } else {
      const currentBytes = options.currentRootBytes || options.currentFileBytes;
      if (currentBytes) {
        rootStatus = calculateSha256(currentBytes) === lineage.source_content_sha256 ? "matching" : "changed";
      } else if (rootMat.file_path && existsSync(rootMat.file_path)) {
        const fileBytes = readFileSync(rootMat.file_path);
        rootStatus = calculateSha256(fileBytes) === lineage.source_content_sha256 ? "matching" : "changed";
      } else if (rootMat.file_path) {
        rootStatus = "missing";
      } else {
        rootStatus = "unknown";
      }
    }
  } else {
    // root_material_id is NULL (historical root deleted)
    rootStatus = "deleted";
  }

  // Parent tier evaluation
  let parentStatus = "unknown";
  if (isDirectSplit) {
    // Direct split: effective immediate identity is root tier
    parentStatus = rootStatus;
  } else {
    // Nested split: immediate identity is parent tier only
    if (!lineage.parent_content_sha256) {
      // SL-R8: A NULL parent hash means parentStatus: unknown, even when root bytes match!
      parentStatus = "unknown";
    } else if (lineage.parent_material_id) {
      const parentMat = db.prepare("SELECT * FROM study_materials WHERE id = ?").get(lineage.parent_material_id);
      if (!parentMat) {
        parentStatus = "deleted";
      } else {
        const currentBytes = options.currentParentBytes;
        if (currentBytes) {
          parentStatus = calculateSha256(currentBytes) === lineage.parent_content_sha256 ? "matching" : "changed";
        } else if (parentMat.file_path && existsSync(parentMat.file_path)) {
          const fileBytes = readFileSync(parentMat.file_path);
          parentStatus = calculateSha256(fileBytes) === lineage.parent_content_sha256 ? "matching" : "changed";
        } else if (parentMat.file_path) {
          parentStatus = "missing";
        } else {
          parentStatus = "unknown";
        }
      }
    } else {
      // parent_material_id is NULL (parent deleted)
      parentStatus = "deleted";
    }
  }

  return {
    id: material.id,
    title: material.title,
    filePath: material.file_path,
    originalFileName: material.original_file_name,
    fileSize: material.file_size,
    notes: material.notes,
    material,
    lineage: {
      ...lineage,
      parentMaterialId: lineage.parent_material_id,
      rootMaterialId: lineage.root_material_id,
      sourcePageStart: lineage.source_page_start,
      sourcePageEnd: lineage.source_page_end,
      parentPageStart: lineage.parent_page_start,
      parentPageEnd: lineage.parent_page_end,
      childPageCount: lineage.child_page_count,
      sourceFileName: lineage.source_file_name,
      sourceTitle: lineage.source_title,
      sourceContentSha256: lineage.source_content_sha256,
      sourceTotalPages: lineage.source_total_pages,
      parentFileName: lineage.parent_file_name,
      parentTitle: lineage.parent_title,
      parentContentSha256: lineage.parent_content_sha256,
      parentTotalPages: lineage.parent_total_pages,
      nestedLevel: lineage.nested_level,
      parentStatus,
      rootStatus,
      // Canonical user-facing overall status
      status: isDirectSplit ? rootStatus : (parentStatus === "matching" ? rootStatus : parentStatus),
    },
  };
}

/**
 * Lists sibling parts belonging to the same split generation.
 * SL-R8: Groups siblings on the same effective identity.
 * - Direct parts: root ID must match and root hash must match.
 * - Nested parts: parent ID must match and parent hash must match.
 * - Unknown NEVER matches anything, including another unknown.
 */
export function listSiblings(db, materialId) {
  const row = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = ?").get(materialId);
  if (!row) return [];

  const isDirectSplit = row.nested_level === 1 && row.parent_page_start === null;

  if (isDirectSplit) {
    const parentId = row.root_material_id || row.parent_material_id;
    const rootHash = row.source_content_sha256;
    if (!parentId || !rootHash) return [];

    return db.prepare(`
      SELECT m.*, l.source_page_start, l.source_page_end, l.child_page_count
      FROM study_materials m
      JOIN material_split_lineage l ON m.id = l.material_id
      WHERE l.nested_level = 1
        AND l.parent_page_start IS NULL
        AND COALESCE(l.root_material_id, l.parent_material_id) = ?
        AND l.source_content_sha256 = ?
        AND l.material_id != ?
      ORDER BY l.source_page_start ASC, m.id ASC
    `).all(parentId, rootHash, materialId);
  } else {
    const parentId = row.parent_material_id;
    const parentHash = row.parent_content_sha256;
    if (!parentId || !parentHash) return [];

    return db.prepare(`
      SELECT m.*, l.source_page_start, l.source_page_end, l.parent_page_start, l.parent_page_end, l.child_page_count
      FROM study_materials m
      JOIN material_split_lineage l ON m.id = l.material_id
      WHERE l.nested_level > 1
        AND l.parent_page_start IS NOT NULL
        AND l.parent_material_id = ?
        AND l.parent_content_sha256 = ?
        AND l.material_id != ?
      ORDER BY l.parent_page_start ASC, m.id ASC
    `).all(parentId, parentHash, materialId);
  }
}

/**
 * Validates and atomically saves a batch of split parts with materials, tags, and lineage.
 * Implements SL-R7, SL-R8, SL-R9:
 * 1. Mandatory provenance receipt or verified source context.
 * 2. On-disk source file recheck outside transaction (file-read boundary).
 * 3. Inside BEGIN IMMEDIATE: rechecks that source material exists and points to same file,
 *    and nested parent lineage snapshot is unchanged.
 * 4. Bound ranges by authoritative total; derive canonical nested root ranges.
 * 5. Cleanup runs exactly once per failed operation and only for its files.
 * 6. Idempotency via operation ID.
 */
export function validateAndSaveSplitBatch(db, options = {}) {
  let cleanupInvoked = false;
  const invokeCleanup = () => {
    if (!cleanupInvoked && typeof options.onRollbackCleanup === "function") {
      cleanupInvoked = true;
      try {
        options.onRollbackCleanup();
      } catch (_) {}
    }
  };

  try {
    const {
      receipt = null,
      parentMaterialId = receipt?.sourceMaterialId || null,
      expectedParentSha256 = receipt?.sourceContentSha256 || null,
      currentParentBytes = null,
      parts = receipt?.plan || [],
      tags = [],
      sourceTotalPages = receipt?.sourceTotalPages || null,
      operationId: providedOpId = receipt?.operationId || null,
    } = options;

    if (!parentMaterialId) {
      invokeCleanup();
      throw new Error("Missing parent material identity for split batch.");
    }

    // SL-R7: Refuse if neither a valid receipt nor verified source context is provided
    if (!receipt && !expectedParentSha256) {
      invokeCleanup();
      throw new Error("A new split without any verified source identity refuses all writes.");
    }

    if (!parts || parts.length === 0) {
      invokeCleanup();
      throw new Error("Split batch requires at least one part.");
    }

    if (parts.length > ENGINE_LIMITS.MAX_PARTS_PER_BATCH) {
      invokeCleanup();
      throw new Error(`Batch part count (${parts.length}) exceeds maximum limit (${ENGINE_LIMITS.MAX_PARTS_PER_BATCH}).`);
    }

    // Step 1: Pre-check source material existence
    const parentRow = db.prepare("SELECT * FROM study_materials WHERE id = ?").get(parentMaterialId);
    if (!parentRow) {
      invokeCleanup();
      throw new Error(`Source material ${parentMaterialId} does not exist in library.`);
    }

    // Step 2: File-read boundary check (OUTSIDE transaction)
    let verifiedHash = null;
    if (parentRow.file_path && existsSync(parentRow.file_path)) {
      const diskBytes = readFileSync(parentRow.file_path);
      const diskSha256 = calculateSha256(diskBytes);
      if (expectedParentSha256 && diskSha256 !== expectedParentSha256) {
        invokeCleanup();
        throw new Error("Stale on-disk source: current file on disk has changed and does not match expected hash.");
      }
      if (receipt && diskSha256 !== receipt.sourceContentSha256) {
        invokeCleanup();
        throw new Error("Stale on-disk source: current file on disk has changed and does not match receipt hash.");
      }
      verifiedHash = diskSha256;
    } else if (currentParentBytes) {
      const bytesSha256 = calculateSha256(currentParentBytes);
      if (expectedParentSha256 && bytesSha256 !== expectedParentSha256) {
        invokeCleanup();
        throw new Error("Source verification failed: provided bytes do not match expected hash.");
      }
      verifiedHash = bytesSha256;
    } else if (receipt) {
      verifiedHash = receipt.sourceContentSha256;
    } else {
      invokeCleanup();
      throw new Error("Source verification unavailable: current source bytes/hash required when expectedParentSha256 is specified.");
    }

    // Step 3: Check nested parent lineage snapshot
    const parentLineage = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = ?").get(parentMaterialId);
    const isNestedSplit = !!parentLineage;

    // Step 4: Authoritative source total
    let authoritativeTotal = sourceTotalPages;
    if (!authoritativeTotal) {
      if (isNestedSplit) {
        authoritativeTotal = parentLineage.child_page_count;
      } else if (parts[0]?.sourceTotalPages) {
        authoritativeTotal = parts[0].sourceTotalPages;
      } else {
        // Authoritative fallback bound for un-receipted direct splits: 1,000 pages
        authoritativeTotal = 1000;
      }
    }

    // Step 5: Derive canonical ranges & prepare part rows
    const preparedParts = [];
    const nestedLevel = isNestedSplit ? (parentLineage.nested_level || 1) + 1 : 1;

    for (const part of parts) {
      const start = part.selection?.start ?? part.parentPageStart ?? part.sourcePageStart;
      const end = part.selection?.end ?? part.parentPageEnd ?? part.sourcePageEnd;

      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        invokeCleanup();
        throw new Error(`Part ${part.id} missing valid integer selection bounds: start=${start}, end=${end}`);
      }
      if (start < ENGINE_LIMITS.MIN_PAGE || end < start) {
        invokeCleanup();
        throw new Error(`Invalid range for part ${part.id}: [${start}..${end}]`);
      }

      if (isNestedSplit) {
        const parentLength = parentLineage.child_page_count;
        if (end > parentLength) {
          invokeCleanup();
          throw new Error(`Nested part ${part.id} selection end (${end}) exceeds parent length (${parentLength})`);
        }
        const canonicalRootStart = parentLineage.source_page_start + start - 1;
        const canonicalRootEnd = parentLineage.source_page_start + end - 1;
        const childCount = end - start + 1;

        // Refuse contradictory caller inputs
        if (part.sourceContentSha256 && part.sourceContentSha256 !== parentLineage.source_content_sha256) {
          invokeCleanup();
          throw new Error(`Contradictory root hash for ${part.id}: caller supplied hash differs from parent root hash.`);
        }
        if (part.parentContentSha256 && part.parentContentSha256 !== verifiedHash) {
          invokeCleanup();
          throw new Error(`Contradictory parent hash for ${part.id}: caller supplied hash differs from verified parent hash.`);
        }
        if (part.sourcePageStart && part.sourcePageStart !== canonicalRootStart) {
          invokeCleanup();
          throw new Error(`Contradictory root range start for ${part.id}: expected ${canonicalRootStart}, got ${part.sourcePageStart}`);
        }
        if (part.sourcePageEnd && part.sourcePageEnd !== canonicalRootEnd) {
          invokeCleanup();
          throw new Error(`Contradictory root range end for ${part.id}: expected ${canonicalRootEnd}, got ${part.sourcePageEnd}`);
        }
        if (part.rootMaterialId && part.rootMaterialId !== parentLineage.root_material_id) {
          invokeCleanup();
          throw new Error(`Contradictory rootMaterialId for ${part.id}: expected ${parentLineage.root_material_id}, got ${part.rootMaterialId}`);
        }
        if (part.nestedLevel && part.nestedLevel !== nestedLevel) {
          invokeCleanup();
          throw new Error(`Contradictory nestedLevel for ${part.id}: expected ${nestedLevel}, got ${part.nestedLevel}`);
        }

        preparedParts.push({
          material: {
            id: part.id,
            title: part.title || part.id,
            topic: part.topic || parentRow.topic || "general",
            materialType: part.materialType || parentRow.material_type || "study_guide",
            filePath: part.filePath || null,
            fileSize: part.fileSize || null,
            originalFileName: part.originalFileName || (part.filePath ? basename(part.filePath) : `${part.id}.pdf`),
          },
          lineage: {
            materialId: part.id,
            parentMaterialId: parentMaterialId,
            rootMaterialId: parentLineage.root_material_id, // Preserves root ID (or NULL if deleted)
            sourcePageStart: canonicalRootStart,
            sourcePageEnd: canonicalRootEnd,
            parentPageStart: start,
            parentPageEnd: end,
            childPageCount: childCount,
            sourceFileName: parentLineage.source_file_name,
            sourceTitle: parentLineage.source_title,
            sourceContentSha256: parentLineage.source_content_sha256, // Root hash from snapshot
            sourceTotalPages: parentLineage.source_total_pages,
            parentFileName: parentRow.original_file_name || (parentRow.file_path ? basename(parentRow.file_path) : "parent.pdf"),
            parentTitle: parentRow.title,
            parentContentSha256: verifiedHash, // Verified parent hash
            parentTotalPages: parentLength,
            nestedLevel: nestedLevel,
          },
        });
      } else {
        // Direct split
        if (part.sourceContentSha256 && part.sourceContentSha256 !== verifiedHash) {
          invokeCleanup();
          throw new Error(`Contradictory caller hash for ${part.id}: caller supplied hash differs from verified source hash.`);
        }
        if (end > authoritativeTotal) {
          invokeCleanup();
          throw new Error(`Direct part ${part.id} page end (${end}) exceeds authoritative source total (${authoritativeTotal})`);
        }
        const childCount = end - start + 1;

        preparedParts.push({
          material: {
            id: part.id,
            title: part.title || part.id,
            topic: part.topic || parentRow.topic || "general",
            materialType: part.materialType || parentRow.material_type || "study_guide",
            filePath: part.filePath || null,
            fileSize: part.fileSize || null,
            originalFileName: part.originalFileName || (part.filePath ? basename(part.filePath) : `${part.id}.pdf`),
          },
          lineage: {
            materialId: part.id,
            parentMaterialId: null,
            rootMaterialId: parentMaterialId,
            sourcePageStart: start,
            sourcePageEnd: end,
            parentPageStart: null,
            parentPageEnd: null,
            childPageCount: childCount,
            sourceFileName: parentRow.original_file_name || (parentRow.file_path ? basename(parentRow.file_path) : "source.pdf"),
            sourceTitle: parentRow.title,
            sourceContentSha256: verifiedHash, // Verified root hash
            sourceTotalPages: authoritativeTotal,
            parentFileName: null,
            parentTitle: null,
            parentContentSha256: null,
            parentTotalPages: null,
            nestedLevel: 1,
          },
        });
      }
    }

    // Step 6: Operation ID & Idempotency Check
    const planSummary = preparedParts.map((p) => ({
      id: p.material.id,
      s: p.lineage.sourcePageStart,
      e: p.lineage.sourcePageEnd,
    }));
    const operationId = providedOpId || createHash("sha256")
      .update(parentMaterialId + ":" + verifiedHash + ":" + JSON.stringify(planSummary))
      .digest("hex");

    const existingOp = db.prepare("SELECT * FROM split_operation_log WHERE operation_id = ?").get(operationId);
    if (existingOp && existingOp.status === "committed") {
      const existingPlan = JSON.parse(existingOp.plan_json);
      if (JSON.stringify(existingPlan) !== JSON.stringify(planSummary)) {
        invokeCleanup();
        throw new Error(`Conflicting resubmission for operation ${operationId}`);
      }
      return {
        operationId,
        savedPartsCount: preparedParts.length,
        parts: preparedParts,
        idempotentReplay: true,
      };
    }

    // Step 7: Re-check under BEGIN IMMEDIATE
    db.exec("BEGIN IMMEDIATE TRANSACTION;");
    try {
      const lockedParent = db.prepare("SELECT * FROM study_materials WHERE id = ?").get(parentMaterialId);
      if (!lockedParent) {
        throw new Error(`Pinned transaction error: source material ${parentMaterialId} was deleted before commit.`);
      }
      if (lockedParent.file_path !== parentRow.file_path) {
        throw new Error(`Pinned transaction error: source material ${parentMaterialId} file path changed before commit.`);
      }

      if (isNestedSplit) {
        const lockedLineage = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = ?").get(parentMaterialId);
        if (
          !lockedLineage ||
          lockedLineage.source_content_sha256 !== parentLineage.source_content_sha256 ||
          lockedLineage.source_page_start !== parentLineage.source_page_start ||
          lockedLineage.source_page_end !== parentLineage.source_page_end
        ) {
          throw new Error(`Pinned transaction error: source lineage snapshot changed before commit.`);
        }
      }

      for (const p of preparedParts) {
        insertMaterial(db, p.material);
        if (tags && tags.length > 0) {
          for (const t of tags) {
            db.prepare("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, datetime('now'))").run(t.tagId || t.name, t.name);
            db.prepare("INSERT OR IGNORE INTO material_tags (material_id, tag_id) VALUES (?, ?)").run(p.material.id, t.tagId || t.name);
          }
        }
        insertSplitLineage(db, p.lineage);
      }

      db.prepare(`
        INSERT OR REPLACE INTO split_operation_log (operation_id, source_material_id, status, plan_json, created_at)
        VALUES (?, ?, 'committed', ?, datetime('now'))
      `).run(operationId, parentMaterialId, JSON.stringify(planSummary));

      db.exec("COMMIT TRANSACTION;");

      return {
        operationId,
        savedPartsCount: preparedParts.length,
        parts: preparedParts,
        idempotentReplay: false,
      };
    } catch (txErr) {
      try {
        db.exec("ROLLBACK TRANSACTION;");
      } catch (_) {}
      invokeCleanup();
      throw txErr;
    }
  } catch (err) {
    invokeCleanup();
    throw err;
  }
}

/**
 * SL-R9: Reconciles an acknowledged batch by operation ID.
 */
export function reconcileBatch(db, operationId) {
  const op = db.prepare("SELECT * FROM split_operation_log WHERE operation_id = ?").get(operationId);
  if (!op || op.status !== "committed") {
    return { reconciled: false, operationId, parts: [] };
  }
  const plan = JSON.parse(op.plan_json);
  const partIds = plan.map((p) => p.id);
  const existingRows = [];
  for (const id of partIds) {
    const row = db.prepare(`
      SELECT m.*, l.source_page_start, l.source_page_end, l.parent_page_start, l.parent_page_end, l.child_page_count, l.source_content_sha256, l.parent_content_sha256
      FROM study_materials m
      JOIN material_split_lineage l ON m.id = l.material_id
      WHERE m.id = ?
    `).get(id);
    if (row) existingRows.push(row);
  }
  return {
    reconciled: existingRows.length === partIds.length,
    operationId,
    status: op.status,
    parts: existingRows,
  };
}

/**
 * SL-R9: Models acknowledged save, refresh failure, and retry/reconciliation at model boundary.
 */
export function saveSplitBatchWithRefresh(db, options, refreshFn) {
  const saveResult = validateAndSaveSplitBatch(db, options);
  let refreshError = null;
  try {
    if (typeof refreshFn === "function") {
      refreshFn();
    }
  } catch (err) {
    refreshError = err;
  }

  // Model-level reconciliation reads by operation ID
  const reconciliation = reconcileBatch(db, saveResult.operationId);

  return {
    ...saveResult,
    refreshSucceeded: refreshError === null,
    refreshError,
    reconciliation,
  };
}

/**
 * SL-R9: Models cancellation before vs after acknowledgement.
 */
export function cancelBatch(operationId, stagingFiles = [], isAcknowledged = false) {
  if (isAcknowledged) {
    return {
      cancelled: false,
      status: "already_committed",
      preservedFiles: stagingFiles,
    };
  }
  return {
    cancelled: true,
    status: "cancelled_before_commit",
    removedFiles: stagingFiles,
  };
}
