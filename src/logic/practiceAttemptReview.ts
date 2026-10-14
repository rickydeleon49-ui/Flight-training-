/**
 * Review of one completed practice attempt. Every question is classified from
 * its own frozen item (`correctIndex`) and this attempt's own response, never
 * from a live test, another attempt or the stored aggregate counts. Inputs are
 * read only; callers get fresh arrays back.
 */
import type { PracticeResponse, PracticeTestItem } from "@/domain/types";

export type PracticeReviewOutcome = "correct" | "incorrect" | "dont_know" | "unanswered";

/** Which questions the attempt review shows. */
export type PracticeReviewView = "all" | "missed";

/** Query parameter that opens the focused review. */
export const REVIEW_QUERY_PARAM = "review";

export interface PracticeReviewEntry {
  item: PracticeTestItem;
  response: PracticeResponse | null;
  outcome: PracticeReviewOutcome;
  /** The question's own number in the frozen test, 1-based. */
  number: number;
}

/** Only `missed` opens the focused view; anything else is the full review. */
export function reviewViewFromQuery(value: string | null | undefined): PracticeReviewView {
  return value === "missed" ? "missed" : "all";
}

/** Hash-router path of one attempt's review, with encoded identifiers. */
export function attemptReviewPath(
  historyKey: string,
  attemptId: string,
  view: PracticeReviewView = "all",
): string {
  const path = `/study/history/${encodeURIComponent(historyKey)}/${encodeURIComponent(attemptId)}`;
  return view === "missed" ? `${path}?${REVIEW_QUERY_PARAM}=missed` : path;
}

export function classifyPracticeResponse(
  item: PracticeTestItem,
  response: PracticeResponse | null | undefined,
): PracticeReviewOutcome {
  if (!response) return "unanswered";
  if (response.isDontKnow) return "dont_know";
  return response.selectedIndex === item.correctIndex ? "correct" : "incorrect";
}

export function isMissedOrSkipped(outcome: PracticeReviewOutcome): boolean {
  return outcome !== "correct";
}

/**
 * Every frozen question in ordinal order, paired with this attempt's response.
 * A response recorded for another attempt or another item is ignored.
 */
export function buildAttemptReview(
  attemptId: string,
  items: readonly PracticeTestItem[],
  responses: readonly PracticeResponse[],
): PracticeReviewEntry[] {
  const byItem = new Map<string, PracticeResponse>();
  for (const response of responses) {
    if (response.attemptId === attemptId) byItem.set(response.itemId, response);
  }
  return [...items]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((item) => {
      const response = byItem.get(item.id) ?? null;
      return {
        item,
        response,
        outcome: classifyPracticeResponse(item, response),
        number: item.ordinal + 1,
      };
    });
}

/** The entries one view shows, keeping frozen order and original numbers. */
export function reviewEntriesFor(
  entries: readonly PracticeReviewEntry[],
  view: PracticeReviewView,
): PracticeReviewEntry[] {
  return view === "missed" ? entries.filter((e) => isMissedOrSkipped(e.outcome)) : [...entries];
}
