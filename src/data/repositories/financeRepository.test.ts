/**
 * Exercised against real SQLite (node:sqlite) so the schema's constraints —
 * foreign keys and the partial unique index — are genuinely under test.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories, DuplicateLessonCostError, type Repositories } from "./index";
import { fundSummary } from "@/logic/finance";

let db: TestDatabase;
let repos: Repositories;

beforeEach(async () => {
  db = await createNodeSqliteDatabase();
  repos = createRepositories(db);
});

afterEach(() => db.close());

const createLesson = () =>
  repos.schedule.create({
    title: "Crosswind Landings",
    date: "2026-09-06",
    estimatedCost: 275_00,
    actualCost: 265_00,
  });

describe("recording a lesson's cost", () => {
  it("creates the expense and links it to the lesson", async () => {
    const lesson = await createLesson();

    const transaction = await repos.finance.recordLessonCost({
      eventId: lesson.id,
      amount: 265_00,
      date: lesson.date,
      description: lesson.title,
    });

    expect(transaction.type).toBe("expense");
    expect(transaction.amount).toBe(265_00);
    expect(transaction.eventId).toBe(lesson.id);
    expect(transaction.source).toBe("lesson_cost");
    expect(transaction.category).toBe("flight_lesson");
  });

  it("refuses a second recording for the same lesson", async () => {
    const lesson = await createLesson();
    await repos.finance.recordLessonCost({
      eventId: lesson.id, amount: 265_00, date: lesson.date, description: lesson.title,
    });

    await expect(
      repos.finance.recordLessonCost({
        eventId: lesson.id, amount: 265_00, date: lesson.date, description: lesson.title,
      }),
    ).rejects.toBeInstanceOf(DuplicateLessonCostError);

    expect(await repos.finance.list()).toHaveLength(1);
  });

  it("hands back the existing transaction so the UI can point at it", async () => {
    const lesson = await createLesson();
    const first = await repos.finance.recordLessonCost({
      eventId: lesson.id, amount: 265_00, date: lesson.date, description: lesson.title,
    });

    const error = await repos.finance
      .recordLessonCost({
        eventId: lesson.id, amount: 300_00, date: lesson.date, description: lesson.title,
      })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DuplicateLessonCostError);
    expect((error as DuplicateLessonCostError).existing.id).toBe(first.id);
  });

  it("still allows separate manual expenses against the same lesson", async () => {
    // A lesson can legitimately cost rental plus instructor time.
    const lesson = await createLesson();
    await repos.finance.recordLessonCost({
      eventId: lesson.id, amount: 200_00, date: lesson.date, description: "Aircraft",
    });
    await repos.finance.create({
      type: "expense", amount: 65_00, date: lesson.date,
      category: "instructor", eventId: lesson.id, source: "manual",
    });

    expect(await repos.finance.list()).toHaveLength(2);
  });

  it("enforces the single lesson cost in the database, not only in code", async () => {
    const lesson = await createLesson();
    await repos.finance.recordLessonCost({
      eventId: lesson.id, amount: 265_00, date: lesson.date, description: lesson.title,
    });

    // Bypass the repository guard entirely: the schema must still refuse.
    await expect(
      repos.finance.create({
        type: "expense", amount: 999_00, date: lesson.date,
        eventId: lesson.id, source: "lesson_cost",
      }),
    ).rejects.toThrow();
  });

  it("lets a different lesson record its own cost", async () => {
    const first = await createLesson();
    const second = await repos.schedule.create({ title: "Slow Flight", date: "2026-09-13" });

    await repos.finance.recordLessonCost({
      eventId: first.id, amount: 265_00, date: first.date, description: first.title,
    });
    await repos.finance.recordLessonCost({
      eventId: second.id, amount: 240_00, date: second.date, description: second.title,
    });

    expect(await repos.finance.list()).toHaveLength(2);
  });
});

describe("the ledger", () => {
  it("keeps the balance consistent with what was written", async () => {
    await repos.finance.create({ type: "contribution", amount: 6_270_00, date: "2026-08-01" });
    await repos.finance.create({ type: "expense", amount: 3_420_00, date: "2026-08-20" });

    expect(fundSummary(await repos.finance.list()).balance).toBe(2_850_00);
  });

  it("reflects edits and deletions in the balance", async () => {
    await repos.finance.create({ type: "contribution", amount: 500_00, date: "2026-09-01" });
    const expense = await repos.finance.create({
      type: "expense", amount: 300_00, date: "2026-09-02",
    });

    await repos.finance.update(expense.id, { amount: 250_00 });
    expect(fundSummary(await repos.finance.list()).balance).toBe(250_00);

    await repos.finance.remove(expense.id);
    expect(fundSummary(await repos.finance.list()).balance).toBe(500_00);
  });

  it("keeps a transaction when its lesson is deleted, unlinking it instead", async () => {
    // Deleting a lesson must never silently destroy financial history.
    const lesson = await createLesson();
    await repos.finance.recordLessonCost({
      eventId: lesson.id, amount: 265_00, date: lesson.date, description: lesson.title,
    });

    await repos.schedule.remove(lesson.id);

    const transactions = await repos.finance.list();
    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.eventId).toBeNull();
  });
});

describe("savings targets", () => {
  it("keeps only one target active at a time", async () => {
    await repos.finance.saveFundGoal({ title: "Next phase", target: 3_000_00 });
    await repos.finance.saveFundGoal({ title: "Checkride fund", target: 5_000_00 });

    const goals = await repos.finance.listFundGoals();
    expect(goals.filter((goal) => goal.active)).toHaveLength(1);
    expect(goals.find((goal) => goal.active)?.title).toBe("Checkride fund");
  });
});
