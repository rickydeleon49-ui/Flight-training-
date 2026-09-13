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
  it("uses the desktop's pinned batch instead of pooled transaction statements", async () => {
    const saved: string[] = [];
    const desktopDb: SqlDatabase = {
      select: <T>(sql: string, params?: SqlValue[]) => db.select<T>(sql, params),
      execute: async () => { throw new Error("pooled SQL transaction must not be used"); },
      saveMaterialsAtomically: async (materials) => {
        saved.push(...materials.map((material) => material.id));
      },
    };
    const result = await createRepositories(desktopDb).documents.createMany([
      { id: "part-1", title: "Part 1" },
      { id: "part-2", title: "Part 2" },
    ]);
    expect(saved).toEqual(["part-1", "part-2"]);
    expect(result.map((material) => material.id)).toEqual(saved);
  });

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

  it("retries past a competing lock and still saves every part", async () => {
    // Stands in for another connection — an autosave, a backup snapshot —
    // holding the database just long enough that the first BEGIN loses the
    // race, exactly what a real split can collide with.
    let beginAttempts = 0;
    const failingDb: SqlDatabase = {
      select: <T>(sql: string, params?: SqlValue[]) => db.select<T>(sql, params),
      execute: async (sql: string, params?: SqlValue[]) => {
        if (sql === "BEGIN IMMEDIATE" && ++beginAttempts === 1) {
          throw new Error("database is locked (code: 5)");
        }
        await db.execute(sql, params);
      },
    };
    const documents = createRepositories(failingDb).documents;

    const saved = await documents.createMany([
      { id: "part-1", title: "Part 1" },
      { id: "part-2", title: "Part 2" },
    ]);

    expect(saved.map((material) => material.id)).toEqual(["part-1", "part-2"]);
    expect(beginAttempts).toBe(2);
    expect(await db.select("SELECT id FROM study_materials ORDER BY id")).toEqual([
      { id: "part-1" },
      { id: "part-2" },
    ]);
  });

  it("gives up on a lock that never clears, with a plain message and a bounded number of tries", async () => {
    let beginAttempts = 0;
    const failingDb: SqlDatabase = {
      select: <T>(sql: string, params?: SqlValue[]) => db.select<T>(sql, params),
      execute: async (sql: string, params?: SqlValue[]) => {
        if (sql === "BEGIN IMMEDIATE") {
          beginAttempts += 1;
          throw new Error("database is locked (code: 5)");
        }
        await db.execute(sql, params);
      },
    };
    const documents = createRepositories(failingDb).documents;

    await expect(
      documents.createMany([{ id: "part-1", title: "Part 1" }]),
    ).rejects.toThrow("busy");
    // One first try plus every configured retry — never more, and never a
    // silent hang if the lock simply never clears.
    expect(beginAttempts).toBe(4);
  });

  it("does not retry a failure that has nothing to do with a lock", async () => {
    // The existing "injected tag failure" case above already proves this in
    // effect (it rejects immediately with the original message), but this
    // makes the "not retried" part an explicit, direct assertion.
    let beginAttempts = 0;
    const failingDb: SqlDatabase = {
      select: <T>(sql: string, params?: SqlValue[]) => db.select<T>(sql, params),
      execute: async (sql: string, params?: SqlValue[]) => {
        if (sql === "BEGIN IMMEDIATE") beginAttempts += 1;
        if (sql.startsWith("INSERT INTO study_materials")) {
          throw new Error("no such column: bogus");
        }
        await db.execute(sql, params);
      },
    };
    const documents = createRepositories(failingDb).documents;

    await expect(
      documents.createMany([{ id: "part-1", title: "Part 1" }]),
    ).rejects.toThrow("no such column: bogus");
    expect(beginAttempts).toBe(1);
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
