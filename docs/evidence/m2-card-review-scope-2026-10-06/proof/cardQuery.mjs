// CRS-R1: the proposed due-queue read contract, executed against SQLite.
//
// SQLITE QUERY PROOF ONLY: a representative schema in disposable node:sqlite,
// not migration 12 and not the native/browser production read path.
//
// Timestamps are always the 24-character UTC form `YYYY-MM-DDTHH:MM:SS.sssZ`
// (Date#toISOString), so SQLite's text comparison is chronological.

import { localDate } from "./simpleScheduler.mjs";

export const MAX_NEW_PER_SESSION = 10;
export const MAX_CARDS_PER_SESSION = 20;

/** Representative tables for the proof (columns the queue and reset need). */
export const PROOF_SCHEMA = `
CREATE TABLE card_review_generations (
  source_material_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL CHECK (generation >= 0));
CREATE TABLE card_versions (
  id TEXT PRIMARY KEY, source_material_id TEXT NOT NULL, content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, first_reviewed_at TEXT, is_active INTEGER NOT NULL);
CREATE TABLE card_items (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES card_versions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL, UNIQUE (version_id, ordinal));
CREATE TABLE card_review_state (
  item_id TEXT PRIMARY KEY REFERENCES card_items(id) ON DELETE CASCADE,
  source_material_id TEXT NOT NULL, step INTEGER NOT NULL, due_at TEXT, last_reviewed_at TEXT,
  suspended INTEGER NOT NULL DEFAULT 0, flag TEXT, revision INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_card_state_due ON card_review_state(source_material_id, suspended, due_at);
`;

/**
 * The exclusive end of the current local calendar day: the first UTC instant
 * whose local date (in `timeZone`) is after today's. Found by bisection on
 * the monotonic local date, so 23- and 25-hour days and zones whose
 * midnight is skipped are all exact. Stored instants are never rewritten.
 */
export function nextLocalMidnightUtc(nowIso, timeZone) {
  const today = localDate(nowIso, timeZone);
  let low = Date.parse(nowIso); // local date == today
  let high = low + 50 * 60 * 60 * 1000; // certainly a later local date
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (localDate(new Date(middle).toISOString(), timeZone) > today) high = middle;
    else low = middle;
  }
  return new Date(high).toISOString();
}

/** Due states that belong to the current derived version only, filtered before LIMIT. */
export const DUE_STATES_SQL = `
SELECT s.item_id, s.step, s.due_at, i.ordinal
FROM card_review_state s
JOIN card_items i ON i.id = s.item_id
WHERE i.version_id = :versionId
  AND s.source_material_id = :materialId
  AND s.suspended = 0
  AND s.flag IS NULL
  AND s.due_at IS NOT NULL
  AND ((s.step < 0 AND s.due_at <= :nowUtc)
       OR (s.step >= 0 AND s.due_at < :nextLocalMidnightUtc))
ORDER BY CASE WHEN s.step < 0 THEN 0 ELSE 1 END, s.due_at, i.ordinal, s.item_id
LIMIT :maxTotal`;

/** State rows for the current derived items, whether or not they are materialized. */
export const CURRENT_ITEM_STATES_SQL = `
SELECT s.item_id, s.due_at, s.suspended, s.flag
FROM card_review_state s
WHERE s.item_id IN (SELECT value FROM json_each(:itemIds))`;

/**
 * The bounded Review due queue for one material.
 *
 * `current` is the version derived in pure code from the material's saved
 * raw cards at read time (`cardVersion(materialId, flashcards)`), so a
 * regenerated set B is current even before any B row exists, and retained A
 * rows are never current due work. Nothing is written by this read.
 *
 * Order: Again/relearning steps by due instant; then day-ladder due cards by
 * due instant (ties: ordinal, then item ID); then new cards by ordinal. Caps
 * (10 new, 20 total) apply after eligibility.
 */
export function dueQueue(db, { materialId, current, nowUtc, timeZone, maxNew = MAX_NEW_PER_SESSION, maxTotal = MAX_CARDS_PER_SESSION }) {
  const boundary = nextLocalMidnightUtc(nowUtc, timeZone);
  const due = db
    .prepare(DUE_STATES_SQL)
    .all({ versionId: current.versionId, materialId, nowUtc, nextLocalMidnightUtc: boundary, maxTotal })
    .map((row) => ({ itemId: row.item_id, kind: row.step < 0 ? "again" : "due", dueAt: row.due_at, ordinal: row.ordinal }));

  const states = new Map(
    db
      .prepare(CURRENT_ITEM_STATES_SQL)
      .all({ itemIds: JSON.stringify(current.items.map((item) => item.itemId)) })
      .map((row) => [row.item_id, row]),
  );
  // New = never rated (no row, or a row created only by suspend/flag with no
  // due instant), and not excluded.
  const fresh = current.items
    .filter((item) => {
      const state = states.get(item.itemId);
      return !state || (state.due_at === null && state.suspended === 0 && state.flag === null);
    })
    .map((item) => ({ itemId: item.itemId, kind: "new", dueAt: null, ordinal: item.ordinal }))
    .slice(0, Math.max(0, Math.min(maxNew, maxTotal - due.length)));

  return { boundary, cards: [...due, ...fresh] };
}

/**
 * Session membership is fixed when the session starts (the queue above). It
 * counts unique presented cards: it advances only on an acknowledged result
 * for the card being shown, and a replayed acknowledgement for a card already
 * completed changes nothing.
 */
export function createSession(queue) {
  return { cards: queue.cards.map((card) => card.itemId), completed: new Set(), position: 0 };
}

export function acknowledge(session, result) {
  const current = session.cards[session.position];
  if (!result || result.itemId !== current || session.completed.has(result.itemId)) return session;
  session.completed.add(result.itemId);
  session.position += 1;
  return session;
}
