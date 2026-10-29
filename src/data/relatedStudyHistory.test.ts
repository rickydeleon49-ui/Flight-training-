import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRepositories } from "./repositories";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";
import { seedPracticeTest } from "./testing/practiceTestFixtures";

let db: TestDatabase;
beforeEach(async () => { db = await createNodeSqliteDatabase(); });
afterEach(() => { db.close(); });

it("bounds the SQL summary read to the newest ten completed attempts for this material without loading items", async () => {
  const repos = createRepositories(db);
  await repos.documents.create({ id: "synthetic", title: "Fictional material" });
  await repos.documents.create({ id: "other", title: "Fictional other material" });
  for (const id of ["synthetic", "other"]) {
    await seedPracticeTest(db, { sourceMaterialId: id, title: "Fictional saved test", model: "test", questions: [{ question: "Fictional question", options: ["A", "B"], correctIndex: 0, explanation: "Synthetic explanation", sourcePage: null }] });
    const active = await repos.practiceSessions.getActiveVersion(id);
    for (let i = 0; i < 12; i++) {
      await db.execute(`INSERT INTO practice_attempts (id, version_id, source_material_id, source_material_title, status, started_at, completed_at, total_questions, answered_count, correct_count, incorrect_count, dont_know_count, score_percent, revision) VALUES (?, ?, ?, ?, 'completed', ?, ?, 1, 0, 0, 0, 0, 0, 0)`, [`${id}-${String(i).padStart(2, "0")}`, active!.version.id, id, "Frozen fictional title", "2026-10-01", `2026-10-${String(i + 1).padStart(2, "0")}`]);
    }
  }
  const reads = vi.spyOn(db, "select");
  const recent = await repos.practiceSessions.getCompletedHistory("synthetic", 10);
  expect(recent).toHaveLength(10);
  expect(recent.map(r => r.attemptId)).toEqual(Array.from({ length: 10 }, (_, i) => `synthetic-${String(11 - i).padStart(2, "0")}`));
  expect(recent.every(r => r.historyKey === "synthetic" && r.unansweredCount === 1)).toBe(true);
  expect(reads).toHaveBeenCalledTimes(1);
  expect(reads.mock.calls[0]![0]).toContain("LIMIT ?");
  expect(reads.mock.calls[0]![1]).toEqual(["synthetic", 10]);
  // Existing full history callers retain their contract.
  expect(await repos.practiceSessions.getCompletedHistory("synthetic")).toHaveLength(12);
});

it.each([0, -1, 1.5, NaN, Infinity])("rejects invalid optional history bound %s before reading", async limit => {
  const reads = vi.spyOn(db, "select");
  await expect(createRepositories(db).practiceSessions.getCompletedHistory("synthetic", limit)).rejects.toThrow("Invalid history limit");
  expect(reads).not.toHaveBeenCalled();
});
