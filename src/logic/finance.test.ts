import { describe, expect, it } from "vitest";

import { makeEvent as event, makeTransaction as transaction } from "@/testing/factories";
import {
  averageLessonCost,
  countPaidLessons,
  fundGoalProgress,
  fundSummary,
  spendingByCategory,
  spentInMonth,
  totalUpcoming,
  upcomingExpenses,
} from "./finance";

describe("fundSummary", () => {
  it("derives the balance from contributions and expenses", () => {
    const summary = fundSummary([
      transaction({ type: "contribution", amount: 500_00 }),
      transaction({ type: "contribution", amount: 127_00 }),
      transaction({ type: "expense", amount: 265_00 }),
    ]);

    expect(summary.totalContributed).toBe(627_00);
    expect(summary.totalSpent).toBe(265_00);
    expect(summary.balance).toBe(362_00);
  });

  it("returns zeroes for an empty ledger rather than throwing", () => {
    expect(fundSummary([])).toEqual({ totalContributed: 0, totalSpent: 0, balance: 0 });
  });

  it("allows the balance to go negative instead of clamping it", () => {
    // Spending past what was set aside is real and should be visible.
    const summary = fundSummary([
      transaction({ type: "contribution", amount: 100_00 }),
      transaction({ type: "expense", amount: 175_00 }),
    ]);
    expect(summary.balance).toBe(-75_00);
  });

  it("stays exact across many cent-level amounts", () => {
    // The reason money is stored in cents: this would drift with floats.
    const many = Array.from({ length: 100 }, () =>
      transaction({ type: "expense", amount: 10 }),
    );
    expect(fundSummary(many).totalSpent).toBe(1000);
  });
});

describe("spentInMonth", () => {
  const ledger = [
    transaction({ type: "expense", amount: 265_00, date: "2026-09-03" }),
    transaction({ type: "expense", amount: 42_00, date: "2026-09-29" }),
    transaction({ type: "expense", amount: 280_00, date: "2026-08-26" }),
    transaction({ type: "contribution", amount: 500_00, date: "2026-09-05" }),
  ];

  it("counts only expenses inside the month", () => {
    expect(spentInMonth(ledger, "2026-09-15")).toBe(307_00);
  });

  it("ignores contributions", () => {
    expect(spentInMonth([transaction({ type: "contribution", amount: 500_00 })], "2026-09-01")).toBe(0);
  });
});

describe("upcomingExpenses", () => {
  const today = "2026-09-05";

  it("lists future scheduled events that have an estimate", () => {
    const upcoming = upcomingExpenses(
      [
        event({ id: "a", date: "2026-09-06", estimatedCost: 275_00 }),
        event({ id: "b", date: "2026-09-20", estimatedCost: 150_00 }),
        event({ id: "c", date: "2026-09-10" }), // no estimate
      ],
      [],
      today,
    );

    expect(upcoming.map((u) => u.event.id)).toEqual(["a", "b"]);
    expect(totalUpcoming(upcoming)).toBe(425_00);
  });

  it("excludes events whose cost has already been recorded", () => {
    // Money must never appear as both upcoming and spent.
    const upcoming = upcomingExpenses(
      [event({ id: "a", date: "2026-09-06", estimatedCost: 275_00 })],
      [transaction({ type: "expense", amount: 265_00, eventId: "a", source: "lesson_cost" })],
      today,
    );
    expect(upcoming).toHaveLength(0);
  });

  it("excludes past and cancelled events", () => {
    const upcoming = upcomingExpenses(
      [
        event({ id: "past", date: "2026-09-01", estimatedCost: 275_00 }),
        event({ id: "cancelled", date: "2026-09-30", estimatedCost: 275_00, status: "cancelled" }),
      ],
      [],
      today,
    );
    expect(upcoming).toHaveLength(0);
  });

  it("returns events in date order", () => {
    const upcoming = upcomingExpenses(
      [
        event({ id: "later", date: "2026-10-01", estimatedCost: 100_00 }),
        event({ id: "sooner", date: "2026-09-08", estimatedCost: 100_00 }),
      ],
      [],
      today,
    );
    expect(upcoming.map((u) => u.event.id)).toEqual(["sooner", "later"]);
  });
});

describe("fundGoalProgress", () => {
  it("reports real progress toward a chosen target", () => {
    expect(fundGoalProgress(2_850_00, 5_000_00)).toBeCloseTo(0.57);
  });

  it("clamps to the 0–1 range", () => {
    expect(fundGoalProgress(6_000_00, 5_000_00)).toBe(1);
    expect(fundGoalProgress(-100_00, 5_000_00)).toBe(0);
  });

  it("returns zero rather than dividing by an absent target", () => {
    expect(fundGoalProgress(2_850_00, 0)).toBe(0);
  });
});

describe("cost insights", () => {
  it("averages lesson and rental expenses", () => {
    const average = averageLessonCost([
      transaction({ amount: 265_00, category: "flight_lesson" }),
      transaction({ amount: 280_00, category: "flight_lesson" }),
      transaction({ amount: 42_00, category: "study_materials" }),
    ]);
    expect(average).toBe(272_50);
  });

  it("returns null with no lesson data instead of a misleading zero", () => {
    expect(averageLessonCost([transaction({ amount: 42_00, category: "books" })])).toBeNull();
  });

  it("counts paid lessons and groups spending by category", () => {
    const ledger = [
      transaction({ amount: 265_00, category: "flight_lesson" }),
      transaction({ amount: 280_00, category: "flight_lesson" }),
      transaction({ amount: 42_00, category: "books" }),
    ];
    expect(countPaidLessons(ledger)).toBe(2);
    expect(spendingByCategory(ledger).get("flight_lesson")).toBe(545_00);
    expect(spendingByCategory(ledger).get("books")).toBe(42_00);
  });
});
