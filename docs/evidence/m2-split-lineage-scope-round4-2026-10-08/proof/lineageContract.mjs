import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, existsSync, statSync, unlinkSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Engine limits and physical bounds.
 */
export const ENGINE_LIMITS = Object.freeze({
  MIN_PAGE: 1,
  MAX_PAGE: 10_000,
  MAX_PDF_BYTES: 50 * 1024 * 1024, // 50 MiB
  MAX_PARTS_PER_BATCH: 200,
  MIN_PART_LENGTH: 1,
  PAGE_NUMBER_LIMIT: 2147483647, // 32-bit signed max
  SAFE_INT_LIMIT: Number.MAX_SAFE_INTEGER,
});

/**
 * Canonical JSON serializer with sorted keys for deterministic hashing.
 * @param {any} obj
 * @returns {string}
 */
export function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

/**
 * Computes deterministic SHA-256 digest in lowercase hexadecimal.
 * @param {Buffer|string} content
 * @returns {string}
 */
export function calculateSha256(content) {
  if (content === null || content === undefined) {
    throw new Error("Cannot hash null or undefined content");
  }
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Validates 1-based, inclusive physical page ranges.
 * @param {number} start
 * @param {number} end
 * @param {number} totalPages
 * @returns {{ start: number, end: number, pageCount: number }}
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
  if (totalPages !== null && totalPages !== undefined) {
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
 */
export function mapChildPageToSourcePositional(sourcePageStart, childPage, parentTotalPagesOrEnd = null) {
  if (!Number.isInteger(sourcePageStart) || sourcePageStart < 1) {
    throw new Error(`Invalid sourcePageStart: ${sourcePageStart}`);
  }
  if (!Number.isInteger(childPage) || childPage < 1) {
    throw new Error(`Invalid childPage: ${childPage}`);
  }

  if (parentTotalPagesOrEnd !== null && parentTotalPagesOrEnd !== undefined) {
    let bound = parentTotalPagesOrEnd;
    if (typeof parentTotalPagesOrEnd === "number" && parentTotalPagesOrEnd >= sourcePageStart) {
      bound = parentTotalPagesOrEnd - sourcePageStart + 1;
    }
    if (childPage > bound) {
      throw new Error(`Child page ${childPage} exceeds bound ${bound}`);
    }
  }

  return sourcePageStart + childPage - 1;
}

/**
 * Composes nested split ranges.
 */
export function composeNestedRanges(parentRange, childSelection) {
  const pStart = parentRange.start ?? parentRange.sourcePageStart;
  const pEnd = parentRange.end ?? parentRange.sourcePageEnd;
  const p = validatePageRange(pStart, pEnd, parentRange.totalPages || null);
  const parentLength = p.end - p.start + 1;

  const cStart = childSelection.start ?? childSelection.parentPageStart;
  const cEnd = childSelection.end ?? childSelection.parentPageEnd;
  const c = validatePageRange(cStart, cEnd, parentLength);

  const rootStart = p.start + c.start - 1;
  const rootEnd = p.start + c.end - 1;
  const childLength = c.end - c.start + 1;

  return {
    rootPageStart: rootStart,
    rootPageEnd: rootEnd,
    sourcePageStart: rootStart,
    sourcePageEnd: rootEnd,
    parentPageStart: c.start,
    parentPageEnd: c.end,
    childPageCount: childLength,
  };
}

/**
 * Composes multiple levels of nested ranges transitively.
 */
export function composeMultiLevelRanges(levels) {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new Error("Multi-level composition requires at least one range level");
  }
  let currentRootRange = {
    start: levels[0].start ?? levels[0].sourcePageStart,
    end: levels[0].end ?? levels[0].sourcePageEnd,
    totalPages: levels[0].totalPages || null,
  };
  let lastComposed = null;
  for (let i = 1; i < levels.length; i++) {
    lastComposed = composeNestedRanges(currentRootRange, levels[i]);
    currentRootRange = {
      start: lastComposed.rootPageStart,
      end: lastComposed.rootPageEnd,
      totalPages: levels[0].totalPages || null,
    };
  }
  return {
    rootPageStart: currentRootRange.start,
    rootPageEnd: currentRootRange.end,
    sourcePageStart: currentRootRange.start,
    sourcePageEnd: currentRootRange.end,
    immediateParentPageStart: lastComposed ? lastComposed.parentPageStart : levels[0].start,
    immediateParentPageEnd: lastComposed ? lastComposed.parentPageEnd : levels[0].end,
    childPageCount: currentRootRange.end - currentRootRange.start + 1,
    nestedLevel: levels.length,
  };
}

export function findShippedMigrationsDir() {
  const envDir = process.env.SHIPPED_MIGRATIONS_DIR;
  if (envDir && existsSync(envDir) && existsSync(join(envDir, "0001_initial_schema.sql"))) {
    return envDir;
  }
  const candidates = [
    join(__dirname, "../../../../../src-tauri/migrations"),
    join(__dirname, "../../../../src-tauri/migrations"),
    join(__dirname, "../../../src-tauri/migrations"),
    join(process.cwd(), "src-tauri/migrations"),
  ];
  for (const dir of candidates) {
    if (existsSync(dir) && existsSync(join(dir, "0001_initial_schema.sql"))) return dir;
  }
  throw new Error("Could not locate shipped migrations directory (src-tauri/migrations)");
}

/**
 * Creates an in-memory SQLite database initialized with shipped migrations 0001–0012,
 * and optionally applies candidate migration 0013.
 * SL-R11: split_operation_log is NOT created here; it is part of candidate_migration_0013.sql.
 * @param {boolean} applyMigration0013
 * @param {object} options
 * @returns {DatabaseSync}
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
}

/**
 * Directly inserts a lineage record for testing.
 */
export function insertSplitLineage(db, lineage) {
  const childPageCount = lineage.childPageCount || (lineage.sourcePageEnd - lineage.sourcePageStart + 1);
  const stmt = db.prepare(`
    INSERT INTO material_split_lineage (
      material_id, parent_material_id, root_material_id,
      source_page_start, source_page_end,
      parent_page_start, parent_page_end,
      child_page_count,
      source_file_name, source_title, source_content_sha256, source_total_pages,
      parent_file_name, parent_title, parent_content_sha256, parent_total_pages,
      nested_level, created_at
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
    lineage.nestedLevel || 1
  );
}

/**
 * Creates a typed, tamper-evident SplitSourceReceipt bound to the database.
 * SL-R10:
 * - Reads on-disk file; missing or unreadable source file throws error.
 * - Persists receipt in split_operation_log as 'pending'.
 * - Any edit to total, plan, hash or snapshot will fail validation.
 * @param {DatabaseSync} db
 * @param {{
 *   sourceMaterialId: string,
 *   sourceFilePath?: string,
 *   sourceTotalPages: number,
 *   plan: Array<{ id: string, title?: string, selection: { start: number, end: number }, filePath?: string, fileSize?: number }>
 * }} params
 * @returns {Readonly<object>}
 */
export function createSplitSourceReceipt(db, {
  sourceMaterialId,
  sourceFilePath = null,
  sourceTotalPages,
  plan = [],
}) {
  if (!db) {
    throw new Error("Database instance required to create SplitSourceReceipt");
  }
  if (!sourceMaterialId) {
    throw new Error("SplitSourceReceipt requires a sourceMaterialId");
  }
  const sourceMat = db.prepare("SELECT * FROM study_materials WHERE id = ?").get(sourceMaterialId);
  if (!sourceMat) {
    throw new Error(`Source material ${sourceMaterialId} does not exist in library`);
  }

  const effectivePath = sourceFilePath || sourceMat.file_path || null;
  if (!effectivePath || !existsSync(effectivePath)) {
    throw new Error(`Source file is missing on disk for material ${sourceMaterialId}`);
  }

  let effectiveBytes;
  let fileSize;
  try {
    const stats = statSync(effectivePath);
    fileSize = stats.size;
    effectiveBytes = readFileSync(effectivePath);
  } catch (err) {
    throw new Error(`Source file is unreadable for material ${sourceMaterialId}: ${err.message}`);
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
  let rootFileName = sourceMat.original_file_name || basename(effectivePath);
  let rootContentSha256 = sourceContentSha256;
  let rootTotalPages = sourceTotalPages;
  let parentSnapshot = null;
  let nestedLevel = 1;

  if (isNested) {
    rootMaterialId = parentLineage.root_material_id;
    rootTitle = parentLineage.source_title;
    rootFileName = parentLineage.source_file_name;
    rootContentSha256 = parentLineage.source_content_sha256;
    rootTotalPages = parentLineage.source_total_pages;
    nestedLevel = (parentLineage.nested_level || 1) + 1;

    parentSnapshot = {
      rootMaterialId: parentLineage.root_material_id,
      rootTitle: parentLineage.source_title,
      rootFileName: parentLineage.source_file_name,
      rootContentSha256: parentLineage.source_content_sha256,
      rootTotalPages: parentLineage.source_total_pages,
      parentRootPageStart: parentLineage.source_page_start,
      parentRootPageEnd: parentLineage.source_page_end,
      parentTotalPages: parentLineage.child_page_count,
      nestedLevel: parentLineage.nested_level,
      parentFilePath: effectivePath,
    };
  }

  // Validate plan selections against authoritative total
  const maxAllowed = isNested ? parentLineage.child_page_count : sourceTotalPages;
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
      canonicalRootStart = parentLineage.source_page_start + s - 1;
      canonicalRootEnd = parentLineage.source_page_start + e - 1;
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

  const receiptData = {
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
    parentSnapshot,
    nestedLevel,
    plan: validatedPlan,
  };

  const canonicalReceiptJson = canonicalJson(receiptData);
  const receiptHash = calculateSha256(canonicalReceiptJson);
  const operationId = receiptHash;

  // Persist receipt as pending in split_operation_log if table exists
  const hasOpLog = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='split_operation_log'").get().n > 0;
  if (hasOpLog) {
    db.prepare(`
      INSERT OR REPLACE INTO split_operation_log (
        operation_id, source_material_id, receipt_canonical_json, receipt_hash, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))
    `).run(operationId, sourceMaterialId, canonicalReceiptJson, receiptHash);
  }

  return Object.freeze({
    ...receiptData,
    canonicalReceiptJson,
    receiptHash,
    operationId,
  });
}

/**
 * Retrieves a material and its split lineage.
 */
export function getMaterialWithLineage(db, materialId, options = {}) {
  const material = db.prepare("SELECT * FROM study_materials WHERE id = ?").get(materialId);
  if (!material) return null;

  const lineage = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = ?").get(materialId);
  if (!lineage) {
    return { material, lineage: null };
  }

  const isDirectSplit = lineage.nested_level === 1 && lineage.parent_page_start === null;

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
      } else {
        const rootPath = options.rootFilePath || rootMat.file_path;
        if (!rootPath || !existsSync(rootPath)) {
          rootStatus = "missing";
        } else {
          const liveHash = calculateSha256(readFileSync(rootPath));
          rootStatus = liveHash === lineage.source_content_sha256 ? "matching" : "changed";
        }
      }
    }
  } else {
    rootStatus = "deleted";
  }

  let parentStatus = "unknown";
  if (isDirectSplit) {
    parentStatus = rootStatus;
  } else {
    if (!lineage.parent_content_sha256) {
      parentStatus = "unknown";
    } else if (lineage.parent_material_id) {
      const parentMat = db.prepare("SELECT * FROM study_materials WHERE id = ?").get(lineage.parent_material_id);
      if (!parentMat) {
        parentStatus = "deleted";
      } else {
        const currentBytes = options.currentParentBytes;
        if (currentBytes) {
          parentStatus = calculateSha256(currentBytes) === lineage.parent_content_sha256 ? "matching" : "changed";
        } else {
          const parentPath = options.parentFilePath || parentMat.file_path;
          if (!parentPath || !existsSync(parentPath)) {
            parentStatus = "missing";
          } else {
            const liveHash = calculateSha256(readFileSync(parentPath));
            parentStatus = liveHash === lineage.parent_content_sha256 ? "matching" : "changed";
          }
        }
      }
    } else {
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
      status: isDirectSplit ? rootStatus : (parentStatus === "matching" ? rootStatus : parentStatus),
    },
    isDirectSplit,
    rootStatus,
    parentStatus,
    status: isDirectSplit ? rootStatus : parentStatus,
  };
}

/**
 * Lists companion sibling parts sharing the same parent and matching effective edition hash.
 */
export function listSiblings(db, materialId) {
  const current = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = ?").get(materialId);
  if (!current) return [];

  const isDirect = current.nested_level === 1 && current.parent_page_start === null;

  if (isDirect) {
    const effectiveParentHash = current.source_content_sha256;
    if (!effectiveParentHash) return [];

    return db.prepare(`
      SELECT m.*, l.source_page_start, l.source_page_end
      FROM study_materials m
      JOIN material_split_lineage l ON m.id = l.material_id
      WHERE l.nested_level = 1
        AND l.parent_page_start IS NULL
        AND l.source_content_sha256 = ?
        AND m.id != ?
      ORDER BY l.source_page_start ASC
    `).all(effectiveParentHash, materialId);
  } else {
    const parentId = current.parent_material_id;
    const parentHash = current.parent_content_sha256;
    if (!parentId || !parentHash) return [];

    return db.prepare(`
      SELECT m.*, l.source_page_start, l.source_page_end, l.parent_page_start, l.parent_page_end
      FROM study_materials m
      JOIN material_split_lineage l ON m.id = l.material_id
      WHERE l.nested_level > 1
        AND l.parent_material_id = ?
        AND l.parent_content_sha256 = ?
        AND m.id != ?
      ORDER BY l.parent_page_start ASC
    `).all(parentId, parentHash, materialId);
  }
}

/**
 * Validates and atomically saves a split batch.
 * SL-R10:
 * - A valid SplitSourceReceipt is the ONLY accepted input.
 * - Refuses caller parts, caller expected hashes, caller bytes, or caller operation IDs.
 * - Verifies receipt canonical hash against split_operation_log.
 * - Verifies on-disk source file OUTSIDE transaction.
 * - Inside BEGIN IMMEDIATE: verifies source material and compares nested parent snapshot.
 * - Cleanup runs exactly once on failure.
 * @param {DatabaseSync} db
 * @param {object} options
 * @returns {{ batchId: string, operationId: string, parts: Array<object>, count: number, idempotentReplay: boolean }}
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
    // SL-R10: Refuse any save without a receipt or with prohibited caller overrides
    if (!options.receipt || typeof options.receipt !== "object") {
      invokeCleanup();
      throw new Error("A valid SplitSourceReceipt is required; unverified split refused.");
    }
    if (options.parts !== undefined) {
      invokeCleanup();
      throw new Error("Caller parts cannot accompany a SplitSourceReceipt.");
    }
    if (options.expectedParentSha256 !== undefined || options.currentParentBytes !== undefined) {
      invokeCleanup();
      throw new Error("Legacy verification inputs not accepted; SplitSourceReceipt required.");
    }
    if (options.operationId !== undefined) {
      invokeCleanup();
      throw new Error("Caller operationId not accepted; operation ID is derived from receipt.");
    }
    if (options.sourceTotalPages !== undefined) {
      invokeCleanup();
      throw new Error("Caller sourceTotalPages not accepted; total comes from receipt.");
    }

    const { receipt, tags = [] } = options;

    if (!receipt.plan || receipt.plan.length === 0) {
      invokeCleanup();
      throw new Error("Split batch requires at least one part in receipt plan.");
    }

    if (receipt.plan.length > ENGINE_LIMITS.MAX_PARTS_PER_BATCH) {
      invokeCleanup();
      throw new Error(`Batch part count (${receipt.plan.length}) exceeds maximum limit (${ENGINE_LIMITS.MAX_PARTS_PER_BATCH}).`);
    }

    // Step 1: Recompute receipt canonical hash and verify tamper-evidence
    const receiptCore = {
      sourceMaterialId: receipt.sourceMaterialId,
      sourceFilePath: receipt.sourceFilePath,
      sourceFileSize: receipt.sourceFileSize,
      sourceContentSha256: receipt.sourceContentSha256,
      sourceTotalPages: receipt.sourceTotalPages,
      isNested: receipt.isNested,
      rootMaterialId: receipt.rootMaterialId,
      rootTitle: receipt.rootTitle,
      rootFileName: receipt.rootFileName,
      rootContentSha256: receipt.rootContentSha256,
      rootTotalPages: receipt.rootTotalPages,
      parentSnapshot: receipt.parentSnapshot,
      nestedLevel: receipt.nestedLevel,
      plan: receipt.plan,
    };
    const computedJson = canonicalJson(receiptCore);
    const computedHash = calculateSha256(computedJson);

    // Step 2: Check split_operation_log if table exists
    const hasOpLog = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='split_operation_log'").get().n > 0;
    let opRow = null;
    if (hasOpLog) {
      opRow = db.prepare("SELECT * FROM split_operation_log WHERE operation_id = ?").get(receipt.operationId);
      if (!opRow || opRow.receipt_hash !== computedHash || opRow.source_material_id !== receipt.sourceMaterialId) {
        invokeCleanup();
        throw new Error("Receipt hash mismatch or unrecorded receipt: receipt has been tampered with or not issued by split engine");
      }
      if (opRow.status === "cancelled") {
        invokeCleanup();
        throw new Error("Cannot save a cancelled split operation");
      }
      if (opRow.status === "committed") {
        // Idempotent replay: return existing parts without modifying database
        const existingParts = receipt.plan.map((p) => db.prepare("SELECT * FROM study_materials WHERE id = ?").get(p.id)).filter(Boolean);
        return {
          batchId: receipt.operationId,
          operationId: receipt.operationId,
          parts: existingParts,
          count: existingParts.length,
          savedPartsCount: existingParts.length,
          idempotentReplay: true,
        };
      }
    }

    // Step 3: File-read boundary check (OUTSIDE transaction)
    if (!receipt.sourceFilePath || !existsSync(receipt.sourceFilePath)) {
      invokeCleanup();
      throw new Error(`Source file is missing on disk for material ${receipt.sourceMaterialId}`);
    }
    let diskBytes;
    try {
      diskBytes = readFileSync(receipt.sourceFilePath);
    } catch (err) {
      invokeCleanup();
      throw new Error(`Source file is unreadable: ${err.message}`);
    }
    const diskSha256 = calculateSha256(diskBytes);
    if (diskSha256 !== receipt.sourceContentSha256) {
      invokeCleanup();
      throw new Error("Stale on-disk source: current file on disk has changed and does not match receipt hash.");
    }

    // Step 4: Output identity collision check (SL-R11.2) before write
    for (const part of receipt.plan) {
      const existing = db.prepare("SELECT id FROM study_materials WHERE id = ?").get(part.id);
      if (existing) {
        invokeCleanup();
        throw new Error(`Planned output material ID already exists in library: ${part.id}`);
      }
    }

    // Step 5: Execute atomic transaction with BEGIN IMMEDIATE
    db.exec("BEGIN IMMEDIATE;");

    try {
      // In-transaction re-check: source material existence and path
      const currentParent = db.prepare("SELECT * FROM study_materials WHERE id = ?").get(receipt.sourceMaterialId);
      if (!currentParent || currentParent.file_path !== receipt.sourceFilePath) {
        throw new Error(`Source material ${receipt.sourceMaterialId} modified or removed concurrently`);
      }

      // In-transaction re-check: nested parent lineage snapshot (SL-R10.4)
      if (receipt.isNested) {
        const currentParentLineage = db.prepare("SELECT * FROM material_split_lineage WHERE material_id = ?").get(receipt.sourceMaterialId);
        if (!currentParentLineage || !receipt.parentSnapshot) {
          throw new Error("Parent lineage record removed concurrently");
        }
        if (
          currentParentLineage.root_material_id !== receipt.parentSnapshot.rootMaterialId ||
          currentParentLineage.source_content_sha256 !== receipt.parentSnapshot.rootContentSha256 ||
          currentParentLineage.source_page_start !== receipt.parentSnapshot.parentRootPageStart ||
          currentParentLineage.source_page_end !== receipt.parentSnapshot.parentRootPageEnd ||
          currentParentLineage.source_total_pages !== receipt.parentSnapshot.rootTotalPages ||
          currentParentLineage.child_page_count !== receipt.parentSnapshot.parentTotalPages ||
          currentParentLineage.nested_level !== receipt.parentSnapshot.nestedLevel
        ) {
          throw new Error("Parent lineage snapshot has changed since split");
        }
      }

      const insertMat = db.prepare(`
        INSERT INTO study_materials (
          id, title, material_type, topic, review_status, priority,
          notes, file_path, original_file_name, file_size, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);

      const insertLineage = db.prepare(`
        INSERT INTO material_split_lineage (
          material_id, parent_material_id, root_material_id,
          source_page_start, source_page_end,
          parent_page_start, parent_page_end,
          child_page_count,
          source_file_name, source_title, source_content_sha256, source_total_pages,
          parent_file_name, parent_title, parent_content_sha256, parent_total_pages,
          nested_level, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);

      const insertTag = db.prepare("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, datetime('now'))");
      const insertMaterialTag = db.prepare("INSERT OR IGNORE INTO material_tags (material_id, tag_id) VALUES (?, ?)");

      const savedMaterials = [];

      for (const part of receipt.plan) {
        insertMat.run(
          part.id,
          part.title,
          "study_guide",
          currentParent.topic || "general",
          "needs_review",
          "later",
          `Split part ${part.selection.start}–${part.selection.end}`,
          part.filePath || null,
          part.filePath ? basename(part.filePath) : null,
          part.fileSize || null
        );

        const parentStart = receipt.isNested ? part.selection.start : null;
        const parentEnd = receipt.isNested ? part.selection.end : null;
        const parentTotal = receipt.isNested ? receipt.parentSnapshot.parentTotalPages : null;
        const parentFile = receipt.isNested ? receipt.rootFileName : null;
        const parentTitle = receipt.isNested ? receipt.rootTitle : null;
        const parentHash = receipt.isNested ? receipt.sourceContentSha256 : null;

        insertLineage.run(
          part.id,
          receipt.isNested ? receipt.sourceMaterialId : null,
          receipt.rootMaterialId,
          part.canonicalRootStart,
          part.canonicalRootEnd,
          parentStart,
          parentEnd,
          part.childPageCount,
          receipt.rootFileName,
          receipt.rootTitle,
          receipt.rootContentSha256,
          receipt.rootTotalPages,
          parentFile,
          parentTitle,
          parentHash,
          parentTotal,
          receipt.nestedLevel
        );

        for (const tag of tags) {
          const tagId = `tag-${tag.toLowerCase().replace(/\s+/g, "-")}`;
          insertTag.run(tagId, tag);
          insertMaterialTag.run(part.id, tagId);
        }

        savedMaterials.push({
          id: part.id,
          title: part.title,
          sourcePageStart: part.canonicalRootStart,
          sourcePageEnd: part.canonicalRootEnd,
          childPageCount: part.childPageCount,
          filePath: part.filePath || null,
        });
      }

      if (hasOpLog) {
        db.prepare("UPDATE split_operation_log SET status = 'committed', updated_at = datetime('now') WHERE operation_id = ?").run(receipt.operationId);
      }

      db.exec("COMMIT;");

      return {
        batchId: receipt.operationId,
        operationId: receipt.operationId,
        parts: savedMaterials,
        count: savedMaterials.length,
        savedPartsCount: savedMaterials.length,
        idempotentReplay: false,
      };
    } catch (txErr) {
      try {
        db.exec("ROLLBACK;");
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
 * Reconciles a split batch by operation ID.
 */
export function reconcileBatch(db, operationId) {
  const row = db.prepare("SELECT * FROM split_operation_log WHERE operation_id = ?").get(operationId);
  if (!row) return null;
  let receipt = null;
  try {
    receipt = JSON.parse(row.receipt_canonical_json);
  } catch (_) {}

  const parts = [];
  if (receipt && receipt.plan) {
    for (const p of receipt.plan) {
      const mat = db.prepare("SELECT * FROM study_materials WHERE id = ?").get(p.id);
      if (mat) parts.push(mat);
    }
  }
  return {
    operationId,
    status: row.status,
    parts,
    count: parts.length,
    reconciled: row.status === "committed" && parts.length === (receipt?.plan?.length || 0),
  };
}

/**
 * Real cancellation of a split batch operation (SL-R11.3).
 * Supports both cancelBatch(db, operationId) and cancelBatch(operationId, stagingFiles, isAcknowledged).
 */
export function cancelBatch(dbOrOpId, opIdOrFiles, isAck) {
  if (typeof dbOrOpId === "object" && dbOrOpId !== null && typeof dbOrOpId.prepare === "function") {
    const db = dbOrOpId;
    const operationId = opIdOrFiles;
    const row = db.prepare("SELECT * FROM split_operation_log WHERE operation_id = ?").get(operationId);
    if (!row) {
      return { operationId, status: "unknown", removedFiles: [] };
    }
    if (row.status === "committed") {
      return { operationId, status: "committed", cancelled: false, removedFiles: [] };
    }
    db.prepare("UPDATE split_operation_log SET status = 'cancelled', updated_at = datetime('now') WHERE operation_id = ?").run(operationId);
    const removedFiles = [];
    try {
      const receipt = JSON.parse(row.receipt_canonical_json);
      if (receipt.plan && Array.isArray(receipt.plan)) {
        for (const p of receipt.plan) {
          if (p.filePath && existsSync(p.filePath)) {
            unlinkSync(p.filePath);
            removedFiles.push(p.filePath);
          }
        }
      }
    } catch (_) {}
    return { operationId, status: "cancelled", cancelled: true, removedFiles };
  } else {
    // Compatibility signature: cancelBatch(operationId, stagingFiles, isAcknowledged)
    const operationId = dbOrOpId;
    const stagingFiles = Array.isArray(opIdOrFiles) ? opIdOrFiles : [];
    const isAcknowledged = !!isAck;
    if (isAcknowledged) {
      return { operationId, cancelled: false, removedFiles: [] };
    }
    const removedFiles = [];
    for (const f of stagingFiles) {
      if (typeof f === "string" && existsSync(f)) {
        try {
          unlinkSync(f);
          removedFiles.push(f);
        } catch (_) {}
      }
    }
    return { operationId, cancelled: true, removedFiles };
  }
}

/**
 * Simulates save failure followed by successful read reconciliation.
 */
export function saveSplitBatchWithRefresh(db, options = {}, postCommitHook = null) {
  const result = validateAndSaveSplitBatch(db, options);
  if (typeof postCommitHook === "function") {
    try {
      postCommitHook();
    } catch (hookErr) {
      const reconciled = reconcileBatch(db, result.operationId);
      return {
        ...result,
        refreshSucceeded: false,
        refreshFailed: true,
        reconciliation: reconciled,
        reconciled,
        refreshError: hookErr,
        error: hookErr.message,
      };
    }
  }
  const reconciled = reconcileBatch(db, result.operationId);
  return {
    ...result,
    refreshSucceeded: true,
    refreshFailed: false,
    reconciliation: reconciled,
    reconciled,
  };
}
