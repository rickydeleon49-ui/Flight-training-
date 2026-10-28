/**
 * Card reviews for one material (M2-3 source slice C1).
 *
 * Reads never write. The current version is always derived in pure code
 * from the material's saved `ai_study_sets.flashcards_json`, so regenerated
 * cards are current (and new) before any snapshot of them exists, and older
 * snapshots are never current due work. Every write goes through the one
 * atomic driver method; without it card writes refuse with
 * `UNSUPPORTED_DRIVER` and nothing falls back to separate statements.
 */
import type {
  CardFlagReason,
  CardQueueEntry,
  CardRating,
  CardRecentReview,
  CardRecentReviewCursor,
  CardReviewAction,
  CardReviewItemState,
  CardReviewResult,
  CardReviewSnapshot,
} from "@/domain/types";
import { readCardPageSource, mergeCardPageSources } from "../studyPageSources";
import { deriveCurrentCards } from "@/logic/cardIdentity";

import type { SqlDatabase } from "../db";
import { cardReviewRequestHash } from "../cardReviewTransaction";
import { CardReviewError } from "../persistenceErrors";

export const MAX_NEW_PER_SESSION = 10;
export const MAX_CARDS_PER_SESSION = 20;
export const RECENT_REVIEWS_PAGE = 20;

export interface DueQueueInput {
  materialId: string;
  currentVersionId: string;
  /** The current derived item IDs in ordinal order. */
  currentItemIds: string[];
  nowUtc: string;
  /** The exclusive end of the current local day. */
  nextLocalMidnightUtc: string;
  maxNew?: number;
  maxTotal?: number;
}

/** What an authoritative receipt read says about one operation ID. */
export type CardOperationStatus =
  | { state: "absent" }
  | { state: "erased"; sameRequest: boolean }
  | { state: "applied"; sameRequest: boolean; result: CardReviewResult | null };

/**
 * Due states of the current derived version only, filtered before ORDER BY
 * and LIMIT: Again steps at their exact instant, day steps before the
 * exclusive next local midnight (scope section 6).
 */
export const DUE_STATES_SQL = `SELECT s.item_id, s.step, s.due_at, i.ordinal FROM card_review_state s
  JOIN card_items i ON i.id = s.item_id
  WHERE i.version_id = ? AND s.source_material_id = ?
    AND s.suspended = 0 AND s.flag IS NULL AND s.due_at IS NOT NULL
    AND ((s.step < 0 AND s.due_at <= ?) OR (s.step >= 0 AND s.due_at < ?))
  ORDER BY CASE WHEN s.step < 0 THEN 0 ELSE 1 END, s.due_at, i.ordinal, s.item_id
  LIMIT ?`;

/** State rows of the current derived items, whether or not they are materialized. */
export const CURRENT_ITEM_STATES_SQL = `SELECT item_id, step, due_at, last_reviewed_at, reps, lapses, suspended, flag, revision
  FROM card_review_state WHERE item_id IN (SELECT value FROM json_each(?))`;

const int = (value: unknown): number => Number(value);

export function cardReviewRepository(db: SqlDatabase) {
  async function readCurrent(materialId: string) {
    const [set] = await db.select<{ flashcards_json: string }>(
      "SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?",
      [materialId],
    );
    return deriveCurrentCards(materialId, set ? String(set.flashcards_json) : null);
  }

  return {
    /** Generation, the current derived cards and the states of the current items. */
    async getCardReviewSnapshot(materialId: string): Promise<CardReviewSnapshot> {
      const [generationRow] = await db.select<{ generation: number }>(
        "SELECT generation FROM card_review_generations WHERE source_material_id = ?",
        [materialId],
      );
      const generation = generationRow ? int(generationRow.generation) : 0;
      const [saved] = await db.select<{flashcards_json:string}>("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?", [materialId]);
      const current = await deriveCurrentCards(materialId, saved?.flashcards_json ?? null);
      const states: Record<string, CardReviewItemState> = {};
      if (current.status !== "ok") return { materialId, generation, current: { status: current.status }, states };
      const rows = await db.select<Record<string, unknown>>(CURRENT_ITEM_STATES_SQL, [
        JSON.stringify(current.items.map((item) => item.itemId)),
      ]);
      for (const row of rows) {
        states[String(row.item_id)] = {
          revision: int(row.revision),
          step: int(row.step),
          dueAt: row.due_at === null ? null : String(row.due_at),
          lastReviewedAt: row.last_reviewed_at === null ? null : String(row.last_reviewed_at),
          reps: int(row.reps),
          lapses: int(row.lapses),
          suspended: int(row.suspended) === 1,
          flag: row.flag === null ? null : (String(row.flag) as CardFlagReason),
        };
      }
      // Logical IDs and wording must come from the same ordered saved row.
      const authored = saved ? JSON.parse(saved.flashcards_json) : [];
      const items = await Promise.all(current.items.map(async (item, i) => {
        const c = authored[i];
        const query = (sql:string,params:import("../db").SqlValue[]) => db.select<Record<string,unknown>>(sql,params);
        const frozen = await readCardPageSource(query,materialId,"frozen_card",item.itemId,item);
        const authoredSource = c?.itemId ? await readCardPageSource(query,materialId,"authored_card",c.itemId,c) : undefined;
        const pageSource = mergeCardPageSources(frozen, authoredSource);
        return {...item,...(pageSource ? {pageSource} : {})};
      }));
      return {
        materialId,
        generation,
        current: {
          status: "ok",
          versionId: current.versionId,
          contentHash: current.contentHash,
          items: items.map(({ itemId, ordinal, front, back, sourcePage, origin, pageSource }) => ({
            itemId, ordinal, front, back, sourcePage, ...(origin ? { origin } : {}), ...(pageSource ? {pageSource} : {}),
          })),
        },
        states,
      };
    },

    /**
     * The bounded Review queue: eligible Again cards by due instant, other due
     * cards by due instant (ties by ordinal, then item ID), then new cards by
     * ordinal. Caps apply after eligibility.
     */
    async getDueQueue(input: DueQueueInput): Promise<CardQueueEntry[]> {
      const maxNew = input.maxNew ?? MAX_NEW_PER_SESSION;
      const maxTotal = input.maxTotal ?? MAX_CARDS_PER_SESSION;
      const dueRows = await db.select<Record<string, unknown>>(DUE_STATES_SQL, [
        input.currentVersionId,
        input.materialId,
        input.nowUtc,
        input.nextLocalMidnightUtc,
        maxTotal,
      ]);
      const due: CardQueueEntry[] = dueRows.map((row) => ({
        itemId: String(row.item_id),
        kind: int(row.step) < 0 ? "again" : "due",
        dueAt: String(row.due_at),
        ordinal: int(row.ordinal),
      }));
      const states = new Map(
        (await db.select<Record<string, unknown>>(CURRENT_ITEM_STATES_SQL, [JSON.stringify(input.currentItemIds)])).map(
          (row) => [String(row.item_id), row],
        ),
      );
      // New: never rated (no row, or a row created only by suspend/flag), and not excluded.
      const fresh: CardQueueEntry[] = input.currentItemIds
        .map((itemId, ordinal) => ({ itemId, ordinal }))
        .filter(({ itemId }) => {
          const state = states.get(itemId);
          return !state || (state.due_at === null && int(state.suspended) === 0 && state.flag === null);
        })
        .slice(0, Math.max(0, Math.min(maxNew, maxTotal - due.length)))
        .map(({ itemId, ordinal }) => ({ itemId, kind: "new", dueAt: null, ordinal }));
      return [...due, ...fresh];
    },

    /** Recent ratings for this material, newest first, 20 per page; earlier versions are labelled. */
    async getRecentReviews(
      materialId: string,
      cursor?: CardRecentReviewCursor | null,
    ): Promise<{ rows: CardRecentReview[]; next: CardRecentReviewCursor | null }> {
      const current = await readCurrent(materialId);
      const currentVersionId = current.status === "ok" ? current.versionId : null;
      const params: (string | number)[] = [materialId];
      let keyset = "";
      if (cursor) {
        keyset = "AND (e.reviewed_at < ? OR (e.reviewed_at = ? AND e.id < ?))";
        params.push(cursor.reviewedAt, cursor.reviewedAt, cursor.id);
      }
      params.push(RECENT_REVIEWS_PAGE + 1);
      const rows = await db.select<Record<string, unknown>>(
        `SELECT e.id, e.item_id, e.rating, e.reviewed_at, i.front, i.version_id
         FROM card_review_events e
         JOIN card_items i ON i.id = e.item_id
         JOIN card_versions v ON v.id = i.version_id
         WHERE v.source_material_id = ? ${keyset}
         ORDER BY e.reviewed_at DESC, e.id DESC
         LIMIT ?`,
        params,
      );
      const page = rows.slice(0, RECENT_REVIEWS_PAGE).map((row) => ({
        id: String(row.id),
        itemId: String(row.item_id),
        front: String(row.front),
        rating: String(row.rating) as CardRating,
        reviewedAt: String(row.reviewed_at),
        earlierVersion: row.version_id !== currentVersionId,
      }));
      const last = page.at(-1);
      return { rows: page, next: rows.length > RECENT_REVIEWS_PAGE && last ? { reviewedAt: last.reviewedAt, id: last.id } : null };
    },

    /**
     * Read-only receipt lookup for one operation, compared with the exact
     * payload the client holds. Used by Check again; it never writes.
     */
    async getOperationStatus(action: CardReviewAction): Promise<CardOperationStatus> {
      const [row] = await db.select<Record<string, unknown>>(
        "SELECT request_hash, is_erased, result_json FROM card_review_operations WHERE operation_id = ?",
        [action.operationId],
      );
      if (!row) return { state: "absent" };
      const sameRequest = row.request_hash === (await cardReviewRequestHash(action));
      if (int(row.is_erased) === 1) return { state: "erased", sameRequest };
      let result: CardReviewResult | null = null;
      try {
        result = JSON.parse(String(row.result_json)) as CardReviewResult;
      } catch {
        result = null;
      }
      return { state: "applied", sameRequest, result };
    },

    /** One atomic card-review action through the driver; no fallback writes. */
    async saveAction(action: CardReviewAction): Promise<CardReviewResult> {
      if (typeof db.saveCardReviewAtomically !== "function") throw new CardReviewError("UNSUPPORTED_DRIVER");
      return db.saveCardReviewAtomically(action);
    },
  };
}

export type CardReviewRepository = ReturnType<typeof cardReviewRepository>;
