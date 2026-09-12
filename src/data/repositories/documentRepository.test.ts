import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SqlDatabase, SqlValue } from "@/data/db";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "./index";

let db: TestDatabase;

beforeEach(async () => {
  db = await createNodeSqliteDatabase();
});

afterEach(() => db.close());

describe("creating PDF parts atomically", () => {
  it("rolls back every material when a tag insert fails", async () => {
    let tagInserts = 0;
    const failingDb: SqlDatabase = {
      select: <T>(sql: string, params?: SqlValue[]) => db.select<T>(sql, params),
      execute: async (sql: string, params?: SqlValue[]) => {
        if (sql.startsWith("INSERT INTO material_tags") && ++tagInserts === 2) {
          throw new Error("injected tag failure");
        }
        await db.execute(sql, params);
      },
    };
    const documents = createRepositories(failingDb).documents;

    await expect(documents.createMany([
      { id: "part-1", title: "Part 1", tags: ["handbook"] },
      { id: "part-2", title: "Part 2", tags: ["handbook"] },
    ])).rejects.toThrow("injected tag failure");

    expect(await db.select("SELECT id FROM study_materials")).toEqual([]);
    expect(await db.select("SELECT * FROM material_tags")).toEqual([]);
  });

  it("reports a rollback failure together with the original save failure", async () => {
    const failingDb: SqlDatabase = {
      select: <T>(sql: string, params?: SqlValue[]) => db.select<T>(sql, params),
      execute: async (sql: string, params?: SqlValue[]) => {
        if (sql === "ROLLBACK") throw new Error("injected rollback failure");
        if (sql.startsWith("INSERT INTO material_tags")) throw new Error("injected tag failure");
        await db.execute(sql, params);
      },
    };
    const documents = createRepositories(failingDb).documents;

    await expect(
      documents.createMany([{ id: "part-1", title: "Part 1", tags: ["handbook"] }]),
    ).rejects.toThrow("database rollback also failed");

    // Restore the real connection before the test database is closed.
    await db.execute("ROLLBACK");
  });
});

describe("practice tests", () => {
  it("saves a generated test tied to its source material and reads it back", async () => {
    const documents = createRepositories(db).documents;
    const material = await documents.create({ title: "Airplane Flying Handbook" });

    await documents.savePracticeTest({
      sourceMaterialId: material.id,
      title: "Traffic patterns",
      questions: [
        {
          question: "What is the standard pattern altitude?",
          options: ["800 ft AGL", "1,000 ft AGL"],
          correctIndex: 1,
          explanation: "1,000 ft AGL absent other guidance.",
          sourcePage: 42,
        },
      ],
      model: "gemini-3.5-flash",
    });

    const tests = await documents.listPracticeTests();
    expect(tests).toHaveLength(1);
    const saved = tests[0]!;
    expect(saved.sourceMaterialId).toBe(material.id);
    expect(saved.title).toBe("Traffic patterns");
    expect(saved.questions).toHaveLength(1);
    expect(saved.questions[0]).toEqual({
      question: "What is the standard pattern altitude?",
      options: ["800 ft AGL", "1,000 ft AGL"],
      correctIndex: 1,
      explanation: "1,000 ft AGL absent other guidance.",
      sourcePage: 42,
    });
    expect(saved.provider).toBe("gemini");
  });

  it("replaces a previous test for the same material instead of duplicating it", async () => {
    const documents = createRepositories(db).documents;
    const material = await documents.create({ title: "Weather Handbook" });
    const question = {
      question: "Q",
      options: ["A", "B"],
      correctIndex: 0,
      explanation: "E",
      sourcePage: null,
    };

    await documents.savePracticeTest({
      sourceMaterialId: material.id,
      title: "First attempt",
      questions: [question],
      model: "gemini-3.5-flash",
    });
    await documents.savePracticeTest({
      sourceMaterialId: material.id,
      title: "Regenerated",
      questions: [question, question],
      model: "gemini-3.5-flash-lite",
    });

    const tests = await documents.listPracticeTests();
    expect(tests).toHaveLength(1);
    expect(tests[0]!.title).toBe("Regenerated");
    expect(tests[0]!.questions).toHaveLength(2);
  });

  it("removes a saved test when its source material is deleted", async () => {
    const documents = createRepositories(db).documents;
    const material = await documents.create({ title: "Deletable" });
    await documents.savePracticeTest({
      sourceMaterialId: material.id,
      title: "Test",
      questions: [
        { question: "Q", options: ["A", "B"], correctIndex: 0, explanation: "E", sourcePage: null },
      ],
      model: "gemini-3.5-flash",
    });

    await documents.remove(material.id);

    expect(await documents.listPracticeTests()).toEqual([]);
  });

  it("removes a saved test directly without touching its source material", async () => {
    const documents = createRepositories(db).documents;
    const material = await documents.create({ title: "Keep me" });
    await documents.savePracticeTest({
      sourceMaterialId: material.id,
      title: "Test",
      questions: [
        { question: "Q", options: ["A", "B"], correctIndex: 0, explanation: "E", sourcePage: null },
      ],
      model: "gemini-3.5-flash",
    });

    await documents.removePracticeTest(material.id);

    expect(await documents.listPracticeTests()).toEqual([]);
    expect((await documents.list()).map((item) => item.id)).toContain(material.id);
  });
});
