/**
 * Single-connection atomic card-review transaction (M2-3 source slice C1):
 * the browser (sql.js) and test (node:sqlite) twin of the native
 * `save_card_review_atomically` in `src-tauri/src/card_reviews.rs`.
 *
 * Order, exactly as the scope's section 6:
 * 1. strict two-pass decode of the typed union (before any write)
 * 2. one immediate transaction on the owned connection
 * 3. same-ID replay first: conflict, then erased, then the stored result
 * 4. the generation barrier
 * 5. the item branch (content, item, materialize, revision, action), or
 * 6. the reset branch (no item fields)
 * 7. commit; any refusal leaves projection, event, receipt and generation
 *    counts unchanged
 *
 * `timestamp` is the system clock read at the start of the operation
 * (injectable for tests); the client never supplies the review time.
 */
import type {
  CardFlagReason,
  CardItemAction,
  CardItemActionName,
  CardItemResult,
  CardRating,
  CardResetResult,
  CardReviewAction,
  CardReviewResult,
} from "@/domain/types";
import { canonicalJson, cardVersion, parseSavedCards, sha256Hex, type CardVersion } from "@/logic/cardIdentity";
import { isIsoInstant, SCHEDULER_VERSION, scheduleCard, SchedulerRefusal, type CardSchedule } from "@/logic/cardScheduler";

import type { SqlValue } from "./db";
import { CardReviewError, type CardReviewErrorCode } from "./persistenceErrors";

export type Query = (sql: string, params: SqlValue[]) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];

export const MAX_CARD_REVIEW_PAYLOAD_BYTES = 64 * 1024;
export const MAX_EXPECTED_COUNTER = 1_000_000_000;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const MATERIAL_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const ITEM_ACTIONS: readonly CardItemActionName[] = ["rate", "suspend", "resume", "flag", "unflag"];
const RATINGS: readonly CardRating[] = ["again", "hard", "good", "easy"];
const FLAG_REASONS: readonly CardFlagReason[] = ["wrong_answer", "unclear", "not_in_source"];
const ITEM_KEYS = ["action", "operationId", "materialId", "versionContentHash", "itemId", "expectedGeneration", "expectedRevision"];
const RESET_KEYS = ["action", "operationId", "materialId", "expectedGeneration"];

function refuse(code: CardReviewErrorCode): never {
  throw new CardReviewError(code);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    refuse("INVALID_ARGUMENT");
  }
}

function stringMatching(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) refuse("INVALID_ARGUMENT");
  return value;
}

function counter(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_EXPECTED_COUNTER) {
    refuse("INVALID_ARGUMENT");
  }
  return value;
}

/**
 * Strict two-pass decode: first the branch and its exact keys, then every
 * field's type and bounds. A reset carries no item fields; an item action
 * without a generation, or with a stray key, is invalid.
 */
export function decodeCardReviewAction(value: unknown): CardReviewAction {
  if (value === null || typeof value !== "object" || Array.isArray(value)) refuse("INVALID_ARGUMENT");
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    refuse("INVALID_ARGUMENT");
  }
  if (new TextEncoder().encode(encoded).length > MAX_CARD_REVIEW_PAYLOAD_BYTES) refuse("INVALID_ARGUMENT");
  const object = value as Record<string, unknown>;
  const action = object.action;

  // Pass one: the branch and its exact keys.
  if (action === "reset") {
    exactKeys(object, RESET_KEYS);
  } else if (typeof action === "string" && (ITEM_ACTIONS as readonly string[]).includes(action)) {
    const extra = action === "rate" ? ["rating"] : action === "flag" ? ["reason"] : [];
    exactKeys(object, [...ITEM_KEYS, ...extra]);
  } else {
    refuse("INVALID_ARGUMENT");
  }

  // Pass two: types and bounds.
  const operationId = stringMatching(object.operationId, UUID_V4);
  const materialId = stringMatching(object.materialId, MATERIAL_ID);
  const expectedGeneration = counter(object.expectedGeneration);
  if (action === "reset") return { action, operationId, materialId, expectedGeneration };

  const base = {
    operationId,
    materialId,
    versionContentHash: stringMatching(object.versionContentHash, HEX_64),
    itemId: stringMatching(object.itemId, HEX_64),
    expectedGeneration,
    expectedRevision: counter(object.expectedRevision),
  };
  if (action === "rate") {
    if (typeof object.rating !== "string" || !(RATINGS as readonly string[]).includes(object.rating)) refuse("INVALID_ARGUMENT");
    return { ...base, action, rating: object.rating as CardRating };
  }
  if (action === "flag") {
    if (typeof object.reason !== "string" || !(FLAG_REASONS as readonly string[]).includes(object.reason)) refuse("INVALID_ARGUMENT");
    return { ...base, action, reason: object.reason as CardFlagReason };
  }
  return { ...base, action: action as "suspend" | "resume" | "unflag" };
}

const int = (value: unknown): number => (typeof value === "bigint" ? Number(value) : Number(value));

interface StateRow {
  schedulerVersion: string;
  step: number;
  dueAt: string | null;
  lastReviewedAt: string | null;
  reps: number;
  lapses: number;
  suspended: boolean;
  flag: CardFlagReason | null;
  revision: number;
}

async function readGeneration(query: Query, materialId: string): Promise<number> {
  const [row] = await query("SELECT generation FROM card_review_generations WHERE source_material_id = ?", [materialId]);
  return row ? int(row.generation) : 0;
}

async function readState(query: Query, itemId: string): Promise<StateRow | null> {
  const [row] = await query(
    `SELECT scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision
     FROM card_review_state WHERE item_id = ?`,
    [itemId],
  );
  if (!row) return null;
  return {
    schedulerVersion: String(row.scheduler_version),
    step: int(row.step),
    dueAt: row.due_at === null ? null : String(row.due_at),
    lastReviewedAt: row.last_reviewed_at === null ? null : String(row.last_reviewed_at),
    reps: int(row.reps),
    lapses: int(row.lapses),
    suspended: int(row.suspended) === 1,
    flag: row.flag === null ? null : (String(row.flag) as CardFlagReason),
    revision: int(row.revision),
  };
}

/** The saved cards of a material and their provider, or null when there is no set. */
async function readSavedSet(query: Query, materialId: string): Promise<{ flashcardsJson: string; provider: string } | null> {
  const [row] = await query("SELECT flashcards_json, provider FROM ai_study_sets WHERE source_material_id = ?", [materialId]);
  if (!row) return null;
  return { flashcardsJson: String(row.flashcards_json), provider: String(row.provider) };
}

/**
 * Write the snapshot of the current cards if it is absent (the first item
 * action of any kind), verify a stored one against the derived text, and
 * make it the material's only active version.
 */
async function materialize(
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  materialId: string,
  version: CardVersion,
  provider: string,
  now: string,
): Promise<void> {
  const [stored] = await query("SELECT source_material_id, content_hash FROM card_versions WHERE id = ?", [version.versionId]);
  if (stored) {
    if (stored.source_material_id !== materialId || stored.content_hash !== version.contentHash) refuse("INVALID_STATE");
    const items = await query(
      "SELECT id, ordinal, front, back, source_page FROM card_items WHERE version_id = ? ORDER BY ordinal",
      [version.versionId],
    );
    if (items.length !== version.items.length) refuse("INVALID_STATE");
    items.forEach((row, index) => {
      const item = version.items[index]!;
      const sourcePage = row.source_page === null ? null : int(row.source_page);
      if (row.id !== item.itemId || int(row.ordinal) !== item.ordinal || row.front !== item.front || row.back !== item.back || sourcePage !== item.sourcePage) {
        refuse("INVALID_STATE");
      }
    });
  } else {
    if (provider !== "gemini" && provider !== "import") refuse("INVALID_STATE");
    await run(
      `INSERT INTO card_versions (id, source_material_id, content_hash, card_count, provider, created_at, first_reviewed_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 0)`,
      [version.versionId, materialId, version.contentHash, version.items.length, provider, now],
    );
    for (const item of version.items) {
      await run(
        "INSERT INTO card_items (id, version_id, ordinal, front, back, source_page) VALUES (?, ?, ?, ?, ?, ?)",
        [item.itemId, version.versionId, item.ordinal, item.front, item.back, item.sourcePage],
      );
    }
  }
  await run("UPDATE card_versions SET is_active = 0 WHERE source_material_id = ? AND id != ? AND is_active = 1", [
    materialId,
    version.versionId,
  ]);
  await run("UPDATE card_versions SET is_active = 1 WHERE id = ?", [version.versionId]);
}

async function applyItem(
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  action: CardItemAction,
  generation: number,
  requestHash: string,
  now: string,
): Promise<CardItemResult> {
  const saved = await readSavedSet(query, action.materialId);
  if (!saved) refuse("NOT_FOUND");
  const cards = parseSavedCards(saved.flashcardsJson);
  if (cards.status === "malformed") refuse("MALFORMED_CARDS");
  if (cards.status === "none") refuse("NOT_FOUND");
  const version = await cardVersion(action.materialId, cards.cards);
  if (version.contentHash !== action.versionContentHash) refuse("STALE_CONTENT");
  if (!version.items.some((item) => item.itemId === action.itemId)) refuse("NOT_FOUND");

  await materialize(run, query, action.materialId, version, saved.provider, now);

  const current = await readState(query, action.itemId);
  const revision = current?.revision ?? 0;
  if (action.expectedRevision !== revision) refuse("STALE_REVISION");

  const next: StateRow = current
    ? { ...current, revision: revision + 1 }
    : {
        schedulerVersion: SCHEDULER_VERSION,
        step: -1,
        dueAt: null,
        lastReviewedAt: null,
        reps: 0,
        lapses: 0,
        suspended: false,
        flag: null,
        revision: 1,
      };
  let reviewedAt: string | null = null;

  if (action.action === "rate") {
    if (next.suspended) refuse("CARD_SUSPENDED");
    if (next.flag !== null) refuse("CARD_FLAGGED");
    const prior: CardSchedule | null =
      current && current.dueAt !== null && current.lastReviewedAt !== null
        ? {
            schedulerVersion: current.schedulerVersion,
            step: current.step,
            reps: current.reps,
            lapses: current.lapses,
            lastReviewedAt: current.lastReviewedAt,
            dueAt: current.dueAt,
          }
        : null;
    let scheduled: CardSchedule;
    try {
      scheduled = scheduleCard(prior, action.rating, now);
    } catch (error) {
      if (error instanceof SchedulerRefusal) {
        refuse(error.code === "CLOCK_BEHIND_LAST_REVIEW" ? "CLOCK_BEHIND_LAST_REVIEW" : "INVALID_STATE");
      }
      throw error;
    }
    Object.assign(next, {
      schedulerVersion: scheduled.schedulerVersion,
      step: scheduled.step,
      dueAt: scheduled.dueAt,
      lastReviewedAt: scheduled.lastReviewedAt,
      reps: scheduled.reps,
      lapses: scheduled.lapses,
    });
    reviewedAt = scheduled.lastReviewedAt;
    await run(
      `INSERT INTO card_review_events (id, item_id, generation, rating, reviewed_at, scheduler_version, prior_state_json, next_state_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        action.operationId,
        action.itemId,
        generation,
        action.rating,
        reviewedAt,
        scheduled.schedulerVersion,
        canonicalJson(prior),
        canonicalJson(scheduled),
      ],
    );
    await run("UPDATE card_versions SET first_reviewed_at = ? WHERE id = ? AND first_reviewed_at IS NULL", [
      reviewedAt,
      version.versionId,
    ]);
  } else if (action.action === "suspend" || action.action === "resume") {
    next.suspended = action.action === "suspend";
  } else {
    next.flag = action.action === "flag" ? action.reason : null;
  }

  await run(
    `INSERT INTO card_review_state
       (item_id, source_material_id, scheduler_version, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET
       scheduler_version = excluded.scheduler_version, step = excluded.step, due_at = excluded.due_at,
       last_reviewed_at = excluded.last_reviewed_at, reps = excluded.reps, lapses = excluded.lapses,
       suspended = excluded.suspended, flag = excluded.flag, revision = excluded.revision`,
    [
      action.itemId,
      action.materialId,
      next.schedulerVersion,
      next.step,
      next.dueAt,
      next.lastReviewedAt,
      next.reps,
      next.lapses,
      next.suspended ? 1 : 0,
      next.flag,
      next.revision,
    ],
  );

  const result: CardItemResult = {
    action: action.action,
    itemId: action.itemId,
    generation,
    revision: next.revision,
    dueAt: next.dueAt,
    reviewedAt,
    suspended: next.suspended,
    flag: next.flag,
  };
  await run(
    `INSERT INTO card_review_operations
       (operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
    [action.operationId, action.action, action.materialId, generation, requestHash, now, canonicalJson(result)],
  );
  return result;
}

async function applyReset(
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  action: Extract<CardReviewAction, { action: "reset" }>,
  generation: number,
  requestHash: string,
  now: string,
): Promise<CardResetResult> {
  const { materialId } = action;
  if ((await query("SELECT 1 AS present FROM study_materials WHERE id = ?", [materialId])).length === 0) refuse("NOT_FOUND");
  const saved = await readSavedSet(query, materialId);
  const cards = saved ? parseSavedCards(saved.flashcardsJson) : ({ status: "none" } as const);
  const keep = cards.status === "ok" ? (await cardVersion(materialId, cards.cards)).versionId : null;

  await run(
    `DELETE FROM card_review_events WHERE item_id IN (
       SELECT i.id FROM card_items i JOIN card_versions v ON v.id = i.version_id WHERE v.source_material_id = ?)`,
    [materialId],
  );
  await run("DELETE FROM card_review_state WHERE source_material_id = ?", [materialId]);
  if (keep === null) {
    await run("DELETE FROM card_versions WHERE source_material_id = ?", [materialId]);
  } else {
    await run("DELETE FROM card_versions WHERE source_material_id = ? AND id != ?", [materialId, keep]);
    await run("UPDATE card_versions SET first_reviewed_at = NULL, is_active = 1 WHERE id = ?", [keep]);
  }
  // Already tombstoned receipts are skipped, never rewritten.
  await run(
    "UPDATE card_review_operations SET is_erased = 1, result_json = NULL WHERE source_material_id = ? AND is_erased = 0",
    [materialId],
  );
  const next = generation + 1;
  await run(
    `INSERT INTO card_review_generations (source_material_id, generation) VALUES (?, ?)
     ON CONFLICT(source_material_id) DO UPDATE SET generation = excluded.generation`,
    [materialId, next],
  );
  const result: CardResetResult = { action: "reset", materialId, generation: next };
  await run(
    `INSERT INTO card_review_operations
       (operation_id, action, source_material_id, generation, request_hash, applied_at, is_erased, result_json)
     VALUES (?, 'reset', ?, ?, ?, ?, 0, ?)`,
    [action.operationId, materialId, generation, requestHash, now, canonicalJson(result)],
  );
  return result;
}

/** The request identity: SHA-256 of the canonical JSON of the whole typed payload. */
export function cardReviewRequestHash(action: CardReviewAction): Promise<string> {
  return sha256Hex(canonicalJson(action));
}

export async function executeCardReviewAction(
  exec: (sql: string) => Promise<void> | void,
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  actionInput: unknown,
  timestamp: string = new Date().toISOString(),
): Promise<CardReviewResult> {
  const action = decodeCardReviewAction(actionInput);
  const requestHash = await cardReviewRequestHash(action);
  if (!isIsoInstant(timestamp)) refuse("INVALID_STATE");

  await exec("BEGIN IMMEDIATE");
  try {
    const [receipt] = await query(
      "SELECT request_hash, is_erased, result_json FROM card_review_operations WHERE operation_id = ?",
      [action.operationId],
    );
    if (receipt) {
      if (receipt.request_hash !== requestHash) refuse("OPERATION_CONFLICT");
      if (int(receipt.is_erased) === 1) refuse("OPERATION_ERASED");
      const stored = JSON.parse(String(receipt.result_json)) as CardReviewResult;
      await exec("COMMIT");
      return stored;
    }

    const generation = await readGeneration(query, action.materialId);
    if (action.expectedGeneration !== generation) refuse("STALE_GENERATION");

    const result =
      action.action === "reset"
        ? await applyReset(run, query, action, generation, requestHash, timestamp)
        : await applyItem(run, query, action, generation, requestHash, timestamp);
    await exec("COMMIT");
    return result;
  } catch (error) {
    try {
      await exec("ROLLBACK");
    } catch {
      // Rollback is best effort; the caller restores durable bytes.
    }
    if (error instanceof CardReviewError) throw error;
    throw new CardReviewError("STORAGE_ERROR", { cause: error });
  }
}
