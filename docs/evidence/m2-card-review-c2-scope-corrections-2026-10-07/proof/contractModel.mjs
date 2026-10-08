import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

export const MAX_CARDS = 500;
export const MAX_FRONT_CHARS = 2000;
export const MAX_BACK_CHARS = 4000;
export const MAX_SOURCE_PAGE = 2000;
export const AGAIN_DELAY_MINUTES = 10;
export const LADDER_DAYS = [1, 3, 7, 14, 30, 60, 120, 240];
export const SCHEDULER_VERSION = "simple-v1";
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map((item) => canonicalJson(item)).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function validText(text, maxChars) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > maxChars) return false;
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(trimmed);
}

export function parseSavedCards(flashcardsJson) {
  if (flashcardsJson === null || flashcardsJson === undefined) return { status: "none" };
  if (typeof flashcardsJson !== "string") return { status: "malformed" };
  const trimmed = flashcardsJson.trim();
  if (trimmed === "") return { status: "none" };
  let parsed;
  try {
    parsed = JSON.parse(flashcardsJson);
  } catch {
    return { status: "malformed" };
  }
  if (!Array.isArray(parsed)) return { status: "malformed" };
  if (parsed.length === 0) return { status: "none" };
  if (parsed.length > MAX_CARDS) return { status: "malformed" };
  const cards = [];
  for (const card of parsed) {
    if (card === null || typeof card !== "object" || Array.isArray(card)) return { status: "malformed" };
    const { front, back } = card;
    if (!Object.prototype.hasOwnProperty.call(card, "sourcePage")) return { status: "malformed" };
    const sourcePage = card.sourcePage;
    if (!validText(front, MAX_FRONT_CHARS) || !validText(back, MAX_BACK_CHARS)) return { status: "malformed" };
    if (
      sourcePage !== null &&
      !(typeof sourcePage === "number" && Number.isInteger(sourcePage) && sourcePage >= 1 && sourcePage <= MAX_SOURCE_PAGE)
    ) {
      return { status: "malformed" };
    }
    cards.push({ front, back, sourcePage });
  }
  return { status: "ok", cards };
}

/** Content-addressed card version derivation */
export function deriveCardVersion(materialId, cards) {
  const canonical = cards.map(({ front, back, sourcePage }) => ({ front, back, sourcePage }));
  const contentHash = sha256Hex(canonicalJson(canonical));
  const versionId = sha256Hex(`${materialId}\u0000${contentHash}`);
  const items = canonical.map((card, ordinal) => ({
    itemId: sha256Hex(`${versionId}\u0000${ordinal}`),
    ordinal,
    ...card,
  }));
  return { versionId, contentHash, items };
}

export function deriveCurrentCards(materialId, flashcardsJson) {
  const saved = parseSavedCards(flashcardsJson);
  if (saved.status !== "ok") return saved;
  return { status: "ok", ...deriveCardVersion(materialId, saved.cards) };
}

/** Schedule one rating with simple-v1 arithmetic */
export function scheduleCard(prior, rating, nowIso) {
  const now = Date.parse(nowIso);
  const from = prior?.step ?? -1;
  let lapses = prior?.lapses ?? 0;
  let step;
  let due;
  if (rating === "again") {
    if (from >= 0) lapses += 1;
    step = -1;
    due = now + AGAIN_DELAY_MINUTES * MINUTE;
  } else {
    step = rating === "hard" ? Math.max(0, from) : Math.min(from + (rating === "good" ? 1 : 2), LADDER_DAYS.length - 1);
    due = now + LADDER_DAYS[step] * DAY;
  }
  return {
    schedulerVersion: SCHEDULER_VERSION,
    step,
    reps: (prior?.reps ?? 0) + 1,
    lapses,
    lastReviewedAt: new Date(now).toISOString(),
    dueAt: new Date(due).toISOString(),
  };
}

/** Local calendar date format */
export function localDate(instantIso, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instantIso));
}

/** Next local midnight via bisection */
export function nextLocalMidnightUtc(nowIso, timeZone) {
  const today = localDate(nowIso, timeZone);
  let low = Date.parse(nowIso);
  let high = low + 50 * 60 * 60 * 1000;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (localDate(new Date(middle).toISOString(), timeZone) > today) high = middle;
    else low = middle;
  }
  return new Date(high).toISOString();
}

/** Initialize a disposable SQLite database with Schema 12 tables */
export function createDisposableDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");

  // Migration 0001 subset (study_materials)
  db.exec(`
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
    CREATE INDEX idx_materials_status ON study_materials(review_status);
    CREATE INDEX idx_materials_topic ON study_materials(topic);
    CREATE INDEX idx_materials_priority_updated ON study_materials(priority, updated_at DESC, id ASC);
  `);

  // Migration 0007 (ai_study_sets)
  db.exec(`
    CREATE TABLE ai_study_sets (
      source_material_id TEXT PRIMARY KEY REFERENCES study_materials(id) ON DELETE CASCADE,
      title              TEXT NOT NULL DEFAULT '',
      summary            TEXT NOT NULL DEFAULT '',
      sections_json      TEXT NOT NULL DEFAULT '[]',
      flashcards_json    TEXT NOT NULL DEFAULT '[]',
      source_notes       TEXT NOT NULL DEFAULT '',
      provider           TEXT NOT NULL DEFAULT 'gemini',
      model              TEXT NOT NULL DEFAULT '',
      generated_at       TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );
  `);

  // Migration 0011 (practice_attempts & versions for testing history separation)
  db.exec(`
    CREATE TABLE practice_test_versions (
      id                    TEXT PRIMARY KEY,
      source_material_id    TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
      history_key           TEXT NOT NULL,
      source_material_title TEXT NOT NULL,
      version_number        INTEGER NOT NULL DEFAULT 1,
      provider              TEXT NOT NULL DEFAULT 'gemini',
      model                 TEXT NOT NULL DEFAULT '',
      title                 TEXT NOT NULL DEFAULT '',
      content_hash          TEXT NOT NULL,
      created_at            TEXT NOT NULL,
      is_active             INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
    );

    CREATE TABLE practice_attempts (
      id                    TEXT PRIMARY KEY,
      version_id            TEXT NOT NULL REFERENCES practice_test_versions(id) ON DELETE RESTRICT,
      source_material_id    TEXT REFERENCES study_materials(id) ON DELETE SET NULL,
      source_material_title TEXT NOT NULL,
      started_at            TEXT NOT NULL,
      completed_at          TEXT,
      status                TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'abandoned')),
      revision              INTEGER NOT NULL DEFAULT 0,
      total_questions       INTEGER NOT NULL,
      answered_count        INTEGER NOT NULL DEFAULT 0,
      correct_count         INTEGER NOT NULL DEFAULT 0,
      incorrect_count       INTEGER NOT NULL DEFAULT 0,
      dont_know_count       INTEGER NOT NULL DEFAULT 0,
      score_percent         REAL
    );
  `);

  // Migration 0012 (card reviews)
  db.exec(`
    CREATE TABLE card_review_generations (
      source_material_id TEXT PRIMARY KEY REFERENCES study_materials(id) ON DELETE CASCADE,
      generation         INTEGER NOT NULL CHECK (generation >= 0)
    );

    CREATE TABLE card_versions (
      id                 TEXT PRIMARY KEY,
      source_material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
      content_hash       TEXT NOT NULL,
      card_count         INTEGER NOT NULL CHECK (card_count BETWEEN 1 AND 500),
      provider           TEXT NOT NULL CHECK (provider IN ('gemini', 'import')),
      created_at         TEXT NOT NULL,
      first_reviewed_at  TEXT,
      is_active          INTEGER NOT NULL CHECK (is_active IN (0, 1)),
      UNIQUE (source_material_id, content_hash)
    );

    CREATE UNIQUE INDEX uq_active_card_version
      ON card_versions(source_material_id)
      WHERE is_active = 1;

    CREATE TABLE card_items (
      id          TEXT PRIMARY KEY,
      version_id  TEXT NOT NULL REFERENCES card_versions(id) ON DELETE CASCADE,
      ordinal     INTEGER NOT NULL CHECK (ordinal >= 0),
      front       TEXT NOT NULL,
      back        TEXT NOT NULL,
      source_page INTEGER,
      UNIQUE (version_id, ordinal)
    );

    CREATE TABLE card_review_state (
      item_id            TEXT PRIMARY KEY REFERENCES card_items(id) ON DELETE CASCADE,
      source_material_id TEXT NOT NULL REFERENCES study_materials(id) ON DELETE CASCADE,
      scheduler_version  TEXT NOT NULL,
      step               INTEGER NOT NULL CHECK (step BETWEEN -1 AND 7),
      due_at             TEXT,
      last_reviewed_at   TEXT,
      reps               INTEGER NOT NULL DEFAULT 0 CHECK (reps >= 0),
      lapses             INTEGER NOT NULL DEFAULT 0 CHECK (lapses >= 0),
      suspended          INTEGER NOT NULL DEFAULT 0 CHECK (suspended IN (0, 1)),
      flag               TEXT CHECK (flag IN ('wrong_answer', 'unclear', 'not_in_source')),
      revision           INTEGER NOT NULL CHECK (revision >= 1),
      CHECK ((due_at IS NULL) = (last_reviewed_at IS NULL)),
      CHECK (due_at IS NOT NULL OR (reps = 0 AND step = -1))
    );

    CREATE INDEX idx_card_state_due
      ON card_review_state(source_material_id, suspended, due_at);

    CREATE TABLE card_review_events (
      id                TEXT PRIMARY KEY,
      item_id           TEXT NOT NULL REFERENCES card_items(id) ON DELETE CASCADE,
      generation        INTEGER NOT NULL CHECK (generation >= 0),
      rating            TEXT NOT NULL CHECK (rating IN ('again', 'hard', 'good', 'easy')),
      reviewed_at       TEXT NOT NULL,
      scheduler_version TEXT NOT NULL,
      prior_state_json  TEXT NOT NULL,
      next_state_json   TEXT NOT NULL
    );

    CREATE INDEX idx_card_events_item
      ON card_review_events(item_id, reviewed_at);

    CREATE TABLE card_review_operations (
      operation_id       TEXT PRIMARY KEY,
      action             TEXT NOT NULL CHECK (action IN ('rate', 'suspend', 'resume', 'flag', 'unflag', 'reset')),
      source_material_id TEXT NOT NULL,
      generation         INTEGER NOT NULL CHECK (generation >= 0),
      request_hash       TEXT NOT NULL,
      applied_at         TEXT NOT NULL,
      is_erased          INTEGER NOT NULL DEFAULT 0 CHECK (is_erased IN (0, 1)),
      result_json        TEXT,
      CHECK ((is_erased = 1) = (result_json IS NULL))
    );

    CREATE INDEX idx_card_ops_material
      ON card_review_operations(source_material_id);

    CREATE TRIGGER trg_card_ops_material_delete
    AFTER DELETE ON study_materials
    FOR EACH ROW
    BEGIN
      UPDATE card_review_operations
      SET is_erased = 1, result_json = NULL
      WHERE source_material_id = OLD.id AND is_erased = 0;
    END;
  `);

  return db;
}

/** Decode an opaque due cursor */
export function decodeDueCursor(cursor, db = null) {
  if (!cursor) return null;
  if (typeof cursor === "object") {
    if (cursor.id && cursor.u !== undefined) {
      return { p: cursor.p ?? 1, u: cursor.u, id: cursor.id };
    }
    return cursor;
  }
  if (typeof cursor === "string") {
    const trimmed = cursor.trim();
    if (trimmed.startsWith("{")) {
      try {
        const obj = JSON.parse(trimmed);
        return { p: obj.p ?? 1, u: obj.u, id: obj.id };
      } catch {
        // continue
      }
    }
    // Fallback if plain material ID is passed
    if (db) {
      const row = db.prepare("SELECT priority, updated_at, id FROM study_materials WHERE id = ?").get(trimmed);
      if (row) {
        return {
          p: row.priority === "next_up" ? 0 : 1,
          u: row.updated_at,
          id: row.id,
        };
      }
    }
    return { p: 1, u: "9999-12-31T23:59:59.999Z", id: trimmed };
  }
  return null;
}

/** Encode an opaque due cursor */
export function encodeDueCursor(candidate) {
  if (!candidate) return null;
  const p = candidate.priority === "next_up" ? 0 : 1;
  const u = candidate.updated_at;
  const id = candidate.material_id ?? candidate.id;
  return JSON.stringify({ p, u, id });
}

/**
 * Corrected Candidate C2 Query 1: Bounded Library-Wide "Review Due" Discovery
 * 
 * Features:
 * - Deterministic keyset candidate progression: (priority, updated_at DESC, id ASC)
 * - Strict candidate evaluation budget per request (default 250) preventing runaway scans
 * - Real consumable nextCursor advancing across candidate batches
 * - Raw saved cards own current version identity (via deriveCardVersion)
 * - Retained review schedules queried strictly for the current version (ignoring is_active)
 * - Non-destructive read: 0-write reversion and schedule recovery
 */
export function getLibraryReviewDue(db, {
  nowUtc,
  nextLocalMidnightUtc,
  topic = null,
  statusFilter = "all", // "all" | "due_today" | "new_only"
  limit = 50,
  cursor = null,
  candidateBatchBudget = 250,
}) {
  const decodedCursor = decodeDueCursor(cursor, db);

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

  if (topic) {
    candidateSql += " AND m.topic = ?";
    candidateParams.push(topic);
  }

  if (decodedCursor) {
    candidateSql += `
      AND (
        (CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END > ?)
        OR (CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END = ? AND m.updated_at < ?)
        OR (CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END = ? AND m.updated_at = ? AND m.id > ?)
      )
    `;
    candidateParams.push(
      decodedCursor.p,
      decodedCursor.p, decodedCursor.u,
      decodedCursor.p, decodedCursor.u, decodedCursor.id
    );
  }

  candidateSql += `
    ORDER BY
      CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END ASC,
      m.updated_at DESC,
      m.id ASC
    LIMIT ?
  `;
  // Fetch up to budget + 1 to detect if further candidates exist in DB
  candidateParams.push(candidateBatchBudget + 1);

  const rawCandidateRows = db.prepare(candidateSql).all(...candidateParams);
  const hasMoreInDb = rawCandidateRows.length > candidateBatchBudget;
  const candidateBatch = rawCandidateRows.slice(0, candidateBatchBudget);

  const foundMaterials = [];
  let lastScannedCandidate = null;
  let scannedCandidateCount = 0;
  let hitLimit = false;

  for (let idx = 0; idx < candidateBatch.length; idx++) {
    const candidate = candidateBatch[idx];
    lastScannedCandidate = candidate;
    scannedCandidateCount++;

    // Authoritative raw content read
    const setRow = db.prepare("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?").get(candidate.material_id);
    const parsed = parseSavedCards(setRow?.flashcards_json);
    if (parsed.status !== "ok" || parsed.cards.length === 0) {
      continue;
    }

    // Derive current version directly from raw saved cards
    const derived = deriveCardVersion(candidate.material_id, parsed.cards);

    // Look up snapshot by exact derived version ID (regardless of is_active flag!)
    const versionRow = db.prepare("SELECT id, card_count FROM card_versions WHERE id = ?").get(derived.versionId);

    let againCount = 0;
    let dayCount = 0;
    let touchedCount = 0;
    let earliestDueAt = null;
    let hasActiveVersion = false;
    let activeVersionId = null;

    if (versionRow) {
      hasActiveVersion = true;
      activeVersionId = derived.versionId;

      // Query state rows strictly joined to current version items
      const stateRows = db.prepare(`
        SELECT
          s.step,
          s.due_at,
          s.suspended,
          s.flag
        FROM card_review_state s
        JOIN card_items i ON i.id = s.item_id
        WHERE i.version_id = ?
      `).all(derived.versionId);

      for (const s of stateRows) {
        const isTouched = s.due_at !== null || s.suspended === 1 || s.flag !== null;
        if (isTouched) touchedCount++;

        const isDue = s.suspended === 0 && s.flag === null && s.due_at !== null;
        if (isDue) {
          if (s.step < 0 && s.due_at <= nowUtc) {
            againCount++;
            if (!earliestDueAt || s.due_at < earliestDueAt) earliestDueAt = s.due_at;
          } else if (s.step >= 0 && s.due_at < nextLocalMidnightUtc) {
            dayCount++;
            if (!earliestDueAt || s.due_at < earliestDueAt) earliestDueAt = s.due_at;
          }
        }
      }
    }

    const totalDueCount = againCount + dayCount;
    const newCount = Math.max(0, parsed.cards.length - touchedCount);

    let isMatch = false;
    if (statusFilter === "due_today") {
      isMatch = totalDueCount > 0;
    } else if (statusFilter === "new_only") {
      isMatch = totalDueCount === 0 && newCount > 0;
    } else {
      isMatch = totalDueCount > 0 || newCount > 0;
    }

    if (isMatch) {
      foundMaterials.push({
        materialId: candidate.material_id,
        title: candidate.title,
        topic: candidate.topic,
        reviewStatus: candidate.review_status,
        priority: candidate.priority,
        updatedAt: candidate.updated_at,
        cardCount: parsed.cards.length,
        againCount,
        dayCount,
        newCount,
        totalDueCount,
        earliestDueAt,
        hasActiveVersion,
        activeVersionId,
      });

      if (foundMaterials.length >= limit) {
        hitLimit = true;
        break;
      }
    }
  }

  // Determine nextCursor
  let nextCursor = null;
  if (hitLimit) {
    const candidateIdx = candidateBatch.indexOf(lastScannedCandidate);
    if (candidateIdx < candidateBatch.length - 1 || hasMoreInDb) {
      nextCursor = encodeDueCursor(lastScannedCandidate);
    }
  } else if (hasMoreInDb && lastScannedCandidate) {
    nextCursor = encodeDueCursor(lastScannedCandidate);
  }

  // Summary statistics across this scanned page
  const summary = {
    totalMaterialsWithDue: foundMaterials.filter((m) => m.totalDueCount > 0).length,
    totalMaterialsWithNew: foundMaterials.filter((m) => m.newCount > 0).length,
    totalDueCards: foundMaterials.reduce((acc, m) => acc + m.totalDueCount, 0),
    totalNewCards: foundMaterials.reduce((acc, m) => acc + m.newCount, 0),
    scannedCandidates: scannedCandidateCount,
    isComplete: nextCursor === null,
  };

  return { summary, materials: foundMaterials, nextCursor };
}

/**
 * Corrected Candidate C2 Query 2: Library-Wide History Keyset Paging
 * 
 * Features:
 * - Deterministic keyset paging: (reviewed_at DESC, event_id DESC)
 * - Batch provenance verification: loads distinct material raw cards to derive current version
 * - Accurate isEarlierVersion label based on raw saved identity, NOT stale is_active flags
 */
export function getLibraryRecentReviews(db, {
  cursor = null, // { reviewedAt: string, id: string }
  limit = 20,
  topic = null,
  materialId = null,
}) {
  const params = [];
  let sql = `
    SELECT
      e.id AS event_id,
      e.item_id,
      e.rating,
      e.reviewed_at,
      e.scheduler_version,
      e.generation,
      i.front,
      i.source_page,
      v.id AS version_id,
      v.content_hash,
      v.is_active,
      m.id AS material_id,
      m.title AS material_title,
      m.topic AS material_topic
    FROM card_review_events e
    JOIN card_items i ON i.id = e.item_id
    JOIN card_versions v ON v.id = i.version_id
    JOIN study_materials m ON m.id = v.source_material_id
    WHERE 1=1
  `;

  if (topic) {
    sql += " AND m.topic = ?";
    params.push(topic);
  }
  if (materialId) {
    sql += " AND m.id = ?";
    params.push(materialId);
  }
  if (cursor) {
    sql += " AND (e.reviewed_at < ? OR (e.reviewed_at = ? AND e.id < ?))";
    params.push(cursor.reviewedAt, cursor.reviewedAt, cursor.id);
  }

  sql += " ORDER BY e.reviewed_at DESC, e.id DESC LIMIT ?";
  params.push(limit + 1);

  const rows = db.prepare(sql).all(...params);
  const pageRows = rows.slice(0, limit);

  // Batch load raw content for distinct materials in this page
  const distinctMaterialIds = [...new Set(pageRows.map((r) => String(r.material_id)))];
  const currentVersionMap = new Map();

  for (const mId of distinctMaterialIds) {
    const setRow = db.prepare("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?").get(mId);
    const parsed = parseSavedCards(setRow?.flashcards_json);
    if (parsed.status === "ok") {
      const derived = deriveCardVersion(mId, parsed.cards);
      currentVersionMap.set(mId, derived.versionId);
    } else {
      currentVersionMap.set(mId, null);
    }
  }

  const page = pageRows.map((r) => {
    const curVerId = currentVersionMap.get(String(r.material_id));
    const isEarlierVersion = curVerId !== null ? String(r.version_id) !== curVerId : true;

    return {
      id: String(r.event_id),
      itemId: String(r.item_id),
      rating: String(r.rating),
      reviewedAt: String(r.reviewed_at),
      schedulerVersion: String(r.scheduler_version),
      generation: Number(r.generation),
      front: String(r.front),
      sourcePage: r.source_page !== null ? Number(r.source_page) : null,
      materialId: String(r.material_id),
      materialTitle: String(r.material_title),
      materialTopic: String(r.material_topic),
      versionId: String(r.version_id),
      isEarlierVersion,
    };
  });

  const last = page.at(-1);
  const next = rows.length > limit && last ? { reviewedAt: last.reviewedAt, id: last.id } : null;

  return { rows: page, next };
}

/** Deliberately wrong query variants for negative controls */
export function getLibraryReviewDueBrokenCurrentVersion(db, { nowUtc, nextLocalMidnightUtc }) {
  // Deliberately uses v.is_active = 1 without verifying raw saved cards
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
  // Uses UTC 24h cutoff instead of local calendar midnight
  const utcDayLater = new Date(Date.parse(nowUtc) + 24 * 60 * 60 * 1000).toISOString();
  return getLibraryReviewDue(db, {
    nowUtc,
    nextLocalMidnightUtc: utcDayLater,
    limit: 50,
  });
}

export function getLibraryRecentReviewsBrokenCursor(db, { cursor = null, limit = 20 }) {
  // Omits e.id tie-breaker from pagination cursor
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
  // Takes only the first 250 candidates without continuation (reproducing submitted defect)
  return getLibraryReviewDue(db, {
    nowUtc,
    nextLocalMidnightUtc,
    limit,
    candidateBatchBudget: 250,
    cursor: null,
  });
}

/**
 * Deferred-Read Controller Model (for C2-R5)
 * 
 * Manages query generations, invalidation tokens, held continuations,
 * retry without replay, and safe disposal across route/filter changes.
 */
export class DeferredReadController {
  constructor(db, options = {}) {
    this.db = db;
    this.options = options;
    this.generation = 0;
    this.cursor = null;
    this.results = [];
    this.status = "idle"; // "idle" | "loading" | "success" | "error"
    this.lastError = null;
    this.heldContinuation = null;
  }

  setFilter(newOptions) {
    this.generation++;
    this.options = { ...this.options, ...newOptions };
    this.cursor = null;
    this.heldContinuation = null;
    this.status = "idle";
  }

  async loadNextPage() {
    const reqGen = this.generation;
    this.status = "loading";

    try {
      const res = getLibraryReviewDue(this.db, {
        ...this.options,
        cursor: this.cursor,
      });

      // Ignore if generation changed while reading
      if (this.generation !== reqGen) {
        return { stale: true };
      }

      this.results.push(...res.materials);
      this.cursor = res.nextCursor;
      this.heldContinuation = res.nextCursor;
      this.status = "success";
      return { stale: false, data: res };
    } catch (err) {
      if (this.generation === reqGen) {
        this.status = "error";
        this.lastError = err;
      }
      throw err;
    }
  }

  retryRead() {
    // Retries read using held cursor without replaying any write
    if (this.status === "error") {
      this.status = "idle";
      this.lastError = null;
      return this.loadNextPage();
    }
    return Promise.resolve({ stale: false });
  }

  onReset(materialId, newGeneration) {
    // When reset occurs, generation changes, forcing fresh authoritative re-read
    this.generation++;
    this.cursor = null;
    this.heldContinuation = null;
    this.results = this.results.filter((m) => m.materialId !== materialId);
    this.status = "idle";
  }

  onMaterialDeleted(materialId) {
    this.results = this.results.filter((m) => m.materialId !== materialId);
    if (this.cursor && this.cursor.includes(materialId)) {
      this.cursor = null;
      this.heldContinuation = null;
    }
  }
}
