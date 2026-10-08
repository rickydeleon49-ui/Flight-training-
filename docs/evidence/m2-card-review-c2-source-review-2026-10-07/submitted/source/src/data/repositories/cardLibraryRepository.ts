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

import { readLibraryRecentReviews, readLibraryReviewDue } from "../cardLibraryReader";
import type { SqlDatabase } from "../db";

export function cardLibraryRepository(db: SqlDatabase) {
  const select = (sql: string, params: Parameters<SqlDatabase["select"]>[1]) => db.select<Record<string, unknown>>(sql, params);
  return {
    readReviewDue(input: LibraryReviewDueInput): Promise<LibraryReviewDueResult> {
      return db.readLibraryReviewDue ? db.readLibraryReviewDue(input) : readLibraryReviewDue(select, input);
    },
    readRecentReviews(input: LibraryRecentReviewsInput): Promise<LibraryRecentReviewsResult> {
      return db.readLibraryRecentReviews ? db.readLibraryRecentReviews(input) : readLibraryRecentReviews(select, input);
    },
  };
}

export type CardLibraryRepository = ReturnType<typeof cardLibraryRepository>;
