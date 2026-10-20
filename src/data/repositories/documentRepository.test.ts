import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SqlDatabase, SqlValue } from "@/data/db";
import type { PracticeAuthoringQuestion } from "@/domain/types";
import { exportStudyPacket } from "@/logic/studyExport";
import { createNodeSqliteDatabase, type TestDatabase } from "@/data/testing/nodeSqliteDb";
import { createRepositories } from "./index";
import { documentRepository } from "./documentRepository";

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
    await db.execute(
      `CREATE TRIGGER fail_second_part BEFORE INSERT ON material_tags WHEN NEW.material_id = 'part-2'
       BEGIN SELECT RAISE(FAIL, 'injected tag failure'); END`,
    );
    const documents = createRepositories(db).documents;

    await expect(documents.createMany([
      { id: "part-1", title: "Part 1", tags: ["handbook"] },
      { id: "part-2", title: "Part 2", tags: ["handbook"] },
    ])).rejects.toThrow("injected tag failure");

    expect(await db.select("SELECT id FROM study_materials")).toEqual([]);
    expect(await db.select("SELECT * FROM material_tags")).toEqual([]);
    expect(await db.select("SELECT * FROM tags")).toEqual([]);
  });

  it("reports a rollback failure together with the original save failure", async () => {
    const { executeMaterialsBatch } = await import("@/data/materialTransaction");
    const material = (await createRepositories({
      select: async () => [],
      execute: async () => {},
      saveMaterialsAtomically: async () => {},
    }).documents.createMany([{ id: "part-1", title: "Part 1", tags: ["handbook"] }]))[0]!;

    await expect(
      executeMaterialsBatch(
        (sql) => {
          if (sql === "ROLLBACK") throw new Error("injected rollback failure");
        },
        (sql) => {
          if (sql.startsWith("INSERT INTO material_tags")) throw new Error("injected tag failure");
        },
        () => [{ id: "tag-1" }],
        [material],
      ),
    ).rejects.toThrow("database rollback also failed");
  });

  it("refuses a driver without an owned atomic batch instead of using public transaction statements", async () => {
    const statements: string[] = [];
    const pooledDb: SqlDatabase = {
      select: <T>(sql: string, params?: SqlValue[]) => db.select<T>(sql, params),
      execute: async (sql: string) => { statements.push(sql); },
    };
    await expect(
      createRepositories(pooledDb).documents.createMany([{ id: "part-1", title: "Part 1" }]),
    ).rejects.toThrow("atomic transaction support");
    expect(statements).toEqual([]);
  });

  it("does not retry a failure that has nothing to do with a lock", async () => {
    let attempts = 0;
    const atomicDb: SqlDatabase = {
      select: <T>(sql: string, params?: SqlValue[]) => db.select<T>(sql, params),
      execute: (sql: string, params?: SqlValue[]) => db.execute(sql, params),
      saveMaterialsAtomically: async () => {
        attempts += 1;
        throw new Error("no such column: bogus");
      },
    };
    await expect(
      createRepositories(atomicDb).documents.createMany([{ id: "part-1", title: "Part 1" }]),
    ).rejects.toThrow("no such column: bogus");
    expect(attempts).toBe(1);
  });

  it("retries past a transient lock when using saveMaterialsAtomically and succeeds", async () => {
    let attempts = 0;
    const atomicDb: SqlDatabase = {
      select: <T>(sql: string, params?: SqlValue[]) => db.select<T>(sql, params),
      execute: (sql: string, params?: SqlValue[]) => db.execute(sql, params),
      saveMaterialsAtomically: async (materials) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("Could not start saving PDF parts: database is locked");
        }
        for (const m of materials) {
          await db.execute(
            "INSERT INTO study_materials (id, title, material_type, topic, review_status, priority, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [m.id, m.title, m.materialType, m.topic, m.reviewStatus, m.priority, m.notes, m.createdAt, m.updatedAt],
          );
        }
      },
    };
    const documents = createRepositories(atomicDb).documents;

    const saved = await documents.createMany([
      { id: "atomic-1", title: "Atomic Part 1" },
      { id: "atomic-2", title: "Atomic Part 2" },
    ]);

    expect(saved.map((m) => m.id)).toEqual(["atomic-1", "atomic-2"]);
    expect(attempts).toBe(2);
    expect(await db.select("SELECT id FROM study_materials WHERE id LIKE 'atomic-%' ORDER BY id")).toEqual([
      { id: "atomic-1" },
      { id: "atomic-2" },
    ]);
  });

  it("gives up boundedly on saveMaterialsAtomically if the lock never clears", async () => {
    let attempts = 0;
    const atomicDb: SqlDatabase = {
      select: <T>(sql: string, params?: SqlValue[]) => db.select<T>(sql, params),
      execute: (sql: string, params?: SqlValue[]) => db.execute(sql, params),
      saveMaterialsAtomically: async () => {
        attempts += 1;
        throw new Error("database is locked (code: 5)");
      },
    };
    const documents = createRepositories(atomicDb).documents;

    await expect(
      documents.createMany([{ id: "part-1", title: "Part 1" }]),
    ).rejects.toThrow("busy");
    expect(attempts).toBe(4); // initial + 3 retries
  });
});

describe("practice tests", () => {
  it("saves a generated test tied to its source material and reads it back", async () => {
    const documents = createRepositories(db).documents;
    const material = await documents.create({ title: "Airplane Flying Handbook" });

    await documents.savePracticeTest({ provider: "gemini",
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

    await documents.savePracticeTest({ provider: "gemini",
      sourceMaterialId: material.id,
      title: "First attempt",
      questions: [question],
      model: "gemini-3.5-flash",
    });
    await documents.savePracticeTest({ provider: "gemini",
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
    await documents.savePracticeTest({ provider: "gemini",
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
    await documents.savePracticeTest({ provider: "gemini",
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

  const corrected = {
    question: "Corrected synthetic stem",
    options: ["First", "Second"],
    correctIndex: 0,
    explanation: "Synthetic explanation",
    sourcePage: null,
  };
  const plain = {
    question: "Plain synthetic stem",
    options: ["A", "B"],
    correctIndex: 1,
    explanation: "Synthetic explanation",
    sourcePage: null,
  };

  /** One authoring save through the real transaction, origins and all. */
  async function saveAuthoredTest(materialId: string, questions: PracticeAuthoringQuestion[]): Promise<void> {
    const saved = await db.savePracticeAuthoringAtomically!({
      operationId: crypto.randomUUID(),
      sourceMaterialId: materialId,
      reason: "create",
      expected: null,
      next: { title: "Authored test", provider: "manual", model: "", questions, retired: [] },
    });
    expect(saved).toEqual({ status: "saved" });
  }

  it("reads back an instructor correction with its real origin", async () => {
    const documents = createRepositories(db).documents;
    const material = await documents.create({ title: "Instructor corrections" });
    await saveAuthoredTest(material.id, [
      { ...corrected, identity: crypto.randomUUID(), origin: "instructor" },
      { ...plain, identity: crypto.randomUUID() },
    ]);

    const test = (await documents.listPracticeTests()).find((t) => t.sourceMaterialId === material.id)!;
    expect(test.questions[0]!.origin).toBe("instructor");
    expect(test.questions[1]!.question).toBe(plain.question);
  });

  it("omits the origin key entirely for a question with no stored origin", async () => {
    const documents = createRepositories(db).documents;
    const material = await documents.create({ title: "Generated set" });
    await documents.savePracticeTest({ provider: "gemini",
      sourceMaterialId: material.id,
      title: "Generated",
      questions: [plain],
      model: "gemini-3.5-flash",
    });

    const test = (await documents.listPracticeTests()).find((t) => t.sourceMaterialId === material.id)!;
    expect("origin" in test.questions[0]!).toBe(false);
    expect(test.questions[0]).toEqual(plain);
  });

  it("keeps packet v1 export unchanged: exported questions carry no origin key", async () => {
    const documents = createRepositories(db).documents;
    const material = await documents.create({ title: "Packet source" });
    await saveAuthoredTest(material.id, [
      { ...corrected, identity: crypto.randomUUID(), origin: "instructor" },
      { ...plain, identity: crypto.randomUUID() },
    ]);

    const test = (await documents.listPracticeTests()).find((t) => t.sourceMaterialId === material.id)!;
    expect(test.questions[0]!.origin).toBe("instructor");

    const result = exportStudyPacket(
      { material: { title: material.title }, studySet: null, practiceTest: test },
      { guide: false, flashcards: false, questions: true, instructorCorrections: true },
      new Date("2026-10-19T12:00:00.000Z"),
    );
    if (!result.ok) throw new Error(`packet export refused: ${result.message}`);
    const packet = JSON.parse(result.text) as { questions: Record<string, unknown>[] };
    expect(packet.questions).toHaveLength(2);
    for (const exported of packet.questions) {
      expect("origin" in exported).toBe(false);
      expect(Object.keys(exported).sort()).toEqual([
        "choices",
        "correctChoiceId",
        "explanation",
        "id",
        "question",
        "type",
      ]);
    }
  });
});

describe("ordinary material create and update atomicity (A2)", () => {
  it("normalizes and deduplicates duplicate and whitespace tags during create without partial save", async () => {
    const documents = createRepositories(db).documents;
    const material = await documents.create({
      id: "mat-dup-create",
      title: "Synthetic FAA",
      filePath: "audit-new.pdf",
      tags: ["FAA", "  FAA  ", "Regulation"],
    });

    expect(material.tags).toEqual(["FAA", "Regulation"]);
    const saved = (await documents.list()).find((m) => m.id === "mat-dup-create");
    expect(saved?.tags).toEqual(["FAA", "Regulation"]);
  });

  it("normalizes and deduplicates duplicate tags during update without corrupting tags", async () => {
    const documents = createRepositories(db).documents;
    const material = await documents.create({
      id: "mat-dup-update",
      title: "Initial",
      tags: ["InitialTag"],
    });

    await documents.update(material.id, {
      title: "Replacement",
      tags: ["FAA", "FAA"],
    });

    const updated = (await documents.list()).find((m) => m.id === material.id);
    expect(updated?.title).toBe("Replacement");
    expect(updated?.tags).toEqual(["FAA"]);
  });

  it("rolls back completely on injected tag-write failure during create, leaving no material debris", async () => {
    const documents = createRepositories(db).documents;
    await db.execute(
      "CREATE TRIGGER fail_tag_insert BEFORE INSERT ON material_tags BEGIN SELECT RAISE(FAIL, 'injected tag failure'); END;",
    );

    try {
      await expect(
        documents.create({
          id: "mat-fail-create",
          title: "Should Roll Back",
          filePath: "should-not-exist.pdf",
          tags: ["tag1"],
        }),
      ).rejects.toThrow();

      // The material must NOT be committed in study_materials!
      const rows = await db.select("SELECT id FROM study_materials WHERE id = 'mat-fail-create'");
      expect(rows).toEqual([]);
      const tags = await db.select("SELECT * FROM material_tags WHERE material_id = 'mat-fail-create'");
      expect(tags).toEqual([]);
    } finally {
      await db.execute("DROP TRIGGER IF EXISTS fail_tag_insert");
    }
  });

  it("rolls back completely on injected tag-write failure during update, preserving prior metadata, file reference, and tags", async () => {
    const documents = createRepositories(db).documents;
    const original = await documents.create({
      id: "mat-fail-update",
      title: "Prior Title",
      filePath: "prior-file.pdf",
      originalFileName: "prior-file.pdf",
      fileSize: 1024,
      tags: ["prior-tag-1", "prior-tag-2"],
    });

    await db.execute(
      "CREATE TRIGGER fail_tag_insert BEFORE INSERT ON material_tags BEGIN SELECT RAISE(FAIL, 'injected tag failure'); END;",
    );

    try {
      await expect(
        documents.update(original.id, {
          title: "New Title",
          filePath: "new-file.pdf",
          tags: ["new-tag"],
        }),
      ).rejects.toThrow();

      // Prior metadata, file reference and tags must be preserved intact!
      const all = await documents.list();
      const preserved = all.find((item) => item.id === original.id);
      expect(preserved?.title).toBe("Prior Title");
      expect(preserved?.filePath).toBe("prior-file.pdf");
      expect(preserved?.originalFileName).toBe("prior-file.pdf");
      expect(preserved?.fileSize).toBe(1024);
      expect(preserved?.tags).toEqual(["prior-tag-1", "prior-tag-2"]);
    } finally {
      await db.execute("DROP TRIGGER IF EXISTS fail_tag_insert");
    }
  });

  it("replacement followed by failed save preserves old file reference and leaves new file unreferenced", async () => {
    const documents = createRepositories(db).documents;
    const original = await documents.create({
      id: "mat-replace-fail",
      title: "Original Handbook",
      filePath: "documents/old-handbook.pdf",
      originalFileName: "old-handbook.pdf",
      fileSize: 2048,
      tags: ["handbook", "faa"],
    });

    await db.execute(
      "CREATE TRIGGER fail_tag_on_replace BEFORE INSERT ON material_tags BEGIN SELECT RAISE(FAIL, 'injected failure during replace'); END;",
    );

    try {
      await expect(
        documents.update(original.id, {
          title: "New Handbook",
          filePath: "documents/new-handbook.pdf",
          originalFileName: "new-handbook.pdf",
          fileSize: 4096,
          tags: ["handbook", "faa", "new-tag"],
        }),
      ).rejects.toThrow();

      // Verify in database: the material MUST still reference the old file!
      const rows = await db.select<{ file_path: string }>(
        "SELECT file_path FROM study_materials WHERE id = 'mat-replace-fail'",
      );
      expect(rows[0]?.file_path).toBe("documents/old-handbook.pdf");

      // The new file must NOT be referenced by any study material
      const newFileRefs = await db.select<{ id: string }>(
        "SELECT id FROM study_materials WHERE file_path = 'documents/new-handbook.pdf'",
      );
      expect(newFileRefs).toEqual([]);
    } finally {
      await db.execute("DROP TRIGGER IF EXISTS fail_tag_on_replace");
    }
  });

  it("refuses create when material ID collides, preserving the existing record", async () => {
    const documents = createRepositories(db).documents;
    await documents.create({
      id: "mat-collision",
      title: "Existing",
      notes: "Original Notes",
      tags: ["tag-original"],
    });

    await expect(
      documents.create({
        id: "mat-collision",
        title: "Intruder",
        notes: "Hacked Notes",
        tags: ["tag-intruder"],
      }),
    ).rejects.toThrow();

    const current = (await documents.list()).find((m) => m.id === "mat-collision");
    expect(current?.title).toBe("Existing");
    expect(current?.notes).toBe("Original Notes");
    expect(current?.tags).toEqual(["tag-original"]);
  });

  it("refuses update when material does not exist", async () => {
    const documents = createRepositories(db).documents;
    await expect(
      documents.update("non-existent-id", { title: "Phantom" }),
    ).rejects.toThrow("That study material no longer exists.");
  });

  it("partial update preserves unchanged fields and createdAt timestamp", async () => {
    const documents = createRepositories(db).documents;
    const created = await documents.create({
      id: "mat-partial",
      title: "Full Spec",
      notes: "Do not touch",
      priority: "important",
      topic: "weather",
      tags: ["preserve-tag"],
    });

    const originalCreatedAt = created.createdAt;

    await documents.update(created.id, {
      title: "Updated Title Only",
    });

    const updated = (await documents.list()).find((m) => m.id === created.id);
    expect(updated?.title).toBe("Updated Title Only");
    expect(updated?.notes).toBe("Do not touch");
    expect(updated?.priority).toBe("important");
    expect(updated?.topic).toBe("weather");
    expect(updated?.createdAt).toBe(originalCreatedAt);
    expect(updated?.tags).toEqual(["preserve-tag"]);
  });

  it("omitted tags preserves old links; explicit empty array clears them", async () => {
    const documents = createRepositories(db).documents;
    const material = await documents.create({
      id: "mat-tag-semantics",
      title: "Tag Test",
      tags: ["tagA", "tagB"],
    });

    // 1. Update with omitted tags (undefined): old links preserved
    await documents.update(material.id, {
      title: "Tag Test 2",
    });
    let current = (await documents.list()).find((m) => m.id === material.id);
    expect(current?.tags).toEqual(["tagA", "tagB"]);

    // 2. Update with explicit empty array []: links cleared
    await documents.update(material.id, {
      tags: [],
    });
    current = (await documents.list()).find((m) => m.id === material.id);
    expect(current?.tags).toEqual([]);
  });

  it("handles null and empty fields properly on create and update", async () => {
    const documents = createRepositories(db).documents;
    const material = await documents.create({
      id: "mat-nulls",
      title: "No-File Material",
      filePath: null,
      fileSize: null,
      goalId: null,
      notes: "",
    });

    expect(material.filePath).toBeNull();
    expect(material.fileSize).toBeNull();

    // Update nullable field to a value then back to null
    await documents.update(material.id, {
      filePath: "documents/added.pdf",
      fileSize: 500,
    });
    let current = (await documents.list()).find((m) => m.id === material.id);
    expect(current?.filePath).toBe("documents/added.pdf");
    expect(current?.fileSize).toBe(500);

    await documents.update(material.id, {
      filePath: null,
      fileSize: null,
    });
    current = (await documents.list()).find((m) => m.id === material.id);
    expect(current?.filePath).toBeNull();
    expect(current?.fileSize).toBeNull();
  });

  it("handles Unicode tags and whitespace normalization consistently", async () => {
    const documents = createRepositories(db).documents;
    const material = await documents.create({
      id: "mat-unicode-tags",
      title: "Unicode Test",
      tags: ["  Météo  ", "✈️ Flight", "Météo", "  ", "Navigation"],
    });

    expect(material.tags).toEqual(["Météo", "✈️ Flight", "Navigation"]);
    const current = (await documents.list()).find((m) => m.id === material.id);
    // list() orders tags by name alphabetically in SQLite
    expect(current?.tags.slice().sort()).toEqual(["Météo", "Navigation", "✈️ Flight"].sort());
  });

  it("refuses save when db driver lacks atomic transaction support", async () => {
    const fakeDb = {
      select: async () => [],
      execute: async () => {},
    };
    const brokenDocs = documentRepository(fakeDb as unknown as SqlDatabase);

    await expect(
      brokenDocs.create({ title: "Unsafe Driver" }),
    ).rejects.toThrow(
      "Atomic study material saves require a database driver with atomic transaction support.",
    );

    await expect(
      brokenDocs.update("any-id", { title: "Unsafe Update" }),
    ).rejects.toThrow(
      "Atomic study material saves require a database driver with atomic transaction support.",
    );
  });

  it("retries transient lock on material save and succeeds", async () => {
    let calls = 0;
    const interceptedDb: SqlDatabase = {
      ...db,
      async saveMaterialAtomically(op) {
        calls++;
        if (calls < 2) {
          throw new Error("database is locked (code: 5)");
        }
        return db.saveMaterialAtomically!(op);
      },
    };
    const documents = documentRepository(interceptedDb);

    const saved = await documents.create({
      id: "mat-transient-retry",
      title: "Transient Retry Material",
      tags: ["retry"],
    });

    expect(saved.title).toBe("Transient Retry Material");
    expect(calls).toBe(2);
  });

  it("times out boundedly when material save encounters permanent lock", async () => {
    let calls = 0;
    const interceptedDb: SqlDatabase = {
      ...db,
      async saveMaterialAtomically() {
        calls++;
        throw new Error("SQLITE_BUSY: database is locked");
      },
    };
    const documents = documentRepository(interceptedDb);

    await expect(
      documents.create({
        id: "mat-permanent-lock",
        title: "Permanent Lock Material",
      }),
    ).rejects.toThrow("The database was busy, so this study material could not be saved after several tries.");

    // Retried 3 delays beyond initial call = 4 attempts total
    expect(calls).toBe(4);
  });
});
