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
 * Base64 cursor helper
 */
function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

function decodeCursor(cursorStr) {
  if (!cursorStr) return null;
  try {
    const raw = Buffer.from(cursorStr, "base64").toString("utf8");
    return JSON.parse(raw);
  } catch {
    throw new Error("INVALID_CURSOR: malformed pagination cursor");
  }
}

/**
 * Internal helper to evaluate review due status for a list of candidate study material records.
 */
function evaluateCandidates(db, candidates, nowUtc, nextMidnight) {
  if (!candidates || candidates.length === 0) return [];

  const candidateIds = candidates.map((c) => c.material_id);
  const cPlaceholders = candidateIds.map(() => "?").join(",");
  const setRows = db
    .prepare(
      `SELECT source_material_id, flashcards_json FROM ai_study_sets WHERE source_material_id IN (${cPlaceholders})`
    )
    .all(...candidateIds);
  const rawCardMap = new Map(setRows.map((r) => [r.source_material_id, r.flashcards_json]));

  const validDerived = [];
  for (const cand of candidates) {
    const rawJson = rawCardMap.get(cand.material_id);
    const parsed = parseSavedCards(rawJson);
    if (parsed.status === "ok" && parsed.cards.length > 0) {
      const derived = deriveCardVersion(cand.material_id, parsed.cards);
      validDerived.push({ candidate: cand, derived });
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
 * Bounded library-wide review due query (C2-D3, C2-R7, C2-R8).
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

  // Hard caps (max 250 candidates, max 250 limit)
  const candidateBatchBudget = Math.min(250, Math.max(1, Number(options.candidateBatchBudget ?? 250) || 250));
  const limit = Math.min(250, Math.max(1, Number(options.limit ?? 50) || 50));

  const decoded = decodeCursor(cursor);

  // Validate cursor query ownership and clock boundary (C2-R8)
  if (decoded) {
    if (decoded.type !== "due") {
      throw new Error("INVALID_CURSOR: unexpected cursor type");
    }
    if (decoded.ctx) {
      if (
        decoded.ctx.topic !== normalizedTopic ||
        decoded.ctx.statusFilter !== normalizedStatus ||
        decoded.ctx.nowUtc !== nowUtc ||
        decoded.ctx.nextLocalMidnightUtc !== nextMidnight
      ) {
        throw new Error("STALE_CURSOR: query parameters, filter, or clock boundary changed");
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

  // If cursor contains pending candidate IDs from a previous batch, revalidate them against DB (C2-R8)
  if (decoded?.remIds && Array.isArray(decoded.remIds) && decoded.remIds.length > 0) {
    const remIdsPlaceholders = decoded.remIds.map(() => "?").join(",");
    let remCandidateSql = `
      SELECT
        m.id AS material_id,
        m.title,
        m.topic,
        m.review_status,
        m.priority,
        m.updated_at
      FROM study_materials m
      JOIN ai_study_sets a ON a.source_material_id = m.id
      WHERE m.id IN (${remIdsPlaceholders})
        AND a.flashcards_json IS NOT NULL
        AND a.flashcards_json != '[]'
        AND a.flashcards_json != ''
    `;
    const remParams = [...decoded.remIds];
    if (normalizedTopic) {
      remCandidateSql += " AND m.topic = ?";
      remParams.push(normalizedTopic);
    }

    const liveCandidates = db.prepare(remCandidateSql).all(...remParams);
    const liveCandidateMap = new Map(liveCandidates.map((c) => [c.material_id, c]));

    // Preserve order of decoded.remIds
    const orderedLiveCandidates = [];
    for (const id of decoded.remIds) {
      const c = liveCandidateMap.get(id);
      if (c) orderedLiveCandidates.push(c);
    }

    const reevaluated = evaluateCandidates(db, orderedLiveCandidates, nowUtc, nextMidnight);
    const actionablePending = reevaluated.filter(matchesStatusFilter);

    // Serve up to limit
    const page = actionablePending.slice(0, limit);
    const remLeftIds = decoded.remIds.slice(limit);

    let nextCursor = null;
    if (remLeftIds.length > 0) {
      nextCursor = encodeCursor({
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
        scannedCandidates: 0,
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

  // Otherwise, query the next batch of candidate materials from the database
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

  // 2. Real Batched evaluation
  const evaluatedBatch = evaluateCandidates(db, candidateBatch, nowUtc, nextMidnight);
  const actionableList = evaluatedBatch.filter(matchesStatusFilter);

  // 3. Within-batch Urgency Ranking
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

  // 4. Partition into requested page and remaining batch items
  const page = actionableList.slice(0, limit);
  const remainingActionable = actionableList.slice(limit);
  const remainingIds = remainingActionable.map((m) => m.materialId);

  const lastCandidate = candidateBatch[candidateBatch.length - 1];
  const isExhausted = !hasMoreInDb;

  let nextCursor = null;
  if (remainingIds.length > 0) {
    nextCursor = encodeCursor({
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
      scannedCandidates: candidateBatch.length,
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
 * Bounded library-wide recent reviews query (C2-D4, C2-R7, C2-R10).
 */
export function getLibraryRecentReviews(db, options = {}) {
  const limit = Math.min(100, Math.max(1, Number(options.limit ?? 20) || 20));
  const { topic, materialId } = options;
  const decoded = decodeCursor(options.cursor);

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
    nextCursor = encodeCursor({ type: "history", t: last.reviewed_at, id: last.id });
  }

  // 2. Real Batched raw flashcards read for distinct materials on this page
  const distinctMaterialIds = Array.from(new Set(pageRows.map((r) => r.material_id)));
  const rawCardMap = new Map();

  if (distinctMaterialIds.length > 0) {
    const mPlaceholders = distinctMaterialIds.map(() => "?").join(",");
    const setRows = db
      .prepare(
        `SELECT source_material_id, flashcards_json FROM ai_study_sets WHERE source_material_id IN (${mPlaceholders})`
      )
      .all(...distinctMaterialIds);
    for (const r of setRows) {
      rawCardMap.set(r.source_material_id, r.flashcards_json);
    }
  }

  const currentVersionMap = new Map();
  for (const mId of distinctMaterialIds) {
    if (!rawCardMap.has(mId)) {
      // Row absent from ai_study_sets
      currentVersionMap.set(mId, { status: "unavailable" });
      continue;
    }
    const rawJson = rawCardMap.get(mId);
    if (rawJson === null || rawJson === undefined) {
      currentVersionMap.set(mId, { status: "unavailable" });
      continue;
    }
    if (typeof rawJson === "string" && rawJson.trim() === "[]") {
      // Valid-empty guide-only array is distinct from unavailable (C2-R10)
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

  const enrichedRows = pageRows.map((row) => {
    const currentInfo = currentVersionMap.get(row.material_id);
    let isEarlierVersion = true;
    let contentStatus = "earlier";

    if (!currentInfo || currentInfo.status === "unavailable") {
      isEarlierVersion = true;
      contentStatus = "unavailable";
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

    let priorState = null;
    let nextState = null;
    try {
      priorState = row.prior_state_json ? JSON.parse(row.prior_state_json) : null;
    } catch {
      priorState = null;
    }
    try {
      nextState = row.next_state_json ? JSON.parse(row.next_state_json) : null;
    } catch {
      nextState = null;
    }

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
      priorState,
      nextState,
      step: nextState?.step ?? null,
      dueAt: nextState?.dueAt ?? null,
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
    const reqCursor = this.cursor;
    this.isLoading = true;
    this.error = null;

    let readerRes;
    try {
      readerRes = this.reader(this.db, {
        ...this.options,
        cursor: reqCursor,
      });
    } catch (err) {
      this.isLoading = false;
      this.busyPromise = null;
      if (this.generation === reqGen && !this.disposed) {
        this.error = err;
        this.lastFailedCursor = reqCursor;
      }
      return Promise.reject(err);
    }

    const opPromise = (async () => {
      try {
        const res = await readerRes;

        // Discard result if generation bumped or controller disposed while awaiting
        if (this.generation !== reqGen || this.disposed) {
          return this.results;
        }

        const isHistory = res && Array.isArray(res.rows);
        const items = res?.materials ?? res?.rows ?? [];

        for (const item of items) {
          // Explicit identity by reader kind: due rows by materialId, history rows by id (C2-R9)
          const key = isHistory ? item.id : item.materialId ?? item.id;
          const existingIdx = this.results.findIndex((r) => (isHistory ? r.id : r.materialId ?? r.id) === key);

          if (existingIdx !== -1) {
            // Replace existing entry with fresh authoritative summary (C2-R9)
            this.results[existingIdx] = item;
          } else {
            this.results.push(item);
          }
        }

        this.cursor = res?.nextCursor ?? res?.next ?? null;
        this.isComplete = this.cursor === null;
        this.lastFailedCursor = null;
        return this.results;
      } catch (err) {
        if (this.generation === reqGen && !this.disposed) {
          this.error = err;
          this.lastFailedCursor = reqCursor;
        }
        throw err;
      } finally {
        if (this.generation === reqGen) {
          this.isLoading = false;
          this.busyPromise = null;
        }
      }
    })();

    this.busyPromise = opPromise;
    return opPromise;
  }

  setFilter(newFilter = {}) {
    this.generation++;
    this.options = { ...this.options, ...newFilter };
    this.results = []; // Synchronously clears previous filter rows
    this.cursor = null;
    this.isComplete = false;
    this.isLoading = false; // Immediately clears loading on idle invalidation (C2-R9)
    this.error = null;
    this.lastFailedCursor = null;
    this.busyPromise = null;
  }

  retryRead() {
    if (!this.error) return Promise.resolve(this.results);
    this.cursor = this.lastFailedCursor;
    this.error = null;
    return this.loadNextPage();
  }

  onReset(materialId) {
    this.generation++;
    this.results = this.results.filter((r) => (r.materialId ?? r.id) !== materialId);
    this.cursor = null;
    this.isComplete = false;
    this.isLoading = false;
    this.busyPromise = null;
  }

  onMaterialDeleted(materialId) {
    this.generation++;
    this.results = this.results.filter((r) => (r.materialId ?? r.id) !== materialId);
    this.cursor = null;
    this.isComplete = false;
    this.isLoading = false;
    this.busyPromise = null;
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    this.isLoading = false;
    this.busyPromise = null;
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
