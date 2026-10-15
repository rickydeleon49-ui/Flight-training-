import { describe, expect, it } from "vitest";

import {
  makeEvent as event,
  makeJournalEntry as journal,
  makeTransaction as transaction,
} from "@/testing/factories";
import {
  fundGoalProgress,
  fundSummary,
  monthlySpending,
  spendingByCategory,
  spentInMonth,
  totalUpcoming,
  trainingCostSummary,
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
  it("averages unlinked lesson expenses one per lesson and ignores other categories", () => {
    const summary = trainingCostSummary([
      transaction({ amount: 265_00, category: "flight_lesson" }),
      transaction({ amount: 280_00, category: "flight_lesson" }),
      transaction({ amount: 42_00, category: "study_materials" }),
    ]);
    expect(summary.lessons).toHaveLength(2);
    expect(summary.averageLesson).toBe(272_50);
  });

  it("returns null with no lesson data instead of a misleading zero", () => {
    const summary = trainingCostSummary([transaction({ amount: 42_00, category: "books" })]);
    expect(summary.averageLesson).toBeNull();
    expect(summary.lessons).toHaveLength(0);
    expect(summary.perFlightHour).toBeNull();
  });

  it("groups spending by category", () => {
    const ledger = [
      transaction({ amount: 265_00, category: "flight_lesson" }),
      transaction({ amount: 280_00, category: "flight_lesson" }),
      transaction({ amount: 42_00, category: "books" }),
    ];
    expect(spendingByCategory(ledger).get("flight_lesson")).toBe(545_00);
    expect(spendingByCategory(ledger).get("books")).toBe(42_00);
  });
});

describe("trainingCostSummary", () => {
  it("counts instruction plus rental for one lesson as one lesson, not two cheaper ones", () => {
    const summary = trainingCostSummary([
      transaction({ amount: 150_00, category: "instructor", eventId: "e1" }),
      transaction({ amount: 180_00, category: "aircraft_rental", eventId: "e1" }),
      transaction({ amount: 300_00, category: "flight_lesson", eventId: "e2" }),
    ]);
    expect(summary.lessons.map((l) => [l.eventId, l.cost])).toEqual([
      ["e1", 330_00],
      ["e2", 300_00],
    ]);
    expect(summary.averageLesson).toBe(315_00);
  });

  it("does not turn linked or unlinked instruction alone into a paid lesson", () => {
    const summary = trainingCostSummary([
      transaction({ amount: 60_00, category: "instructor", eventId: "ground-1" }),
      transaction({ amount: 45_00, category: "instructor" }),
      transaction({ amount: 25_00, category: "fees", eventId: "e1" }),
      transaction({ amount: 200_00, category: "flight_lesson", eventId: "e1" }),
    ]);
    expect(summary.lessons).toHaveLength(1);
    expect(summary.lessons[0]).toMatchObject({ eventId: "e1", cost: 200_00 });
  });

  it("ignores contributions, even when linked to a lesson", () => {
    const summary = trainingCostSummary([
      transaction({ type: "contribution", amount: 500_00, category: "flight_lesson", eventId: "e1" }),
      transaction({ amount: 200_00, category: "flight_lesson", eventId: "e1" }),
    ]);
    expect(summary.lessons).toEqual([expect.objectContaining({ eventId: "e1", cost: 200_00 })]);
  });

  it("divides only the cost of lessons with logged time by that same time", () => {
    const summary = trainingCostSummary(
      [
        transaction({ amount: 330_00, category: "aircraft_rental", eventId: "e1" }),
        transaction({ amount: 220_00, category: "flight_lesson", eventId: "e2" }),
        // No logged time: left out of the rate rather than inflating it.
        transaction({ amount: 400_00, category: "flight_lesson", eventId: "e3" }),
        transaction({ amount: 250_00, category: "flight_lesson" }),
      ],
      [
        journal({ eventId: "e1", totalTime: 1.5 }),
        journal({ eventId: "e2", totalTime: 0.7 }),
        journal({ eventId: "e2", totalTime: 0.3 }),
        journal({ eventId: "e3", totalTime: null }),
        // Hours for a lesson with no recorded cost don't dilute the rate.
        journal({ eventId: "e9", totalTime: 2 }),
        journal({ eventId: null, totalTime: 1.2 }),
      ],
    );
    expect(summary.perFlightHour).toEqual({ perHour: 220_00, lessonsCounted: 2, hours: 2.5, cost: 550_00 });
    expect(summary.lessons).toHaveLength(4);
  });

  it("reports no rate when no lesson has both a cost and logged time", () => {
    const summary = trainingCostSummary(
      [transaction({ amount: 200_00, category: "flight_lesson", eventId: "e1" })],
      [journal({ eventId: "e1", totalTime: 0 }), journal({ eventId: "e2", totalTime: 1.4 })],
    );
    expect(summary.perFlightHour).toBeNull();
    expect(summary.averageLesson).toBe(200_00);
  });

  it("refuses non-finite logged time instead of producing a broken rate", () => {
    const summary = trainingCostSummary(
      [transaction({ amount: 200_00, category: "flight_lesson", eventId: "e1" })],
      [journal({ eventId: "e1", totalTime: Number.NaN }), journal({ eventId: "e1", totalTime: Number.POSITIVE_INFINITY })],
    );
    expect(summary.perFlightHour).toBeNull();
  });

  it("reports a recorded lesson total beside separate lesson expenses, without dropping either", () => {
    const total = transaction({ amount: 330_00, category: "flight_lesson", eventId: "e1", source: "lesson_cost" });
    const itemized = transaction({ amount: 180_00, category: "aircraft_rental", eventId: "e1" });
    const summary = trainingCostSummary([
      total,
      itemized,
      transaction({ amount: 300_00, category: "flight_lesson", eventId: "e2", source: "lesson_cost" }),
      transaction({ amount: 25_00, category: "fees", eventId: "e2" }),
      transaction({ amount: 150_00, category: "instructor", eventId: "e3" }),
      transaction({ amount: 180_00, category: "aircraft_rental", eventId: "e3" }),
    ]);
    expect(summary.possibleDoubleCounts).toEqual([
      { eventId: "e1", transactionIds: [total.id, itemized.id], cost: 510_00 },
    ]);
    expect(summary.lessons.find((l) => l.eventId === "e1")?.cost).toBe(510_00);
  });
});

describe("monthlySpending", () => {
  it("lists the last six months oldest first, including empty months, across a year boundary", () => {
    const rows = monthlySpending(
      [
        transaction({ amount: 300_00, category: "flight_lesson", date: "2026-02-10" }),
        transaction({ amount: 45_00, category: "books", date: "2026-02-11" }),
        transaction({ amount: 120_00, category: "medical", date: "2025-09-30" }),
        transaction({ type: "contribution", amount: 900_00, date: "2026-02-01" }),
      ],
      "2026-02-14",
    );
    expect(rows.map((r) => r.month)).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(rows[0]).toEqual({ month: "2025-09", spent: 120_00, lessons: 0 });
    expect(rows[1]).toEqual({ month: "2025-10", spent: 0, lessons: 0 });
    expect(rows[5]).toEqual({ month: "2026-02", spent: 345_00, lessons: 300_00 });
  });

  it("leaves out expenses older than the window or dated after the current month", () => {
    const rows = monthlySpending(
      [
        transaction({ amount: 50_00, date: "2026-04-30" }),
        transaction({ amount: 70_00, date: "2026-11-01" }),
        transaction({ amount: 10_00, date: "2026-10-31" }),
      ],
      "2026-10-14",
    );
    expect(rows.reduce((sum, r) => sum + r.spent, 0)).toBe(10_00);
  });

  it("counts linked instruction as lesson money only when it belongs to a lesson", () => {
    const rows = monthlySpending(
      [
        transaction({ amount: 150_00, category: "instructor", eventId: "e1", date: "2026-10-02" }),
        transaction({ amount: 180_00, category: "aircraft_rental", eventId: "e1", date: "2026-10-02" }),
        transaction({ amount: 60_00, category: "instructor", eventId: "ground", date: "2026-10-03" }),
      ],
      "2026-10-14",
    );
    expect(rows.at(-1)).toEqual({ month: "2026-10", spent: 390_00, lessons: 330_00 });
  });
});
