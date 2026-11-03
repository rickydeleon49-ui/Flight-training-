/**
 * Library-wide card reviews (M2-4 / C2): the typed read service behind the
 * Study Library's Review due, History and binder indicators.
 *
 * Read-only. A driver's own bounded reader is used when it has one (the
 * native command on desktop, the owned connection in the browser and in
 * tests); any other driver runs the same TypeScript reader over `select`.
 */
import type {
  LibraryRecentReviewsInput,
  LibraryRecentReviewsResult,
  LibraryReviewDueInput,
  LibraryReviewDueResult,
} from "@/domain/types";

import { deriveCurrentCards } from "@/logic/cardIdentity";

import { readLibraryRecentReviews, readLibraryReviewDue } from "../cardLibraryReader";
import type { SqlDatabase } from "../db";

/** One not-due card of the library-wide "Review 10 anyway from any book" session. */
export interface ExtraReviewCard {
  materialId: string;
  materialTitle: string;
  itemId: string;
  dueAt: string;
}

/**
 * Rated, not paused, not flagged and not due states, oldest next review
 * first, across every material. Rows of older card versions are skipped in
 * code (the current version is derived from the saved set), so this pages.
 */
export const NOT_DUE_STATES_SQL = `SELECT s.item_id, s.source_material_id, s.due_at, i.version_id, m.title
  FROM card_review_state s
  JOIN card_items i ON i.id = s.item_id
  JOIN study_materials m ON m.id = s.source_material_id
  WHERE s.suspended = 0 AND s.flag IS NULL AND s.due_at IS NOT NULL
    AND NOT ((s.step < 0 AND s.due_at <= ?) OR (s.step >= 0 AND s.due_at < ?))
  ORDER BY s.due_at, s.source_material_id, i.ordinal, s.item_id
  LIMIT ? OFFSET ?`;
const NOT_DUE_PAGE = 200;

export function cardLibraryRepository(db: SqlDatabase) {
  const select = (sql: string, params: Parameters<SqlDatabase["select"]>[1]) => db.select<Record<string, unknown>>(sql, params);
  return {
    /**
     * "Review 10 anyway from any book": up to `limit` current cards that are
     * not due, across all materials, oldest next review first. Read-only;
     * each card is then rated through its own material as usual.
     */
    async getExtraAcrossBooks(input: { nowUtc: string; nextLocalMidnightUtc: string; limit: number }): Promise<ExtraReviewCard[]> {
      const picked: ExtraReviewCard[] = [];
      const currentVersion = new Map<string, string | null>();
      for (let offset = 0; picked.length < input.limit; offset += NOT_DUE_PAGE) {
        const rows = await select(NOT_DUE_STATES_SQL, [input.nowUtc, input.nextLocalMidnightUtc, NOT_DUE_PAGE, offset]);
        for (const row of rows) {
          const materialId = String(row.source_material_id);
          if (!currentVersion.has(materialId)) {
            const [set] = await select("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id = ?", [materialId]);
            const current = await deriveCurrentCards(materialId, set ? String(set.flashcards_json) : null);
            currentVersion.set(materialId, current.status === "ok" ? current.versionId : null);
          }
          if (currentVersion.get(materialId) !== String(row.version_id)) continue;
          picked.push({ materialId, materialTitle: String(row.title), itemId: String(row.item_id), dueAt: String(row.due_at) });
          if (picked.length >= input.limit) break;
        }
        if (rows.length < NOT_DUE_PAGE) break;
      }
      return picked;
    },
    readReviewDue(input: LibraryReviewDueInput): Promise<LibraryReviewDueResult> {
      return db.readLibraryReviewDue ? db.readLibraryReviewDue(input) : readLibraryReviewDue(select, input);
    },
    readRecentReviews(input: LibraryRecentReviewsInput): Promise<LibraryRecentReviewsResult> {
      return db.readLibraryRecentReviews ? db.readLibraryRecentReviews(input) : readLibraryRecentReviews(select, input);
    },
  };
}

export type CardLibraryRepository = ReturnType<typeof cardLibraryRepository>;
