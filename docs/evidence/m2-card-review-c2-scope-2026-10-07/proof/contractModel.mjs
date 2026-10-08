/**
 * C2 Disposable Proof Contract Model and Candidate Query Engine
 * 
 * Implements:
 * 1. Pure canonical JSON, SHA-256 hashing, and card version derivation (matching C1 logic/cardIdentity.ts).
 * 2. Pure simple-v1 scheduling arithmetic and local calendar midnight bisection (matching C1).
 * 3. Exact DDL setup for migrations 0001, 0007, 0011, and 0012 on node:sqlite DatabaseSync.
 * 4. Candidate C2 repository read queries:
 *    - getLibraryReviewDue: finds materials with due Again cards, due Day cards, and new cards.
 *    - getLibraryRecentReviews: keyset-paginated library-wide card review events.
 *    - getMaterialReviewSnapshot: C1 material snapshot for comparison.
 * 5. Negative control variants for deliberate semantic assertion failures.
 */
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";

export const SCHEDULER_VERSION = "simple-v1";
export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;
export const AGAIN_DELAY_MINUTES = 10;
export const LADDER_DAYS = Object.freeze([1, 3, 7, 16, 35, 75, 150, 180]);
export const MAX_CARDS = 500;
export const MAX_FRONT_CHARS = 1000;
export const MAX_BACK_CHARS = 2000;
export const MAX_SOURCE_PAGE = 1000;

/** Sorted-key compact JSON matching C1 canonicalJson */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Lower-case hex SHA-256 of UTF-8 text */
export function sha256Hex(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function trimmedCodePoints(text) {
  return Array.from(text.trim()).length;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function validText(value, max) {
  if (typeof value !== "string" || LONE_SURROGATE.test(value)) return false;
  const length = trimmedCodePoints(value);
  return length >= 1 && length <= max;
}

/** Parse and validate saved flashcards_json */
export function parseSavedCards(flashcardsJson) {
  if (flashcardsJson === null || flashcardsJson === undefined) return { status: "none" };
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

/**
 * Candidate C2 Query 1: Library-Wide "Review Due" Discovery
 * 
 * Bounded on-demand discovery design:
 * 1. Targeted SQL query finds active snapshot materials with due cards (Again and Day ladder).
 * 2. Hash verification checks candidate materials against current raw saved cards.
 *    If raw cards changed (A -> B unmaterialized), A's due rows are excluded and B's cards are marked new.
 * 3. Targeted SQL query discovers candidate materials with unreviewed/new cards.
 * 4. Combines, prioritizes, and deterministically pages the results.
 */
export function getLibraryReviewDue(db, {
  nowUtc,
  nextLocalMidnightUtc,
  topic = null,
  statusFilter = "all", // "all" | "due_today" | "new_only"
  limit = 100,
  maxNewDiscovery = 250,
}) {
  // Step 1: Active materialized due cards
  let dueSql = `
    SELECT
      m.id AS material_id,
      m.title,
      m.topic,
      m.review_status,
      m.priority,
      m.updated_at,
      v.id AS active_version_id,
      v.content_hash AS active_content_hash,
      v.card_count AS active_card_count,
      SUM(CASE WHEN s.step < 0 AND s.due_at <= ? THEN 1 ELSE 0 END) AS again_count,
      SUM(CASE WHEN s.step >= 0 AND s.due_at < ? THEN 1 ELSE 0 END) AS day_count,
      MIN(CASE WHEN ((s.step < 0 AND s.due_at <= ?) OR (s.step >= 0 AND s.due_at < ?)) THEN s.due_at ELSE NULL END) AS earliest_due_at,
      (SELECT COUNT(*) FROM card_review_state crs
       WHERE crs.source_material_id = m.id
         AND (crs.due_at IS NOT NULL OR crs.suspended = 1 OR crs.flag IS NOT NULL)) AS touched_count
    FROM card_review_state s
    JOIN card_items i ON i.id = s.item_id
    JOIN card_versions v ON v.id = i.version_id
    JOIN study_materials m ON m.id = v.source_material_id
    WHERE v.is_active = 1
      AND s.suspended = 0
      AND s.flag IS NULL
      AND s.due_at IS NOT NULL
      AND ((s.step < 0 AND s.due_at <= ?) OR (s.step >= 0 AND s.due_at < ?))
  `;
  const dueParams = [
    nowUtc, nextLocalMidnightUtc,
    nowUtc, nextLocalMidnightUtc,
    nowUtc, nextLocalMidnightUtc,
  ];

  if (topic) {
    dueSql += " AND m.topic = ?";
    dueParams.push(topic);
  }

  dueSql += `
    GROUP BY m.id, m.title, m.topic, m.review_status, m.priority, m.updated_at, v.id, v.content_hash, v.card_count
  `;

  const dueRows = db.prepare(dueSql).all(...dueParams);

  // Map to hold aggregated results per material
  const materialMap = new Map();
  const verifiedIds = new Set();

  for (const row of dueRows) {
    const materialId = String(row.material_id);
    verifiedIds.add(materialId);

    // Verify current content from ai_study_sets
    const setRow = db.prepare("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?").get(materialId);
    const parsed = parseSavedCards(setRow?.flashcards_json);

    if (parsed.status === "ok") {
      const derived = deriveCardVersion(materialId, parsed.cards);
      if (derived.contentHash === String(row.active_content_hash)) {
        // Content is identical: active version matches saved content!
        const againCount = Number(row.again_count);
        const dayCount = Number(row.day_count);
        const touchedCount = Number(row.touched_count);
        const totalCards = Number(row.active_card_count);
        const newCount = Math.max(0, totalCards - touchedCount);

        materialMap.set(materialId, {
          materialId,
          title: String(row.title),
          topic: String(row.topic),
          reviewStatus: String(row.review_status),
          priority: String(row.priority),
          updatedAt: String(row.updated_at),
          cardCount: totalCards,
          againCount,
          dayCount,
          newCount,
          totalDueCount: againCount + dayCount,
          earliestDueAt: row.earliest_due_at ? String(row.earliest_due_at) : null,
          hasActiveVersion: true,
          activeVersionId: String(row.active_version_id),
        });
      } else {
        // Content CHANGED from A to B! Version A's due work is retired and excluded!
        // Version B has no snapshot yet, so all B cards are NEW.
        materialMap.set(materialId, {
          materialId,
          title: String(row.title),
          topic: String(row.topic),
          reviewStatus: String(row.review_status),
          priority: String(row.priority),
          updatedAt: String(row.updated_at),
          cardCount: parsed.cards.length,
          againCount: 0,
          dayCount: 0,
          newCount: parsed.cards.length,
          totalDueCount: 0,
          earliestDueAt: null,
          hasActiveVersion: false,
          activeVersionId: null,
        });
      }
    }
  }

  // Step 2: Discover materials with unreviewed / new cards (excluding those already processed)
  let newSql = `
    SELECT
      m.id AS material_id,
      m.title,
      m.topic,
      m.review_status,
      m.priority,
      m.updated_at,
      a.flashcards_json,
      v.id AS active_version_id,
      v.content_hash AS active_content_hash,
      v.card_count AS active_card_count
    FROM study_materials m
    JOIN ai_study_sets a ON a.source_material_id = m.id
    LEFT JOIN card_versions v ON v.source_material_id = m.id AND v.is_active = 1
    WHERE a.flashcards_json IS NOT NULL
      AND a.flashcards_json != '[]'
      AND a.flashcards_json != ''
  `;
  const newParams = [];

  if (topic) {
    newSql += " AND m.topic = ?";
    newParams.push(topic);
  }

  newSql += `
    ORDER BY CASE WHEN m.priority = 'next_up' THEN 0 ELSE 1 END, m.updated_at DESC
    LIMIT ?
  `;
  newParams.push(maxNewDiscovery);

  const newCandidateRows = db.prepare(newSql).all(...newParams);

  for (const row of newCandidateRows) {
    const materialId = String(row.material_id);
    if (materialMap.has(materialId)) continue; // Already processed in due query

    const parsed = parseSavedCards(row.flashcards_json);
    if (parsed.status !== "ok") continue; // none or malformed

    if (!row.active_version_id) {
      // Unmaterialized material: all valid cards are new!
      materialMap.set(materialId, {
        materialId,
        title: String(row.title),
        topic: String(row.topic),
        reviewStatus: String(row.review_status),
        priority: String(row.priority),
        updatedAt: String(row.updated_at),
        cardCount: parsed.cards.length,
        againCount: 0,
        dayCount: 0,
        newCount: parsed.cards.length,
        totalDueCount: 0,
        earliestDueAt: null,
        hasActiveVersion: false,
        activeVersionId: null,
      });
    } else {
      // Materialized version exists, but had 0 due cards. Check if any unrated cards remain.
      const derived = deriveCardVersion(materialId, parsed.cards);
      if (derived.contentHash === String(row.active_content_hash)) {
        const touchedRow = db.prepare(`
          SELECT COUNT(*) AS count FROM card_review_state
          WHERE source_material_id = ? AND (due_at IS NOT NULL OR suspended = 1 OR flag IS NOT NULL)
        `).get(materialId);
        const touchedCount = Number(touchedRow?.count ?? 0);
        const newCount = Math.max(0, Number(row.active_card_count) - touchedCount);
        if (newCount > 0) {
          materialMap.set(materialId, {
            materialId,
            title: String(row.title),
            topic: String(row.topic),
            reviewStatus: String(row.review_status),
            priority: String(row.priority),
            updatedAt: String(row.updated_at),
            cardCount: Number(row.active_card_count),
            againCount: 0,
            dayCount: 0,
            newCount,
            totalDueCount: 0,
            earliestDueAt: null,
            hasActiveVersion: true,
            activeVersionId: String(row.active_version_id),
          });
        }
      } else {
        // Content changed from A to B: 0 due, all B cards new!
        materialMap.set(materialId, {
          materialId,
          title: String(row.title),
          topic: String(row.topic),
          reviewStatus: String(row.review_status),
          priority: String(row.priority),
          updatedAt: String(row.updated_at),
          cardCount: parsed.cards.length,
          againCount: 0,
          dayCount: 0,
          newCount: parsed.cards.length,
          totalDueCount: 0,
          earliestDueAt: null,
          hasActiveVersion: false,
          activeVersionId: null,
        });
      }
    }
  }

  // Convert map to array and apply statusFilter
  let results = Array.from(materialMap.values());

  if (statusFilter === "due_today") {
    results = results.filter((m) => m.totalDueCount > 0);
  } else if (statusFilter === "new_only") {
    results = results.filter((m) => m.totalDueCount === 0 && m.newCount > 0);
  } else {
    // "all": must have at least one due or new card
    results = results.filter((m) => m.totalDueCount > 0 || m.newCount > 0);
  }

  // Summary statistics across entire candidate set before pagination
  const summary = {
    totalMaterialsWithDue: results.filter((m) => m.totalDueCount > 0).length,
    totalMaterialsWithNew: results.filter((m) => m.newCount > 0).length,
    totalDueCards: results.reduce((acc, m) => acc + m.totalDueCount, 0),
    totalNewCards: results.reduce((acc, m) => acc + m.newCount, 0),
  };

  // Deterministic Sorting:
  // 1. Materials with Again cards first (urgent)
  // 2. Materials with Day cards next
  // 3. Materials with only New cards
  // Tie-breaks:
  // - Priority (next_up first)
  // - Earliest due timestamp (for due items) or updatedAt DESC (for new items)
  // - Title ASC
  // - Material ID ASC
  results.sort((a, b) => {
    // Bucket: 0 = has Again, 1 = has Day, 2 = New only
    const bucketA = a.againCount > 0 ? 0 : a.dayCount > 0 ? 1 : 2;
    const bucketB = b.againCount > 0 ? 0 : b.dayCount > 0 ? 1 : 2;
    if (bucketA !== bucketB) return bucketA - bucketB;

    // Priority: next_up comes before everything else
    const prioA = a.priority === "next_up" ? 0 : 1;
    const prioB = b.priority === "next_up" ? 0 : 1;
    if (prioA !== prioB) return prioA - prioB;

    // Earliest due date if in bucket 0 or 1
    if (bucketA < 2) {
      const dueA = a.earliestDueAt || "";
      const dueB = b.earliestDueAt || "";
      if (dueA !== dueB) return dueA.localeCompare(dueB);
    } else {
      // Updated at descending if in bucket 2
      if (a.updatedAt !== b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
    }

    // Title ASC
    if (a.title !== b.title) return a.title.localeCompare(b.title);
    return a.materialId.localeCompare(b.materialId);
  });

  const paged = results.slice(0, limit);
  const nextCursor = results.length > limit ? paged.at(-1)?.materialId ?? null : null;

  return { summary, materials: paged, nextCursor };
}

/**
 * Candidate C2 Query 2: Library-Wide History Keyset Paging
 * 
 * Lists recent card ratings across all materials, with keyset cursor,
 * material titles, topics, and earlier_version detection.
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
  const page = rows.slice(0, limit).map((r) => ({
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
    isEarlierVersion: Number(r.is_active) !== 1,
  }));

  const last = page.at(-1);
  const next = rows.length > limit && last ? { reviewedAt: last.reviewedAt, id: last.id } : null;

  return { rows: page, next };
}

/** Deliberately wrong query variants for semantic failure negative controls */
export function getLibraryReviewDueBrokenCurrentVersion(db, { nowUtc, nextLocalMidnightUtc }) {
  // Deliberately treats the last materialized snapshot as current WITHOUT checking raw saved cards!
  // Will fail Assertion 1 (unmaterialized B is current, old A must stay excluded).
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
  // Deliberately evaluates Day ladder cards against nowUtc instead of nextLocalMidnightUtc!
  // Will fail Assertion 2 (day ladder card due later today must be included).
  const sql = `
    SELECT s.item_id
    FROM card_review_state s
    WHERE s.suspended = 0 AND s.flag IS NULL AND s.due_at <= ?
  `;
  return db.prepare(sql).all(nowUtc);
}

export function getLibraryRecentReviewsBrokenCursor(db, { cursor, limit = 20 }) {
  // Deliberately orders by reviewed_at only without tie-breaker id, causing row omissions on tied timestamps!
  const params = [];
  let sql = `
    SELECT e.id, e.reviewed_at
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
