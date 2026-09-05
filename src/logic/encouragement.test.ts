import { describe, expect, it } from "vitest";

import { encouragementMessage, type EncouragementInput } from "./encouragement";

const input = (overrides: Partial<EncouragementInput> = {}): EncouragementInput => ({
  today: "2026-09-05",
  nextLessonDate: null,
  nextLessonTitle: null,
  outstandingPrepCount: 0,
  overdueCount: 0,
  completedThisWeek: 0,
  openActionCount: 0,
  hasAnyData: true,
  ...overrides,
});

describe("encouragementMessage", () => {
  it("says nothing at all in an empty application", () => {
    expect(encouragementMessage(input({ hasAnyData: false }))).toBeNull();
  });

  it("names how much preparation is left before a near lesson", () => {
    const message = encouragementMessage(
      input({ nextLessonDate: "2026-09-07", nextLessonTitle: "Crosswind Landings", outstandingPrepCount: 2 }),
    );
    expect(message).toBe("Your next lesson is in 2 days. 2 preparation items remain.");
  });

  it("uses singular wording for a single item", () => {
    const message = encouragementMessage(
      input({ nextLessonDate: "2026-09-06", nextLessonTitle: "Crosswind Landings", outstandingPrepCount: 1 }),
    );
    expect(message).toBe("Your next lesson is tomorrow. 1 preparation item remains.");
  });

  it("confirms readiness when nothing is outstanding", () => {
    const message = encouragementMessage(
      input({ nextLessonDate: "2026-09-06", nextLessonTitle: "Crosswind Landings" }),
    );
    expect(message).toBe("You are prepared for Crosswind Landings.");
  });

  it("acknowledges overdue work without blaming her", () => {
    const message = encouragementMessage(input({ overdueCount: 2, openActionCount: 4 }));
    expect(message).toBe("2 items are waiting. Choose a realistic new time for one of them.");
    // Tone check: the product forbids shame language.
    expect(message).not.toMatch(/fail|behind|should have|missed/i);
  });

  it("names real completed work", () => {
    expect(encouragementMessage(input({ completedThisWeek: 4 }))).toBe(
      "You finished 4 things this week. That is real progress.",
    );
    expect(encouragementMessage(input({ completedThisWeek: 1 }))).toBe(
      "You finished 1 thing this week.",
    );
  });

  it("does not manufacture praise when nothing has happened", () => {
    const message = encouragementMessage(input({ openActionCount: 3 }));
    expect(message).toBeNull();
  });

  it("phrases the timing in words, never as a bare date", () => {
    // A lesson exactly a week out must not read "Your next lesson is sep 12."
    const message = encouragementMessage(
      input({ nextLessonDate: "2026-09-12", nextLessonTitle: "Crosswind Landings", outstandingPrepCount: 5 }),
    );
    expect(message).toBe("Your next lesson is in 7 days. 5 preparation items remain.");
  });

  it("ignores a lesson that is still far away", () => {
    const message = encouragementMessage(
      input({
        nextLessonDate: "2026-10-30",
        nextLessonTitle: "Night Flying",
        outstandingPrepCount: 3,
        openActionCount: 3,
      }),
    );
    expect(message).toBeNull();
  });
});
