import { describe, expect, it } from "vitest";

import type { PracticeResponse, PracticeTestItem } from "@/domain/types";
import {
  attemptReviewPath,
  buildAttemptReview,
  classifyPracticeResponse,
  isMissedOrSkipped,
  reviewEntriesFor,
  reviewViewFromQuery,
} from "./practiceAttemptReview";

function item(ordinal: number, correctIndex = 0): PracticeTestItem {
  return {
    id: `item-${ordinal}`,
    versionId: "v1",
    ordinal,
    questionText: `Question text ${ordinal}`,
    options: ["A", "B", "C"],
    correctIndex,
    explanation: `Explanation ${ordinal}`,
    sourcePage: ordinal + 10,
  };
}

function response(
  itemId: string,
  selectedIndex: number | null,
  isDontKnow = false,
  attemptId = "att-1",
): PracticeResponse {
  return {
    id: `resp-${attemptId}-${itemId}`,
    attemptId,
    itemId,
    selectedIndex,
    isDontKnow,
    // Deliberately contradicts the frozen key: classification must not trust it.
    isCorrect: false,
    answeredAt: "2026-10-13T12:00:00.000Z",
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("classifyPracticeResponse", () => {
  const q = item(0, 1);

  it("covers all four outcomes from the frozen correctIndex and the attempt's own response", () => {
    expect(classifyPracticeResponse(q, response(q.id, 1))).toBe("correct");
    expect(classifyPracticeResponse(q, response(q.id, 2))).toBe("incorrect");
    expect(classifyPracticeResponse(q, response(q.id, null, true))).toBe("dont_know");
    expect(classifyPracticeResponse(q, null)).toBe("unanswered");
    expect(classifyPracticeResponse(q, undefined)).toBe("unanswered");
  });

  it("treats a don't-know response as don't know even if an index was stored", () => {
    expect(classifyPracticeResponse(q, response(q.id, 1, true))).toBe("dont_know");
  });

  it("counts every outcome except correct as missed or skipped", () => {
    expect(isMissedOrSkipped("correct")).toBe(false);
    expect(isMissedOrSkipped("incorrect")).toBe(true);
    expect(isMissedOrSkipped("dont_know")).toBe(true);
    expect(isMissedOrSkipped("unanswered")).toBe(true);
  });
});

describe("buildAttemptReview / reviewEntriesFor", () => {
  it("keeps frozen ordinal order and original numbers in a mixed focused view", () => {
    // Supplied out of order on purpose.
    const items = [item(3, 0), item(0, 0), item(4, 2), item(1, 1), item(2, 0)];
    const responses = [
      response("item-0", 0), // correct
      response("item-1", 0), // incorrect
      response("item-2", null, true), // don't know
      // item-3 unanswered
      response("item-4", 2), // correct
    ];
    const entries = buildAttemptReview("att-1", items, responses);
    expect(entries.map((e) => [e.number, e.outcome])).toEqual([
      [1, "correct"],
      [2, "incorrect"],
      [3, "dont_know"],
      [4, "unanswered"],
      [5, "correct"],
    ]);

    const focused = reviewEntriesFor(entries, "missed");
    expect(focused.map((e) => [e.number, e.outcome])).toEqual([
      [2, "incorrect"],
      [3, "dont_know"],
      [4, "unanswered"],
    ]);
    expect(focused.map((e) => e.item.explanation)).toEqual([
      "Explanation 1",
      "Explanation 2",
      "Explanation 3",
    ]);
    expect(focused.map((e) => e.item.sourcePage)).toEqual([11, 12, 13]);
    expect(reviewEntriesFor(entries, "all")).toHaveLength(5);
  });

  it("ignores another attempt's response for the same frozen item", () => {
    const items = [item(0, 0)];
    const entries = buildAttemptReview("att-1", items, [response("item-0", 0, false, "att-2")]);
    expect(entries[0]!.outcome).toBe("unanswered");
    expect(entries[0]!.response).toBeNull();
  });

  it("returns an empty focused view for an all-correct attempt and for no items", () => {
    const items = [item(0, 0), item(1, 2)];
    const allCorrect = buildAttemptReview("att-1", items, [
      response("item-0", 0),
      response("item-1", 2),
    ]);
    expect(reviewEntriesFor(allCorrect, "missed")).toEqual([]);
    expect(reviewEntriesFor(allCorrect, "all")).toHaveLength(2);

    expect(buildAttemptReview("att-1", [], [])).toEqual([]);
    expect(reviewEntriesFor([], "missed")).toEqual([]);
  });

  it("does not mutate its inputs and returns fresh arrays", () => {
    const items = deepFreeze([item(1, 0), item(0, 0)]);
    const responses = deepFreeze([response("item-0", 1), response("item-1", null, true)]);
    const entries = buildAttemptReview("att-1", items, responses);
    expect(items.map((i) => i.ordinal)).toEqual([1, 0]);
    expect(entries.map((e) => e.number)).toEqual([1, 2]);

    const frozenEntries = deepFreeze(entries);
    const all = reviewEntriesFor(frozenEntries, "all");
    const missed = reviewEntriesFor(frozenEntries, "missed");
    expect(all).not.toBe(frozenEntries);
    expect(missed).not.toBe(frozenEntries);
    expect(frozenEntries).toHaveLength(2);
  });
});

describe("review routing", () => {
  it("opens the focused view only for review=missed", () => {
    expect(reviewViewFromQuery("missed")).toBe("missed");
    expect(reviewViewFromQuery(null)).toBe("all");
    expect(reviewViewFromQuery(undefined)).toBe("all");
    expect(reviewViewFromQuery("")).toBe("all");
    expect(reviewViewFromQuery("MISSED")).toBe("all");
    expect(reviewViewFromQuery("everything")).toBe("all");
  });

  it("encodes both identifiers in the attempt path", () => {
    expect(attemptReviewPath("m 1/ä?#", "a/b c")).toBe(
      "/study/history/m%201%2F%C3%A4%3F%23/a%2Fb%20c",
    );
    expect(attemptReviewPath("k", "a", "missed")).toBe("/study/history/k/a?review=missed");
    expect(attemptReviewPath("k", "a", "all")).toBe("/study/history/k/a");
  });
});
