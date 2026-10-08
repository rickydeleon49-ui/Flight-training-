import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Direct imports from production pure logic modules
import {
  MAX_CARDS,
  MAX_FRONT_CHARS,
  MAX_BACK_CHARS,
  MAX_SOURCE_PAGE,
  canonicalJson,
  trimmedCodePoints,
  isValidCardText,
  parseSavedCards,
  cardVersion,
} from "../../../../src/logic/cardIdentity.ts";

import {
  SCHEDULER_VERSION,
  AGAIN_DELAY_MINUTES,
  LADDER_DAYS,
  MAX_STEP,
  CARD_RATINGS,
  SchedulerRefusal,
  scheduleCard,
} from "../../../../src/logic/cardScheduler.ts";

import {
  localDate,
  nextLocalMidnightUtc,
  currentTimeZone,
  shortLocalDay,
} from "../../../../src/logic/localDay.ts";

/** Lower-case hex SHA-256 of UTF-8 text (synchronous for contract model & synthetic datasets). */
export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Re-export production contracts for complete parity
export {
  MAX_CARDS,
  MAX_FRONT_CHARS,
  MAX_BACK_CHARS,
  MAX_SOURCE_PAGE,
  canonicalJson,
  trimmedCodePoints,
  isValidCardText,
  parseSavedCards,
  cardVersion,
  SCHEDULER_VERSION,
  AGAIN_DELAY_MINUTES,
  LADDER_DAYS,
  MAX_STEP,
  CARD_RATINGS,
  SchedulerRefusal,
  scheduleCard,
  localDate,
  nextLocalMidnightUtc,
  currentTimeZone,
  shortLocalDay,
};

/**
 * Synchronous deriveCardVersion producing the exact same object structure
 * as `await cardVersion(materialId, cards)` using the content-addressed hashing contract.
 */
export function deriveCardVersion(materialId, cards) {
  const canonical = cards.map(({ front, back, sourcePage }) => ({
    front,
    back,
    sourcePage: sourcePage ?? null,
  }));
  const contentHash = createHash("sha256").update(canonicalJson(canonical), "utf8").digest("hex");
  const versionId = createHash("sha256").update(`${materialId}\u0000${contentHash}`, "utf8").digest("hex");
  const items = canonical.map((card, ordinal) => ({
    itemId: createHash("sha256").update(`${versionId}\u0000${ordinal}`, "utf8").digest("hex"),
    ordinal,
    ...card,
  }));
  return { versionId, contentHash, items };
}

/**
 * Derive the current version from the saved raw cards. Reads nothing, writes nothing.
 */
export function deriveCurrentCards(materialId, flashcardsJson) {
  const saved = parseSavedCards(flashcardsJson);
  if (saved.status !== "ok") return saved;
  return { status: "ok", ...deriveCardVersion(materialId, saved.cards) };
}

/**
 * Creates a disposable SQLite database initialized by executing the exact
 * shipped migrations (0001 through 0012) in order, without any unapproved indexes.
 */
export function createDisposableDb(dbPath = ":memory:") {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  const migrationsDir = resolve(fileURLToPath(import.meta.url), "../../../../../src-tauri/migrations");
  const sqlFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of sqlFiles) {
    const sql = readFileSync(resolve(migrationsDir, file), "utf8");
    db.exec(sql);
  }
  return db;
}

/**
 * Resource limits and schema constants (C2-R4, C2-R8)
 */
export const MAX_CURSOR_LENGTH = 32768; // 32 KiB: easily supports 250 candidate IDs while bounding input size
export const ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES = 8 * 1024 * 1024; // 8 MiB hard upper bound for single set
export const C1_LADDER_DAYS = Object.freeze([1, 3, 7, 16, 35, 75, 150, 180]);
export const ISO_INSTANT_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function parseBoundedInteger(val, defaultVal, minVal, maxVal) {
  if (val === undefined || val === null) return defaultVal;
  const num = Number(val);
  if (!Number.isFinite(num) || isNaN(num) || num < 0) return defaultVal;
  return Math.min(maxVal, Math.max(minVal, Math.floor(num)));
}

/**
 * Validates stored legacy schedule state JSON against C1 simple-v1 semantics.
 * Malformed or unsupported states produce typed null fields without inventing intervals.
 */
export function validateScheduleState(stateJsonStr) {
  if (stateJsonStr === null || stateJsonStr === undefined || stateJsonStr === "") {
    return { raw: stateJsonStr ?? null, parsed: null, valid: false, schedule: null };
  }
  let parsed;
  try {
    parsed = typeof stateJsonStr === "string" ? JSON.parse(stateJsonStr) : stateJsonStr;
  } catch {
    return { raw: stateJsonStr, parsed: null, valid: false, schedule: null };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { raw: stateJsonStr, parsed: null, valid: false, schedule: null };
  }

  const version = parsed.schedulerVersion ?? "simple-v1";
  if (version !== "simple-v1") {
    return { raw: stateJsonStr, parsed, valid: false, schedule: null };
  }

  const step = parsed.step;
  if (typeof step !== "number" || !Number.isInteger(step) || step < -1 || step > C1_LADDER_DAYS.length - 1) {
    return { raw: stateJsonStr, parsed, valid: false, schedule: null };
  }

  if (parsed.dueAt !== undefined && parsed.dueAt !== null) {
    if (typeof parsed.dueAt !== "string" || !ISO_INSTANT_REGEX.test(parsed.dueAt) || isNaN(Date.parse(parsed.dueAt))) {
      return { raw: stateJsonStr, parsed, valid: false, schedule: null };
    }
  }

  if (parsed.lastReviewedAt !== undefined && parsed.lastReviewedAt !== null) {
    if (typeof parsed.lastReviewedAt !== "string" || !ISO_INSTANT_REGEX.test(parsed.lastReviewedAt) || isNaN(Date.parse(parsed.lastReviewedAt))) {
      return { raw: stateJsonStr, parsed, valid: false, schedule: null };
    }
  }

  let intervalDays = null;
  let intervalMinutes = null;
  let intervalLabel = null;
  if (step === -1) {
    intervalMinutes = 10;
    intervalLabel = "10m";
  } else if (step >= 0 && step < C1_LADDER_DAYS.length) {
    intervalDays = C1_LADDER_DAYS[step];
    intervalMinutes = intervalDays * 1440;
    intervalLabel = `${intervalDays}d`;
  }

  return {
    raw: stateJsonStr,
    parsed,
    valid: true,
    schedule: {
      schedulerVersion: "simple-v1",
      step,
      dueAt: parsed.dueAt ?? null,
      lastReviewedAt: parsed.lastReviewedAt ?? null,
      reps: typeof parsed.reps === "number" && Number.isInteger(parsed.reps) ? parsed.reps : null,
      lapses: typeof parsed.lapses === "number" && Number.isInteger(parsed.lapses) ? parsed.lapses : null,
      intervalDays,
      intervalMinutes,
      intervalLabel,
    },
  };
}

/**
 * Base64 cursor helpers with strict bounds and shape validation
 */
function encodeCursor(payload) {
  const str = Buffer.from(JSON.stringify(payload)).toString("base64");
  if (str.length > MAX_CURSOR_LENGTH) {
    throw new Error("INVALID_CURSOR: encoded cursor exceeds maximum supported length");
  }
  return str;
}

function decodeCursor(cursorStr) {
  if (!cursorStr) return null;
  if (typeof cursorStr !== "string") {
    throw new Error("INVALID_CURSOR: cursor must be a base64 string");
  }
  if (cursorStr.length > MAX_CURSOR_LENGTH) {
    throw new Error("INVALID_CURSOR: cursor exceeds maximum allowed length");
  }
  try {
    const raw = Buffer.from(cursorStr, "base64").toString("utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("INVALID_CURSOR: malformed pagination cursor payload");
    }
    return parsed;
  } catch (err) {
    if (/INVALID_CURSOR/.test(err.message)) throw err;
    throw new Error("INVALID_CURSOR: malformed pagination cursor");
  }
}

/**
 * Internal helper to evaluate review due status for a list of candidate study material records.
 * Accepts an optional preDerivedMap: Map<materialId, derivedVersion> to avoid redundant JSON parsing.
 */
function evaluateCandidates(db, candidates, nowUtc, nextMidnight, preDerivedMap = null) {
  if (!candidates || candidates.length === 0) return [];

  const validDerived = [];

  if (preDerivedMap) {
    for (const cand of candidates) {
      const derived = preDerivedMap.get(cand.material_id);
      if (derived && derived.items && derived.items.length > 0) {
        validDerived.push({ candidate: cand, derived });
      }
    }
  } else {
    const candidateIds = candidates.map((c) => c.material_id);
    const cPlaceholders = candidateIds.map(() => "?").join(",");
    const setRows = db
      .prepare(
        `SELECT source_material_id, flashcards_json FROM ai_study_sets WHERE source_material_id IN (${cPlaceholders})`
      )
      .all(...candidateIds);
    const rawCardMap = new Map(setRows.map((r) => [r.source_material_id, r.flashcards_json]));

    for (const cand of candidates) {
      const rawJson = rawCardMap.get(cand.material_id);
      const parsed = parseSavedCards(rawJson);
      if (parsed.status === "ok" && parsed.cards.length > 0) {
        const derived = deriveCardVersion(cand.material_id, parsed.cards);
        validDerived.push({ candidate: cand, derived });
      }
    }
  }

  const results = [];
  if (validDerived.length > 0) {
    const versionIds = Array.from(new Set(validDerived.map((v) => v.derived.versionId)));
    const vPlaceholders = versionIds.map(() => "?").join(",");

    const stateRows = db
      .prepare(
        `SELECT
           i.version_id,
           s.item_id,
           s.step,
           s.due_at,
           s.suspended,
           s.flag
         FROM card_items i
         JOIN card_review_state s ON s.item_id = i.id
         WHERE i.version_id IN (${vPlaceholders})`
      )
      .all(...versionIds);

    const statesByVersion = new Map();
    for (const s of stateRows) {
      let list = statesByVersion.get(s.version_id);
      if (!list) {
        list = [];
        statesByVersion.set(s.version_id, list);
      }
      list.push(s);
    }

    for (const { candidate, derived } of validDerived) {
      const itemStates = statesByVersion.get(derived.versionId) || [];
      const itemStateMap = new Map(itemStates.map((s) => [s.item_id, s]));

      let againCount = 0;
      let dayCount = 0;
      let touchedCount = 0;
      let earliestDueAt = null;

      for (const item of derived.items) {
        const state = itemStateMap.get(item.itemId);
        if (state) {
          touchedCount++;
          if (!state.suspended && state.due_at) {
            if (state.step === -1 && state.due_at <= nowUtc) {
              againCount++;
              if (!earliestDueAt || state.due_at < earliestDueAt) earliestDueAt = state.due_at;
            } else if (state.step >= 0 && state.due_at < nextMidnight) {
              dayCount++;
              if (!earliestDueAt || state.due_at < earliestDueAt) earliestDueAt = state.due_at;
            }
          }
        }
      }

      const totalDueCount = againCount + dayCount;
      const newCount = derived.items.length - touchedCount;

      results.push({
        materialId: candidate.material_id,
        title: candidate.title,
        topic: candidate.topic,
        priority: candidate.priority,
        updatedAt: candidate.updated_at,
        cardCount: derived.items.length,
        againCount,
        dayCount,
        totalDueCount,
        newCount,
        retainedCardCount: touchedCount,
        earliestDueAt,
      });
    }
  }

  return results;
}

/**
 * Bounded library-wide review due query (C2-D3, C2-R7, C2-R8, R4, R9).
 */
export function getLibraryReviewDue(db, options = {}) {
  const { nowUtc, nextLocalMidnightUtc: nextMidnight, topic, statusFilter, cursor } = options;

  if (!nowUtc || isNaN(Date.parse(nowUtc))) {
    throw new Error("INVALID_TIME: nowUtc must be a valid ISO timestamp string");
  }
  if (!nextMidnight || isNaN(Date.parse(nextMidnight))) {
    throw new Error("INVALID_TIME: nextLocalMidnightUtc must be a valid ISO timestamp string");
  }

  const normalizedStatus = statusFilter ?? "all";
  const normalizedTopic = topic ?? null;

  // Hard caps and resource budgets
  const candidateBatchBudget = parseBoundedInteger(options.candidateBatchBudget, 250, 1, 250);
  const limit = parseBoundedInteger(options.limit, 50, 1, 250);
  const maxBatchCardsBudget = parseBoundedInteger(options.maxBatchCardsBudget, 2500, 1, 100000);
  const maxBatchRawJsonBytesBudget = parseBoundedInteger(options.maxBatchRawJsonBytesBudget, 2097152, 1024, 64 * 1024 * 1024);

  const decoded = decodeCursor(cursor);

  // Validate cursor version, type, and mandatory normalized context (R8)
  if (decoded) {
    if (decoded.v !== 1) {
      throw new Error("INVALID_CURSOR: unsupported cursor version (must be 1)");
    }
    if (decoded.type !== "due") {
      throw new Error("INVALID_CURSOR: unexpected cursor type");
    }
    if (!decoded.ctx || typeof decoded.ctx !== "object" || Array.isArray(decoded.ctx)) {
      throw new Error("INVALID_CURSOR: missing mandatory ownership context");
    }
    if (
      decoded.ctx.topic !== normalizedTopic ||
      decoded.ctx.statusFilter !== normalizedStatus ||
      decoded.ctx.nowUtc !== nowUtc ||
      decoded.ctx.nextLocalMidnightUtc !== nextMidnight
    ) {
      throw new Error("STALE_CURSOR: query parameters, filter, or clock boundary changed");
    }
    if (decoded.remIds !== undefined && decoded.remIds !== null) {
      if (!Array.isArray(decoded.remIds)) {
        throw new Error("INVALID_CURSOR: remIds must be an array of IDs");
      }
      if (decoded.remIds.length > 250) {
        throw new Error("INVALID_CURSOR: remIds exceeds maximum supported candidate count");
      }
      for (const id of decoded.remIds) {
        if (typeof id !== "string" || !id || id.length > 64) {
          throw new Error("INVALID_CURSOR: remIds elements must be valid string IDs");
        }
      }
    }
  }

  const currentCtx = {
    topic: normalizedTopic,
    statusFilter: normalizedStatus,
    nowUtc,
    nextLocalMidnightUtc: nextMidnight,
  };

  // Helper filter according to statusFilter (C2-R7)
  const matchesStatusFilter = (m) => {
    if (normalizedStatus === "due_today") {
      return m.totalDueCount > 0;
    }
    if (normalizedStatus === "new_only") {
      return m.totalDueCount === 0 && m.newCount > 0;
    }
    // "all" or undefined: any actionable work
    return m.totalDueCount > 0 || m.newCount > 0;
  };

  // --------------------------------------------------------------------------
  // Pending Stream Consumption & Revalidation (R8)
  // --------------------------------------------------------------------------
  if (decoded?.remIds && Array.isArray(decoded.remIds) && decoded.remIds.length > 0) {
    const page = [];
    let consumedCount = 0;
    let cumulativeRawBytes = 0;
    let cumulativeCards = 0;
    let scannedCandidates = 0;

    const getCandStmt = db.prepare(`
      SELECT
        m.id AS material_id,
        m.title,
        m.topic,
        m.review_status,
        m.priority,
        m.updated_at,
        LENGTH(CAST(a.flashcards_json AS BLOB)) AS byte_len
      FROM study_materials m
      JOIN ai_study_sets a ON a.source_material_id = m.id
      WHERE m.id = ?
        AND a.flashcards_json IS NOT NULL
        AND a.flashcards_json != '[]'
        AND a.flashcards_json != ''
    `);

    const getSetStmt = db.prepare(`
      SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?
    `);

    for (let i = 0; i < decoded.remIds.length; i++) {
      if (page.length >= limit) {
        break;
      }

      const id = decoded.remIds[i];
      const cand = getCandStmt.get(id);

      // If material deleted, flashcards empty, or topic changed: discard it
      if (!cand || (normalizedTopic && cand.topic !== normalizedTopic)) {
        consumedCount++;
        continue;
      }

      const byteLen = cand.byte_len ?? 0;
      // Preflight budget check:
      if (scannedCandidates > 0) {
        if (cumulativeRawBytes + byteLen > maxBatchRawJsonBytesBudget) {
          break; // Stop before reading candidate from SQLite
        }
        if (cumulativeCards >= maxBatchCardsBudget) {
          break;
        }
      }

      if (scannedCandidates === 0 && byteLen > ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES) {
        consumedCount++;
        break;
      }

      // Fetch flashcards_json
      const setRow = getSetStmt.get(id);
      scannedCandidates++;
      if (!setRow || typeof setRow.flashcards_json !== "string") {
        consumedCount++;
        continue;
      }

      const transferredBytes = Buffer.byteLength(setRow.flashcards_json, "utf8");
      cumulativeRawBytes += transferredBytes;

      const parsed = parseSavedCards(setRow.flashcards_json);
      if (parsed.status !== "ok" || parsed.cards.length === 0) {
        consumedCount++;
        if (cumulativeRawBytes >= maxBatchRawJsonBytesBudget) {
          break;
        }
        continue;
      }

      const cardCount = parsed.cards.length;
      // Card count budget check
      if (page.length > 0 && cumulativeCards + cardCount > maxBatchCardsBudget) {
        break; // Stop without consuming this candidate; will be retried next page
      }

      // Evaluate candidate review state
      const derived = deriveCardVersion(cand.material_id, parsed.cards);
      const evaluatedList = evaluateCandidates(
        db,
        [cand],
        nowUtc,
        nextMidnight,
        new Map([[cand.material_id, derived]])
      );
      const evaluated = evaluatedList[0];

      consumedCount++;
      cumulativeCards += cardCount;

      if (evaluated && matchesStatusFilter(evaluated)) {
        page.push(evaluated);
      }

      if (cumulativeRawBytes >= maxBatchRawJsonBytesBudget) {
        break;
      }
    }

    const remLeftIds = decoded.remIds.slice(consumedCount);

    let nextCursor = null;
    if (remLeftIds.length > 0) {
      nextCursor = encodeCursor({
        v: 1,
        type: "due",
        remIds: remLeftIds,
        lc: decoded.lc,
        lp: decoded.lp,
        lu: decoded.lu,
        isExhausted: decoded.isExhausted ?? false,
        ctx: currentCtx,
      });
    } else if (decoded.isExhausted) {
      nextCursor = null;
    } else {
      nextCursor = encodeCursor({
        v: 1,
        type: "due",
        remIds: [],
        lc: decoded.lc,
        lp: decoded.lp,
        lu: decoded.lu,
        isExhausted: false,
        ctx: currentCtx,
      });
    }

    return {
      materials: page,
      nextCursor,
      summary: {
        scannedCandidates: scannedCandidates > 0 ? scannedCandidates : consumedCount,
        evaluatedCandidates: page.length,
        evaluatedCards: cumulativeCards,
        rawBytesTransferred: cumulativeRawBytes,
        actionableCount: page.length,
        againCount: page.reduce((acc, m) => acc + m.againCount, 0),
        dayCount: page.reduce((acc, m) => acc + m.dayCount, 0),
        totalDueCount: page.reduce((acc, m) => acc + m.totalDueCount, 0),
        newCount: page.reduce((acc, m) => acc + m.newCount, 0),
        isComplete: nextCursor === null,
        isPageLocal: true,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Database Keyset Candidate Discovery (R1, R4, R8)
  // --------------------------------------------------------------------------
  let candidateSql = `
    SELECT
      m.id AS material_id,
      m.title,
      m.topic,
      m.review_status,
      m.priority,
      m.updated_at
    FROM study_materials m
    JOIN ai_study_sets a ON a.source_material_id = m.id
    WHERE a.flashcards_json IS NOT NULL
      AND a.flashcards_json != '[]'
      AND a.flashcards_json != ''
  `;
  const candidateParams = [];

  if (normalizedTopic) {
    candidateSql += " AND m.topic = ?";
    candidateParams.push(normalizedTopic);
  }

  if (decoded?.lc) {
    candidateSql += `
      AND (
        (CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END > ?)
        OR (CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END = ? AND m.updated_at < ?)
        OR (CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END = ? AND m.updated_at = ? AND m.id > ?)
      )
    `;
    candidateParams.push(
      decoded.lp,
      decoded.lp, decoded.lu,
      decoded.lp, decoded.lu, decoded.lc
    );
  }

  candidateSql += `
    ORDER BY
      CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END ASC,
      m.updated_at DESC,
      m.id ASC
    LIMIT ?
  `;
  candidateParams.push(candidateBatchBudget + 1);

  // 1. Candidate query
  const rawCandidateRows = db.prepare(candidateSql).all(...candidateParams);
  const hasMoreInDb = rawCandidateRows.length > candidateBatchBudget;
  const candidateBatch = rawCandidateRows.slice(0, candidateBatchBudget);

  if (candidateBatch.length === 0) {
    return {
      materials: [],
      nextCursor: null,
      summary: {
        scannedCandidates: 0,
        evaluatedCandidates: 0,
        evaluatedCards: 0,
        rawBytesTransferred: 0,
        actionableCount: 0,
        againCount: 0,
        dayCount: 0,
        totalDueCount: 0,
        newCount: 0,
        isComplete: true,
        isPageLocal: true,
      },
    };
  }

  // 2. Preflight byte check (R4)
  const candidateIds = candidateBatch.map((c) => c.material_id);
  const cPlaceholders = candidateIds.map(() => "?").join(",");
  const lenRows = db
    .prepare(
      `SELECT source_material_id, LENGTH(CAST(flashcards_json AS BLOB)) AS byte_len FROM ai_study_sets WHERE source_material_id IN (${cPlaceholders})`
    )
    .all(...candidateIds);
  const byteLenMap = new Map(lenRows.map((r) => [r.source_material_id, r.byte_len]));

  // 3. Admitted Candidate Evaluation with Raw Byte and Card Budgets (R4)
  const admittedCandidates = [];
  const derivedMap = new Map();
  let cumulativeRawBytes = 0;
  let cumulativeCards = 0;
  let scannedCandidates = 0;
  let lastEvaluatedIndex = -1;
  let singleSetLaneUsed = false;

  const getSetStmt = db.prepare(
    "SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?"
  );

  for (let i = 0; i < candidateBatch.length; i++) {
    const cand = candidateBatch[i];
    const byteLen = byteLenMap.get(cand.material_id) ?? 0;

    // Check preflight byte budget and card budget before reading candidate i
    if (scannedCandidates > 0) {
      if (cumulativeRawBytes + byteLen > maxBatchRawJsonBytesBudget) {
        break; // Stop before reading candidate i!
      }
      if (cumulativeCards >= maxBatchCardsBudget) {
        break; // Stop before reading candidate i!
      }
    }

    // Absolute single set check on candidate 0
    if (scannedCandidates === 0 && byteLen > ABSOLUTE_MAX_SINGLE_SET_RAW_JSON_BYTES) {
      // Exceeds absolute 8 MiB single-set cap; do not transfer
      lastEvaluatedIndex = i;
      scannedCandidates++;
      break;
    }

    if (scannedCandidates === 0 && byteLen > maxBatchRawJsonBytesBudget) {
      singleSetLaneUsed = true;
    }

    const setRow = getSetStmt.get(cand.material_id);
    scannedCandidates++;
    if (!setRow || typeof setRow.flashcards_json !== "string") {
      lastEvaluatedIndex = i;
      continue;
    }

    const transferredBytes = Buffer.byteLength(setRow.flashcards_json, "utf8");
    cumulativeRawBytes += transferredBytes;

    const parsed = parseSavedCards(setRow.flashcards_json);
    if (parsed.status !== "ok" || parsed.cards.length === 0) {
      lastEvaluatedIndex = i;
      if (singleSetLaneUsed || cumulativeRawBytes >= maxBatchRawJsonBytesBudget) {
        break;
      }
      continue;
    }

    const cardCount = parsed.cards.length;
    // Card budget check:
    if (admittedCandidates.length > 0 && cumulativeCards + cardCount > maxBatchCardsBudget) {
      // Budget stop: candidate i was read and transferred, but cannot be admitted to this batch.
      // Leave lastEvaluatedIndex = i - 1 so candidate i is retried on next page.
      break;
    }

    lastEvaluatedIndex = i;
    cumulativeCards += cardCount;

    const derived = deriveCardVersion(cand.material_id, parsed.cards);
    derivedMap.set(cand.material_id, derived);
    admittedCandidates.push(cand);

    if (singleSetLaneUsed || cumulativeRawBytes >= maxBatchRawJsonBytesBudget) {
      break;
    }
  }

  // If no candidates were evaluated, advance cursor to last processed candidate
  if (lastEvaluatedIndex === -1 && scannedCandidates > 0) {
    lastEvaluatedIndex = scannedCandidates - 1;
  }

  // 4. Review State Evaluation
  const evaluatedBatch = evaluateCandidates(db, admittedCandidates, nowUtc, nextMidnight, derivedMap);
  const actionableList = evaluatedBatch.filter(matchesStatusFilter);

  // 5. Within-batch Urgency Ranking
  actionableList.sort((a, b) => {
    const bucketA = a.againCount > 0 ? 0 : a.dayCount > 0 ? 1 : a.totalDueCount === 0 && a.newCount > 0 ? 2 : 3;
    const bucketB = b.againCount > 0 ? 0 : b.dayCount > 0 ? 1 : b.totalDueCount === 0 && b.newCount > 0 ? 2 : 3;
    if (bucketA !== bucketB) return bucketA - bucketB;

    const prioA = a.priority === "next_up" ? 0 : 1;
    const prioB = b.priority === "next_up" ? 0 : 1;
    if (prioA !== prioB) return prioA - prioB;

    if (a.earliestDueAt && b.earliestDueAt && a.earliestDueAt !== b.earliestDueAt) {
      return a.earliestDueAt.localeCompare(b.earliestDueAt);
    }
    if (a.earliestDueAt && !b.earliestDueAt) return -1;
    if (!a.earliestDueAt && b.earliestDueAt) return 1;

    if (a.title !== b.title) return a.title.localeCompare(b.title);
    return a.materialId.localeCompare(b.materialId);
  });

  // 6. Partition into requested page and remaining batch items
  const page = actionableList.slice(0, limit);
  const remainingActionable = actionableList.slice(limit);
  const remainingIds = remainingActionable.map((m) => m.materialId);

  const lastCandidate = candidateBatch[lastEvaluatedIndex >= 0 ? lastEvaluatedIndex : candidateBatch.length - 1];
  const isExhausted = !hasMoreInDb && lastEvaluatedIndex === candidateBatch.length - 1;

  let nextCursor = null;
  if (remainingIds.length > 0) {
    nextCursor = encodeCursor({
      v: 1,
      type: "due",
      remIds: remainingIds,
      lc: lastCandidate.material_id,
      lp: lastCandidate.priority === "next_up" ? 0 : 1,
      lu: lastCandidate.updated_at,
      isExhausted,
      ctx: currentCtx,
    });
  } else if (isExhausted) {
    nextCursor = null;
  } else {
    nextCursor = encodeCursor({
      v: 1,
      type: "due",
      remIds: [],
      lc: lastCandidate.material_id,
      lp: lastCandidate.priority === "next_up" ? 0 : 1,
      lu: lastCandidate.updated_at,
      isExhausted: false,
      ctx: currentCtx,
    });
  }

  return {
    materials: page,
    nextCursor,
    summary: {
      scannedCandidates: scannedCandidates > 0 ? scannedCandidates : (lastEvaluatedIndex + 1),
      evaluatedCandidates: admittedCandidates.length,
      evaluatedCards: cumulativeCards,
      rawBytesTransferred: cumulativeRawBytes,
      actionableCount: page.length,
      againCount: page.reduce((acc, m) => acc + m.againCount, 0),
      dayCount: page.reduce((acc, m) => acc + m.dayCount, 0),
      totalDueCount: page.reduce((acc, m) => acc + m.totalDueCount, 0),
      newCount: page.reduce((acc, m) => acc + m.newCount, 0),
      isComplete: nextCursor === null,
      isPageLocal: true,
    },
  };
}

/**
 * Bounded library-wide recent reviews query (C2-D4, C2-R7, C2-R8, C2-R10).
 */
export function getLibraryRecentReviews(db, options = {}) {
  const limit = parseBoundedInteger(options.limit, 20, 1, 100);
  const maxBatchRawJsonBytesBudget = parseBoundedInteger(options.maxBatchRawJsonBytesBudget, 2097152, 1024, 64 * 1024 * 1024);
  const { topic, materialId } = options;
  const decoded = decodeCursor(options.cursor);

  // Validate cursor ownership context for history queries (R8)
  if (decoded) {
    if (decoded.v !== 1) {
      throw new Error("INVALID_CURSOR: unsupported cursor version (must be 1)");
    }
    if (decoded.type !== "history") {
      throw new Error("INVALID_CURSOR: unexpected cursor type");
    }
    if (!decoded.ctx || typeof decoded.ctx !== "object" || Array.isArray(decoded.ctx)) {
      throw new Error("INVALID_CURSOR: missing mandatory ownership context");
    }
    if (
      decoded.ctx.materialId !== (materialId ?? null) ||
      decoded.ctx.topic !== (topic ?? null)
    ) {
      throw new Error("STALE_CURSOR: history filter parameters changed");
    }
    if (typeof decoded.t !== "string" || !decoded.t || typeof decoded.id !== "string" || !decoded.id) {
      throw new Error("INVALID_CURSOR: history cursor missing keyset boundary (t and id required)");
    }
    if (isNaN(Date.parse(decoded.t))) {
      throw new Error("INVALID_CURSOR: history cursor timestamp is invalid");
    }
  }

  let eventSql = `
    SELECT
      e.id,
      e.item_id,
      e.generation,
      e.rating,
      e.reviewed_at,
      e.scheduler_version,
      e.prior_state_json,
      e.next_state_json,
      i.ordinal,
      i.front,
      i.back,
      i.source_page,
      v.id AS version_id,
      v.content_hash,
      v.created_at AS version_created_at,
      v.source_material_id AS material_id,
      m.title AS material_title,
      m.topic AS topic
    FROM card_review_events e
    JOIN card_items i ON i.id = e.item_id
    JOIN card_versions v ON v.id = i.version_id
    JOIN study_materials m ON m.id = v.source_material_id
    WHERE 1=1
  `;
  const eventParams = [];

  if (materialId) {
    eventSql += " AND m.id = ?";
    eventParams.push(materialId);
  }
  if (topic) {
    eventSql += " AND m.topic = ?";
    eventParams.push(topic);
  }

  if (decoded?.t && decoded?.id) {
    eventSql += `
      AND ((e.reviewed_at < ?) OR (e.reviewed_at = ? AND e.id < ?))
    `;
    eventParams.push(decoded.t, decoded.t, decoded.id);
  }

  eventSql += `
    ORDER BY e.reviewed_at DESC, e.id DESC
    LIMIT ?
  `;
  eventParams.push(limit + 1);

  // 1. Event keyset query
  const rawRows = db.prepare(eventSql).all(...eventParams);
  const hasMore = rawRows.length > limit;
  const pageRows = rawRows.slice(0, limit);

  let nextCursor = null;
  if (hasMore && pageRows.length > 0) {
    const last = pageRows[pageRows.length - 1];
    nextCursor = encodeCursor({
      v: 1,
      type: "history",
      t: last.reviewed_at,
      id: last.id,
      ctx: {
        materialId: materialId ?? null,
        topic: topic ?? null,
      },
    });
  }

  // 2. Preflight and bounded raw flashcards read for distinct materials on this page (C2-R4)
  const distinctMaterialIds = Array.from(new Set(pageRows.map((r) => r.material_id)));
  const currentVersionMap = new Map();
  let cumulativeRawBytes = 0;

  if (distinctMaterialIds.length > 0) {
    const mPlaceholders = distinctMaterialIds.map(() => "?").join(",");
    const lenRows = db
      .prepare(
        `SELECT source_material_id, LENGTH(CAST(flashcards_json AS BLOB)) AS byte_len
         FROM ai_study_sets
         WHERE source_material_id IN (${mPlaceholders})`
      )
      .all(...distinctMaterialIds);
    const byteLenMap = new Map(lenRows.map((r) => [r.source_material_id, r.byte_len]));

    const getSetStmt = db.prepare(
      "SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?"
    );

    for (let i = 0; i < distinctMaterialIds.length; i++) {
      const mId = distinctMaterialIds[i];
      const byteLen = byteLenMap.get(mId);
      if (byteLen === undefined || byteLen === null) {
        currentVersionMap.set(mId, { status: "unavailable" });
        continue;
      }

      // Check byte budget: if we already read at least one set, and next set exceeds budget:
      if (i > 0 && cumulativeRawBytes + byteLen > maxBatchRawJsonBytesBudget) {
        currentVersionMap.set(mId, { status: "pending" });
        continue;
      }

      const setRow = getSetStmt.get(mId);
      if (!setRow || setRow.flashcards_json === null || setRow.flashcards_json === undefined) {
        currentVersionMap.set(mId, { status: "unavailable" });
        continue;
      }

      cumulativeRawBytes += Buffer.byteLength(setRow.flashcards_json, "utf8");

      const rawJson = setRow.flashcards_json;
      if (typeof rawJson === "string" && rawJson.trim() === "[]") {
        currentVersionMap.set(mId, { status: "valid_empty" });
        continue;
      }
      const parsed = parseSavedCards(rawJson);
      if (parsed.status === "ok") {
        const derived = deriveCardVersion(mId, parsed.cards);
        currentVersionMap.set(mId, { status: "ok", versionId: derived.versionId });
      } else if (parsed.status === "malformed") {
        currentVersionMap.set(mId, { status: "malformed" });
      } else {
        currentVersionMap.set(mId, { status: "valid_empty" });
      }
    }
  }

  const enrichedRows = pageRows.map((row) => {
    const currentInfo = currentVersionMap.get(row.material_id);
    let isEarlierVersion = true;
    let contentStatus = "earlier";

    if (!currentInfo || currentInfo.status === "unavailable") {
      isEarlierVersion = true;
      contentStatus = "unavailable";
    } else if (currentInfo.status === "pending") {
      isEarlierVersion = null; // Cannot determine without reading raw set
      contentStatus = "pending";
    } else if (currentInfo.status === "valid_empty") {
      isEarlierVersion = true;
      contentStatus = "valid_empty";
    } else if (currentInfo.status === "malformed") {
      isEarlierVersion = true;
      contentStatus = "malformed";
    } else if (currentInfo.status === "ok") {
      if (currentInfo.versionId === row.version_id) {
        isEarlierVersion = false;
        contentStatus = "current";
      } else {
        isEarlierVersion = true;
        contentStatus = "earlier";
      }
    }

    const priorValidation = validateScheduleState(row.prior_state_json);
    const nextValidation = validateScheduleState(row.next_state_json);

    return {
      id: row.id,
      itemId: row.item_id,
      materialId: row.material_id,
      materialTitle: row.material_title,
      topic: row.topic,
      versionId: row.version_id,
      contentHash: row.content_hash,
      ordinal: row.ordinal,
      front: row.front,
      back: row.back,
      sourcePage: row.source_page,
      rating: row.rating,
      reviewedAt: row.reviewed_at,
      schedulerVersion: row.scheduler_version,
      priorStateRaw: row.prior_state_json ?? null,
      nextStateRaw: row.next_state_json ?? null,
      priorState: priorValidation.parsed,
      nextState: nextValidation.parsed,
      priorSchedule: priorValidation.schedule,
      nextSchedule: nextValidation.schedule,
      step: nextValidation.schedule?.step ?? null,
      dueAt: nextValidation.schedule?.dueAt ?? null,
      intervalDays: nextValidation.schedule?.intervalDays ?? null,
      intervalMinutes: nextValidation.schedule?.intervalMinutes ?? null,
      intervalLabel: nextValidation.schedule?.intervalLabel ?? null,
      isEarlierVersion,
      contentStatus,
    };
  });

  return {
    rows: enrichedRows,
    next: nextCursor,
  };
}

/**
 * Truly asynchronous deferred read controller for the UI (C2-R5, C2-R9).
 * Guarantees synchronous owned operation locks and authoritative replacement on invalidation.
 */
export class DeferredReadController {
  constructor(db, options = {}, reader = null) {
    this.db = db;
    this.options = { ...options };
    this.reader = reader ?? ((database, opts) => getLibraryReviewDue(database, opts));
    this.results = [];
    this.cursor = null;
    this.isComplete = false;
    this.isLoading = false;
    this.error = null;
    this.generation = 0;
    this.currentOp = null;
    this.busyPromise = null;
    this.lastFailedCursor = null;
    this.disposed = false;
  }

  loadNextPage() {
    if (this.disposed || this.isComplete) {
      return Promise.resolve(this.results);
    }
    if (this.busyPromise) {
      return this.busyPromise;
    }

    const reqGen = ++this.generation;
    const reqOp = Symbol("op");
    this.currentOp = reqOp;
    const reqCursor = this.cursor;
    this.isLoading = true;
    this.error = null;

    let resolveOp, rejectOp;
    const opPromise = new Promise((resolve, reject) => {
      resolveOp = resolve;
      rejectOp = reject;
    });
    this.busyPromise = opPromise;

    let readerRes;
    try {
      readerRes = this.reader(this.db, {
        ...this.options,
        cursor: reqCursor,
      });
    } catch (err) {
      if (this.currentOp === reqOp && this.generation === reqGen && !this.disposed) {
        this.isLoading = false;
        this.busyPromise = null;
        this.currentOp = null;
        this.error = err;
        this.lastFailedCursor = reqCursor;
      }
      rejectOp(err);
      return opPromise;
    }

    (async () => {
      try {
        const res = await readerRes;

        if (this.currentOp === reqOp && this.generation === reqGen && !this.disposed) {
          const isHistory = res && Array.isArray(res.rows);
          const items = res?.materials ?? res?.rows ?? [];

          for (const item of items) {
            const key = isHistory ? item.id : item.materialId ?? item.id;
            const existingIdx = this.results.findIndex(
              (r) => (isHistory ? r.id : r.materialId ?? r.id) === key
            );

            if (existingIdx !== -1) {
              this.results[existingIdx] = item;
            } else {
              this.results.push(item);
            }
          }

          this.cursor = res?.nextCursor ?? res?.next ?? null;
          this.isComplete = this.cursor === null;
          this.lastFailedCursor = null;
          this.isLoading = false;
          this.busyPromise = null;
          this.currentOp = null;
          resolveOp(this.results);
        } else {
          resolveOp(this.results);
        }
      } catch (err) {
        if (this.currentOp === reqOp && this.generation === reqGen && !this.disposed) {
          this.isLoading = false;
          this.busyPromise = null;
          this.currentOp = null;
          this.error = err;
          this.lastFailedCursor = reqCursor;
        }
        rejectOp(err);
      }
    })();

    return opPromise;
  }

  setFilter(newFilter = {}) {
    this.generation++;
    this.options = { ...this.options, ...newFilter };
    this.results = []; // Synchronously clears previous filter rows
    this.cursor = null;
    this.isComplete = false;
    this.isLoading = false;
    this.error = null;
    this.lastFailedCursor = null;
    this.busyPromise = null;
    this.currentOp = null;
  }

  retryRead() {
    if (!this.error) return Promise.resolve(this.results);
    this.cursor = this.lastFailedCursor;
    this.error = null;
    return this.loadNextPage();
  }

  /**
   * Authoritative refresh invalidation (R9): starts a fresh generation with empty rows/cursor.
   */
  onReset(materialId = null) {
    this.generation++;
    this.results = [];
    this.cursor = null;
    this.isComplete = false;
    this.isLoading = false;
    this.error = null;
    this.lastFailedCursor = null;
    this.busyPromise = null;
    this.currentOp = null;
  }

  onMaterialDeleted(materialId = null) {
    this.generation++;
    this.results = [];
    this.cursor = null;
    this.isComplete = false;
    this.isLoading = false;
    this.error = null;
    this.lastFailedCursor = null;
    this.busyPromise = null;
    this.currentOp = null;
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    this.isLoading = false;
    this.busyPromise = null;
    this.currentOp = null;
  }
}

/** Broken variants for negative control & mutation verification */
export function getLibraryReviewDueBrokenCurrentVersion(db, { nowUtc, nextLocalMidnightUtc }) {
  const sql = `
    SELECT
      m.id AS material_id,
      m.title,
      m.topic,
      m.priority,
      v.id AS active_version_id,
      SUM(CASE WHEN s.step < 0 AND s.due_at <= ? THEN 1 ELSE 0 END) AS again_count,
      SUM(CASE WHEN s.step >= 0 AND s.due_at < ? THEN 1 ELSE 0 END) AS day_count
    FROM card_review_state s
    JOIN card_items i ON i.id = s.item_id
    JOIN card_versions v ON v.id = i.version_id
    JOIN study_materials m ON m.id = v.source_material_id
    WHERE v.is_active = 1
      AND s.suspended = 0
      AND s.flag IS NULL
      AND s.due_at IS NOT NULL
      AND ((s.step < 0 AND s.due_at <= ?) OR (s.step >= 0 AND s.due_at < ?))
    GROUP BY m.id, m.title, m.topic, m.priority, v.id
  `;
  return db.prepare(sql).all(nowUtc, nextLocalMidnightUtc, nowUtc, nextLocalMidnightUtc);
}

export function getLibraryReviewDueBrokenTimeBoundary(db, { nowUtc }) {
  const utcDayLater = new Date(Date.parse(nowUtc) + 24 * 60 * 60 * 1000).toISOString();
  return getLibraryReviewDue(db, {
    nowUtc,
    nextLocalMidnightUtc: utcDayLater,
    limit: 50,
  });
}

export function getLibraryRecentReviewsBrokenCursor(db, { cursor = null, limit = 20 }) {
  const params = [];
  let sql = `
    SELECT e.id AS event_id, e.reviewed_at
    FROM card_review_events e
    WHERE 1=1
  `;
  if (cursor) {
    sql += " AND e.reviewed_at < ?";
    params.push(cursor.reviewedAt);
  }
  sql += " ORDER BY e.reviewed_at DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params);
}

export function getLibraryReviewDueBrokenCandidateProgression(db, { nowUtc, nextLocalMidnightUtc, limit = 50 }) {
  return getLibraryReviewDue(db, {
    nowUtc,
    nextLocalMidnightUtc,
    limit,
    candidateBatchBudget: 250,
    cursor: null,
  });
}
