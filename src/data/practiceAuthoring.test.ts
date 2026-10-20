/**
 * OFFLINE-03b round 1 — maintained practice-authoring regressions.
 *
 * These tests exercise the real transaction on the real single-connection
 * drivers (node:sqlite and sql.js) over disposable databases: receipts,
 * staleness, the retirement ledger and its exact fingerprints, origin
 * laundering through replacement lineage and preserved history (including
 * tied wall clocks and arbitrary row ids), attempts protection, injected
 * failure rollback, and truthful current/version/history readers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

import type {
  PracticeAuthoringQuestion,
  PracticeNext,
  PracticeRetirementRecord,
  PracticeSaveOperation,
  PracticeSnapshot,
} from "@/domain/types";

import {
  appendPracticeRetirements,
  practiceContentHash,
  practiceRetirementRecord,
  readCurrentSnapshot,
  validateProtection,
} from "./practiceAuthoring";
import { PracticeAuthoringError } from "./persistenceErrors";
import type { SqlDatabase } from "./db";
import { documentRepository } from "./repositories/documentRepository";
import { practiceSessionRepository } from "./repositories/practiceSessionRepository";
import { createSqlJsDatabase } from "./sqlJsDb";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";

const STAMP = "2026-10-20T02:00:00.000Z";
const uid = (): string => crypto.randomUUID();

interface Fixture {
  db: SqlDatabase;
  materialId: string;
}

let nodeDb: TestDatabase | undefined;

afterEach(() => {
  nodeDb?.close();
  nodeDb = undefined;
});

async function nodeFixture(): Promise<Fixture> {
  nodeDb = await createNodeSqliteDatabase();
  const materialId = uid();
  await nodeDb.execute(
    "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [materialId, "Synthetic material", STAMP, STAMP],
  );
  return { db: nodeDb, materialId };
}

async function browserFixture(): Promise<Fixture> {
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        stored.set(key, value);
      },
    },
    configurable: true,
    writable: true,
  });
  const db = await createSqlJsDatabase();
  const materialId = uid();
  await db.execute(
    `INSERT INTO study_materials (id, title, material_type, topic, review_status, priority, created_at, updated_at)
     VALUES ('${materialId}', 'Synthetic material', 'study_guide', 'general', 'needs_review', 'later', '${STAMP}', '${STAMP}')`,
  );
  return { db, materialId };
}

const question = (over: Partial<PracticeAuthoringQuestion> = {}): PracticeAuthoringQuestion => ({
  question: "Synthetic stem",
  options: ["First", "Second"],
  correctIndex: 0,
  explanation: "Synthetic explanation",
  sourcePage: null,
  identity: uid(),
  ...over,
});

const nextOf = (
  questions: PracticeAuthoringQuestion[],
  retired: PracticeRetirementRecord[] = [],
  provider: PracticeNext["provider"] = "manual",
): PracticeNext => ({
  title: "Synthetic test",
  provider,
  model: provider === "manual" ? "" : "synthetic",
  questions,
  retired,
});

const save = (db: SqlDatabase, operation: PracticeSaveOperation) =>
  db.savePracticeAuthoringAtomically!(operation);

const snapshotOf = (fixture: Fixture) =>
  readCurrentSnapshot(async (sql, params) => fixture.db.select(sql, params), fixture.materialId);

const snapshotOfMaterial = (fixture: Fixture, materialId: string) =>
  readCurrentSnapshot(async (sql, params) => fixture.db.select(sql, params), materialId);

/** Another living material in the same database, for cross-material ownership. */
async function addMaterial(fixture: Fixture, title: string): Promise<string> {
  const materialId = uid();
  await fixture.db.execute(
    "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [materialId, title, STAMP, STAMP],
  );
  return materialId;
}

/** Seeds a stored version outside the authoring contract, as pre-03b rows look. */
async function seedStoredVersion(
  fixture: Fixture,
  materialId: string,
  versionId: string,
  itemId: string,
  logicalId: string | null,
): Promise<void> {
  await fixture.db.execute(
    `INSERT INTO practice_test_versions (
       id, source_material_id, history_key, source_material_title, version_number,
       provider, model, title, content_hash, created_at, is_active
     ) VALUES (?, ?, ?, 'Seeded version', 1, 'gemini', '', 'Seeded test', ?, ?, 1)`,
    [versionId, materialId, materialId, "0".repeat(64), STAMP],
  );
  await fixture.db.execute(
    `INSERT INTO practice_test_items (
       id, version_id, ordinal, question_text, options_json, correct_index, explanation,
       source_page, logical_id, replaces_id
     ) VALUES (?, ?, 0, 'Seeded stem', '["First","Second"]', 0, '', NULL, ?, NULL)`,
    [itemId, versionId, logicalId],
  );
}

async function count(db: SqlDatabase, table: string, where = "1=1"): Promise<number> {
  const [row] = await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, []);
  return Number(row?.["n"] ?? 0);
}

async function expectRefusal(action: Promise<unknown>, code: string): Promise<void> {
  const error = await action.then(() => null, (cause: unknown) => cause);
  expect(error, `expected ${code}`).toBeInstanceOf(PracticeAuthoringError);
  expect((error as PracticeAuthoringError).code).toBe(code);
}

describe("create, edit and read through the real transaction", () => {
  it("creates a first manual test as one version with mirror, receipt and no history", async () => {
    const fixture = await nodeFixture();
    const q = question();
    const result = await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([q]),
    });
    expect(result).toEqual({ status: "saved" });
    const current = await snapshotOf(fixture);
    expect(current).not.toBeNull();
    expect(current!.versionNumber).toBe(1);
    expect(current!.provider).toBe("manual");
    expect(current!.questions[0]!.identity).toBe(q.identity);
    expect(await count(fixture.db, "study_set_history", "kind = 'practice'")).toBe(0);
    expect(await count(fixture.db, "practice_save_operations")).toBe(1);

    const items = await practiceSessionRepository(fixture.db).getItems(current!.versionId);
    expect(items[0]).toMatchObject({ questionText: q.question, logicalId: q.identity });
    expect(items[0]!.origin).toBeUndefined();
  });

  it("runs the same contract identically on sql.js (browser parity)", async () => {
    const fixture = await browserFixture();
    const q = question({ origin: "user" });
    const saved = await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([q]),
    });
    expect(saved.status).toBe("saved");
    const current = (await snapshotOf(fixture))!;
    expect(current.questions[0]).toMatchObject({ identity: q.identity, origin: "user" });

    const changed = { ...q, question: "Changed synthetic stem" };
    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: fixture.materialId,
        reason: "edit",
        expected: current,
        next: nextOf([changed]),
      }),
      "INVALID_ARGUMENT",
    );

    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "edit",
      expected: current,
      next: nextOf([changed], [await practiceRetirementRecord(q, "corrected")]),
    });
    const after = (await snapshotOf(fixture))!;
    expect(after.versionNumber).toBe(2);
    expect(after.retired).toHaveLength(1);
    expect(await count(fixture.db, "study_set_history", "kind = 'practice'")).toBe(1);
  });

  it("a real-origin historical question reads back its origin, identity and replacement", async () => {
    const fixture = await nodeFixture();
    const original = question({ origin: "user" });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([original]),
    });
    const v1 = (await snapshotOf(fixture))!;
    const correction = question({
      question: "Instructor's corrected stem",
      origin: "instructor",
      replaces: original.identity,
    });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "correct",
      expected: v1,
      next: nextOf([correction], [await practiceRetirementRecord(original, "corrected")]),
    });

    const history = await documentRepository(fixture.db).listPracticeHistory(fixture.materialId);
    expect(history[0]!.reason).toBe("correct");
    expect(history[0]!.snapshot!.questions[0]!.origin).toBe("user");
    expect(history[0]!.snapshot!.questions[0]!.identity).toBe(original.identity);

    const repo = practiceSessionRepository(fixture.db);
    const oldItems = await repo.getItems(v1.versionId);
    expect(oldItems[0]!.origin).toBe("user");
    const newItems = await repo.getItems((await snapshotOf(fixture))!.versionId);
    expect(newItems[0]!.origin).toBe("instructor");
    expect(newItems[0]!.replaces).toBe(original.identity);
  });
});

describe("receipts, staleness and idempotence", () => {
  it("an exact retry commits once and stays already_saved even after later operations", async () => {
    const fixture = await nodeFixture();
    const operation: PracticeSaveOperation = {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([question()]),
    };
    await expect(save(fixture.db, operation)).resolves.toEqual({ status: "saved" });
    await expect(save(fixture.db, operation)).resolves.toEqual({ status: "already_saved" });
    expect(await count(fixture.db, "practice_test_versions")).toBe(1);
    expect(await count(fixture.db, "practice_save_operations")).toBe(1);

    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "regenerate",
      expected: (await snapshotOf(fixture))!,
      next: nextOf([question()], [], "gemini"),
    });
    expect(await count(fixture.db, "practice_test_versions")).toBe(2);

    await expect(save(fixture.db, operation)).resolves.toEqual({ status: "already_saved" });
    expect(await count(fixture.db, "practice_test_versions")).toBe(2);
    expect(await count(fixture.db, "practice_save_operations")).toBe(2);
  });

  it("a reused operation id with different content refuses as CONFLICT", async () => {
    const fixture = await nodeFixture();
    const operationId = uid();
    await save(fixture.db, {
      operationId,
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([question()]),
    });
    await expectRefusal(
      save(fixture.db, {
        operationId,
        sourceMaterialId: fixture.materialId,
        reason: "create",
        expected: null,
        next: nextOf([question({ question: "Different stem" })]),
      }),
      "CONFLICT",
    );
    expect(await count(fixture.db, "practice_test_versions")).toBe(1);
  });

  it("an expected snapshot that misses the stored state refuses as STALE_CONTENT without writes", async () => {
    const fixture = await nodeFixture();
    const q = question();
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([q]),
    });
    const stale: PracticeSnapshot = { ...(await snapshotOf(fixture))!, versionId: uid() };
    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: fixture.materialId,
        reason: "edit",
        expected: stale,
        next: nextOf([q]),
      }),
      "STALE_CONTENT",
    );
    expect(await count(fixture.db, "practice_test_versions")).toBe(1);
    expect(await count(fixture.db, "practice_save_operations")).toBe(1);
  });

  it("an injected failure mid-transaction rolls back receipt, history, version, items and origins", async () => {
    const fixture = await nodeFixture();
    const q = question({ origin: "user" });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([q]),
    });
    const before = {
      versions: await count(fixture.db, "practice_test_versions"),
      history: await count(fixture.db, "study_set_history", "kind = 'practice'"),
      receipts: await count(fixture.db, "practice_save_operations"),
      items: await count(fixture.db, "practice_test_items"),
    };
    let explode = true;
    nodeDb!.beforeStatement = async (sql) => {
      if (explode && sql.includes("INSERT INTO practice_item_origins")) {
        explode = false;
        throw new Error("injected mid-transaction failure");
      }
    };
    const changed = { ...q, question: "Changed synthetic stem" };
    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: fixture.materialId,
        reason: "edit",
        expected: (await snapshotOf(fixture))!,
        next: nextOf([changed], [await practiceRetirementRecord(q, "corrected")]),
      }),
      "STORAGE_ERROR",
    );
    nodeDb!.beforeStatement = undefined;
    expect({
      versions: await count(fixture.db, "practice_test_versions"),
      history: await count(fixture.db, "study_set_history", "kind = 'practice'"),
      receipts: await count(fixture.db, "practice_save_operations"),
      items: await count(fixture.db, "practice_test_items"),
    }).toEqual(before);
    const current = (await snapshotOf(fixture))!;
    expect(current.questions[0]!.question).toBe(q.question);
    expect(current.retired).toHaveLength(0);
  });
});

describe("retirement fingerprints, bounds and repetition", () => {
  it("accepts the generated->user promotion with the exact earlier-wording record", async () => {
    const fixture = await nodeFixture();
    const plain = question();
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([plain], [], "gemini"),
    });
    const promoted = { ...plain, question: "Her rewritten stem", origin: "user" as const };
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "edit",
      expected: (await snapshotOf(fixture))!,
      next: nextOf([promoted], [await practiceRetirementRecord(plain, "corrected")]),
    });
    const current = (await snapshotOf(fixture))!;
    expect(current.questions[0]!.origin).toBe("user");
    expect(current.retired).toHaveLength(1);
  });

  it("refuses a wrong earlier-wording digest and altered terms", async () => {
    const fixture = await nodeFixture();
    const q = question({ origin: "user" });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([q]),
    });
    const changed = { ...q, question: "Changed synthetic stem" };
    const correctRecord = await practiceRetirementRecord(q, "corrected");
    const wrongDigest = { ...correctRecord, textKey: "0".repeat(64) };
    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: fixture.materialId,
        reason: "edit",
        expected: (await snapshotOf(fixture))!,
        next: nextOf([changed], [wrongDigest]),
      }),
      "INVALID_ARGUMENT",
    );
    const alteredTerms = { ...correctRecord, terms: [...correctRecord.terms].reverse() };
    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: fixture.materialId,
        reason: "edit",
        expected: (await snapshotOf(fixture))!,
        next: nextOf([changed], [alteredTerms]),
      }),
      "INVALID_ARGUMENT",
    );
    expect(await count(fixture.db, "practice_test_versions")).toBe(1);
  });

  it("repeated edits of one identity cannot substitute an older record for the new wording", async () => {
    const fixture = await nodeFixture();
    const w1 = question({ origin: "user" });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([w1]),
    });
    const w2 = { ...w1, question: "Second wording" };
    const first = await practiceRetirementRecord(w1, "corrected");
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "edit",
      expected: (await snapshotOf(fixture))!,
      next: nextOf([w2], [first]),
    });
    const w3 = { ...w1, question: "Third wording" };
    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: fixture.materialId,
        reason: "edit",
        expected: (await snapshotOf(fixture))!,
        next: nextOf([w3], [first]),
      }),
      "INVALID_ARGUMENT",
    );
    const second = await practiceRetirementRecord(w2, "corrected");
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "edit",
      expected: (await snapshotOf(fixture))!,
      next: nextOf([w3], appendPracticeRetirements([first], [second])),
    });
    expect((await snapshotOf(fixture))!.retired).toHaveLength(2);
  });

  it("fills 1,999 to 2,000, and refuses growth to 2,001 before touching any table", async () => {
    const fixture = await nodeFixture();
    const kept = question();
    const doomed = question({ question: "Doomed stem" });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([kept, doomed]),
    });
    const filler = (index: number): PracticeRetirementRecord => ({
      kind: "question",
      itemId: uid(),
      reason: "deleted",
      textKey: index.toString(16).padStart(64, "0"),
      terms: [],
    });
    const many = Array.from({ length: 1999 }, (_, index) => filler(index));
    await fixture.db.execute("UPDATE practice_tests SET retired_json = ? WHERE source_material_id = ?", [
      JSON.stringify(many),
      fixture.materialId,
    ]);
    const current = (await snapshotOf(fixture))!;
    expect(current.retired).toHaveLength(1999);

    const deletion = await practiceRetirementRecord(doomed, "deleted");
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "edit",
      expected: current,
      next: nextOf([kept], appendPracticeRetirements(many, [deletion])),
    });
    const full = (await snapshotOf(fixture))!;
    expect(full.retired).toHaveLength(2000);

    const receiptsBefore = await count(fixture.db, "practice_save_operations");
    const versionsBefore = await count(fixture.db, "practice_test_versions");
    const extra = await practiceRetirementRecord({ ...kept, question: "Retyped stem" }, "corrected");
    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: fixture.materialId,
        reason: "edit",
        expected: full,
        next: nextOf([{ ...kept, question: "Retyped stem" }], [...full.retired, extra]),
      }),
      "RETIREMENT_LIMIT",
    );
    expect(await count(fixture.db, "practice_save_operations")).toBe(receiptsBefore);
    expect(await count(fixture.db, "practice_test_versions")).toBe(versionsBefore);
  });
});

describe("lineage laundering is refused on stored evidence, in every row order", () => {
  async function launderScenario(order: "instructor-high" | "instructor-low" | "backward-clock") {
    const fixture = await nodeFixture();
    const q = question({ origin: "user", question: "Synthetic user wording" });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([q]),
    });
    const userSnapshot = (await snapshotOf(fixture))!;
    const correction = { ...q, question: "Synthetic private instructor correction", origin: "instructor" as const };
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "correct",
      expected: userSnapshot,
      next: nextOf([correction], [await practiceRetirementRecord(q, "corrected")]),
    });
    const corrected = (await snapshotOf(fixture))!;
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "remove",
      expected: corrected,
      next: null,
    });

    const historyRows = await fixture.db.select<{ id: string; previous_json: string }>(
      "SELECT id, previous_json FROM study_set_history WHERE material_id = ? AND kind = 'practice'",
      [fixture.materialId],
    );
    expect(historyRows).toHaveLength(2);
    const originOfRow = (row: { previous_json: string }): string =>
      JSON.parse(row.previous_json).questions[0].origin as string;
    const userRow = historyRows.find((row) => originOfRow(row) === "user")!;
    const instructorRow = historyRows.find((row) => originOfRow(row) === "instructor")!;
    const HIGH = "ffffffff-ffff-4fff-bfff-ffffffffffff";
    const LOW = "00000000-0000-4000-8000-000000000001";
    if (order === "instructor-high") {
      await fixture.db.execute("UPDATE study_set_history SET id = ? WHERE id = ?", [HIGH, instructorRow.id]);
      await fixture.db.execute("UPDATE study_set_history SET id = ? WHERE id = ?", [LOW, userRow.id]);
    } else if (order === "instructor-low") {
      await fixture.db.execute("UPDATE study_set_history SET id = ? WHERE id = ?", [LOW, instructorRow.id]);
      await fixture.db.execute("UPDATE study_set_history SET id = ? WHERE id = ?", [HIGH, userRow.id]);
    } else {
      await fixture.db.execute("UPDATE study_set_history SET created_at = '2100-01-01T00:00:00.000Z' WHERE id = ?", [userRow.id]);
      await fixture.db.execute("UPDATE study_set_history SET created_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", [instructorRow.id]);
    }

    const laundered = { ...correction, origin: "user" as const };
    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: fixture.materialId,
        reason: "create",
        expected: null,
        next: nextOf([laundered]),
      }),
      "INVALID_ARGUMENT",
    );
    expect(await count(fixture.db, "practice_test_versions")).toBe(0);
    expect(await count(fixture.db, "practice_save_operations")).toBe(3);
    expect(await snapshotOf(fixture)).toBeNull();

    const faithful = { ...correction, origin: "instructor" as const };
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([faithful]),
    });
    expect((await snapshotOf(fixture))!.questions[0]!.origin).toBe("instructor");
  }

  it("tied timestamps, instructor sorts last", () => launderScenario("instructor-high"));
  it("tied timestamps, instructor sorts first", () => launderScenario("instructor-low"));
  it("backward wall clock between history rows", () => launderScenario("backward-clock"));

  it("replacement lineage of an instructor original stays instructor", async () => {
    const fixture = await nodeFixture();
    const original = question({ origin: "instructor" });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([original]),
    });
    const laundered = question({
      question: "Her reworded correction, relabelled",
      origin: "user" as const,
      replaces: original.identity,
    });
    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: fixture.materialId,
        reason: "correct",
        expected: (await snapshotOf(fixture))!,
        next: nextOf([laundered], [await practiceRetirementRecord(original, "corrected")]),
      }),
      "INVALID_ARGUMENT",
    );
    const honest = { ...laundered, origin: "instructor" as const };
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "correct",
      expected: (await snapshotOf(fixture))!,
      next: nextOf([honest], [await practiceRetirementRecord(original, "corrected")]),
    });
    expect((await snapshotOf(fixture))!.questions[0]).toMatchObject({
      origin: "instructor",
      replaces: original.identity,
    });
  });

  it("historical user content may be legitimately promoted on recreation", async () => {
    const fixture = await nodeFixture();
    const hers = question({ origin: "user" });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([hers]),
    });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "remove",
      expected: (await snapshotOf(fixture))!,
      next: null,
    });
    const promoted = { ...hers, origin: "instructor" as const };
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([promoted]),
    });
    expect((await snapshotOf(fixture))!.questions[0]!.origin).toBe("instructor");
  });

  it("a fabricated replacement lineage into nothing this material held is refused", async () => {
    const fixture = await nodeFixture();
    const q = question();
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([q], [], "gemini"),
    });
    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: fixture.materialId,
        reason: "correct",
        expected: (await snapshotOf(fixture))!,
        next: nextOf([question({ origin: "user" as const, replaces: uid() })], [await practiceRetirementRecord(q, "corrected")]),
      }),
      "INVALID_ARGUMENT",
    );
  });
});

describe("attempts and removal lifecycle", () => {
  it("manual editing refuses while an attempt is in progress; plain regeneration replaces and abandons", async () => {
    const fixture = await nodeFixture();
    const q = question();
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([q], [], "gemini"),
    });
    const sessions = practiceSessionRepository(fixture.db);
    const active = (await sessions.getActiveVersion(fixture.materialId))!;
    await sessions.saveSessionAction({
      action: "start_or_resume",
      operationId: uid(),
      materialId: fixture.materialId,
      versionId: active.version.id,
    });

    const edited = { ...q, question: "Edited while active" };
    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: fixture.materialId,
        reason: "edit",
        expected: (await snapshotOf(fixture))!,
        next: nextOf([edited], [await practiceRetirementRecord(q, "corrected")]),
      }),
      "ATTEMPT_ACTIVE",
    );

    const replacement = question({ question: "Freshly generated" });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "regenerate",
      expected: (await snapshotOf(fixture))!,
      next: nextOf([replacement], [], "gemini"),
    });
    const current = (await snapshotOf(fixture))!;
    expect(current.versionNumber).toBe(2);
    const [attempt] = await fixture.db.select<{ status: string }>(
      "SELECT status FROM practice_attempts WHERE source_material_id = ?",
      [fixture.materialId],
    );
    expect(attempt!.status).toBe("abandoned");
    expect(await count(fixture.db, "practice_test_versions", "is_active = 1")).toBe(1);
  });

  it("removal keeps the exact previous state in history, prunes as established, and is retry-safe", async () => {
    const fixture = await nodeFixture();
    const q = question();
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([q], [], "gemini"),
    });
    const sessions = practiceSessionRepository(fixture.db);
    const active = (await sessions.getActiveVersion(fixture.materialId))!;
    const started = await sessions.saveSessionAction({
      action: "start_or_resume",
      operationId: uid(),
      materialId: fixture.materialId,
      versionId: active.version.id,
    });
    if (!("attemptId" in started)) throw new Error("expected a started attempt state");
    await sessions.saveSessionAction({
      action: "complete_attempt",
      operationId: uid(),
      attemptId: started.attemptId,
      expectedRevision: 0,
    });

    const operation: PracticeSaveOperation = {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "remove",
      expected: (await snapshotOf(fixture))!,
      next: null,
    };
    await expect(save(fixture.db, operation)).resolves.toEqual({ status: "saved" });
    await expect(save(fixture.db, operation)).resolves.toEqual({ status: "already_saved" });

    expect(await snapshotOf(fixture)).toBeNull();
    expect(await count(fixture.db, "practice_tests", `source_material_id = '${fixture.materialId}'`)).toBe(0);
    expect(await count(fixture.db, "practice_attempts", "status = 'completed'")).toBe(1);
    expect(await count(fixture.db, "practice_test_versions", `source_material_id = '${fixture.materialId}'`)).toBe(1);

    const history = await documentRepository(fixture.db).listPracticeHistory(fixture.materialId);
    expect(history).toHaveLength(1);
    expect(history[0]!.reason).toBe("delete");
    expect(history[0]!.snapshot!.questions[0]!.question).toBe(q.question);
  });
});

describe("version numbering and ownership survive pruning", () => {
  it("version numbers keep rising across repeated remove and recreate", async () => {
    const fixture = await nodeFixture();
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([question()]),
    });
    expect((await snapshotOf(fixture))!.versionNumber).toBe(1);

    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "regenerate",
      expected: (await snapshotOf(fixture))!,
      next: nextOf([question()], [], "gemini"),
    });
    expect((await snapshotOf(fixture))!.versionNumber).toBe(2);

    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "remove",
      expected: (await snapshotOf(fixture))!,
      next: null,
    });
    expect(await snapshotOf(fixture)).toBeNull();
    expect(await count(fixture.db, "practice_test_versions", `source_material_id = '${fixture.materialId}'`)).toBe(0);

    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([question()]),
    });
    expect((await snapshotOf(fixture))!.versionNumber).toBe(3);

    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "remove",
      expected: (await snapshotOf(fixture))!,
      next: null,
    });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([question()]),
    });
    expect((await snapshotOf(fixture))!.versionNumber).toBe(4);
  });

  it("a completed-attempt survivor still counts toward the next version number", async () => {
    const fixture = await nodeFixture();
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([question()]),
    });
    const first = (await snapshotOf(fixture))!;

    const sessions = practiceSessionRepository(fixture.db);
    const active = (await sessions.getActiveVersion(fixture.materialId))!;
    const started = await sessions.saveSessionAction({
      action: "start_or_resume",
      operationId: uid(),
      materialId: fixture.materialId,
      versionId: active.version.id,
    });
    if (!("attemptId" in started)) throw new Error("expected a started attempt state");
    await sessions.saveSessionAction({
      action: "complete_attempt",
      operationId: uid(),
      attemptId: started.attemptId,
      expectedRevision: 0,
    });

    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "remove",
      expected: (await snapshotOf(fixture))!,
      next: null,
    });
    expect(await count(fixture.db, "practice_test_versions", `source_material_id = '${fixture.materialId}'`)).toBe(1);

    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([question()]),
    });
    expect((await snapshotOf(fixture))!.versionNumber).toBe(2);

    const [survivor] = await fixture.db.select<{ version_number: number }>(
      "SELECT version_number FROM practice_test_versions WHERE source_material_id = ? AND id = ?",
      [fixture.materialId, first.versionId],
    );
    expect(survivor!.version_number).toBe(1);
  });

  it("history-only ownership blocks another living material, with no partial writes", async () => {
    const fixture = await nodeFixture();
    const q = question({ origin: "instructor" });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([q]),
    });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "remove",
      expected: (await snapshotOf(fixture))!,
      next: null,
    });
    const b = await addMaterial(fixture, "Material B");

    const before = {
      tests: await count(fixture.db, "practice_tests"),
      versions: await count(fixture.db, "practice_test_versions"),
      items: await count(fixture.db, "practice_test_items"),
      history: await count(fixture.db, "study_set_history"),
      receipts: await count(fixture.db, "practice_save_operations"),
    };
    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: b,
        reason: "create",
        expected: null,
        next: nextOf([question({ identity: q.identity, origin: "user" })]),
      }),
      "INVALID_ARGUMENT",
    );
    expect({
      tests: await count(fixture.db, "practice_tests"),
      versions: await count(fixture.db, "practice_test_versions"),
      items: await count(fixture.db, "practice_test_items"),
      history: await count(fixture.db, "study_set_history"),
      receipts: await count(fixture.db, "practice_save_operations"),
    }).toEqual(before);
    expect(await snapshotOfMaterial(fixture, b)).toBeNull();

    // Positive control: once the owning material is genuinely gone, its
    // history rows prove nothing and another material may claim the identity.
    await fixture.db.execute("DELETE FROM study_materials WHERE id = ?", [fixture.materialId]);
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: b,
      reason: "create",
      expected: null,
      next: nextOf([question({ identity: q.identity, origin: "user" })]),
    });
    expect((await snapshotOfMaterial(fixture, b))!.questions[0]!.identity).toBe(q.identity);
  });

  it("a legacy row's own id is owned by its living material (fallback identity)", async () => {
    const fixture = await nodeFixture();
    const b = await addMaterial(fixture, "Material B");
    const legacyItem = uid();
    await seedStoredVersion(fixture, b, uid(), legacyItem, null);

    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: fixture.materialId,
        reason: "create",
        expected: null,
        next: nextOf([question({ identity: legacyItem })]),
      }),
      "INVALID_ARGUMENT",
    );

    // enforceStoredLineage runs before enforceForeignOwnership, so this
    // refusal is the unknown-`replaces`-target guard, not foreign ownership.
    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: fixture.materialId,
        reason: "create",
        expected: null,
        next: nextOf([question({ origin: "user", replaces: legacyItem })]),
      }),
      "INVALID_ARGUMENT",
    );
  });

  it("same-material recreate of a pruned identity stays allowed", async () => {
    const fixture = await nodeFixture();
    const q = question();
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([q]),
    });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "remove",
      expected: (await snapshotOf(fixture))!,
      next: null,
    });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([question({ identity: q.identity })]),
    });
    expect((await snapshotOf(fixture))!.versionNumber).toBe(2);
  });

  const nextFrom = (snapshot: PracticeSnapshot): PracticeNext => ({
    title: snapshot.title,
    provider: snapshot.provider,
    model: snapshot.model,
    questions: snapshot.questions,
    retired: snapshot.retired,
  });

  /** create(origin user) → edit with the exact retirement → remove: the reproduction flow. */
  async function removedEditedTest(fixture: Fixture): Promise<PracticeSnapshot> {
    const q = question({ origin: "user" });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([q]),
    });
    const first = (await snapshotOf(fixture))!;
    const changed = { ...q, question: "Corrected synthetic stem" };
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "edit",
      expected: first,
      next: nextOf([changed], [await practiceRetirementRecord(q, "corrected")]),
    });
    const selected = (await snapshotOf(fixture))!;
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "remove",
      expected: selected,
      next: null,
    });
    expect(await snapshotOf(fixture)).toBeNull();
    return selected;
  }

  it("restores a removed test with the selected snapshot's content, ledger and a higher version number", async () => {
    const fixture = await nodeFixture();
    const selected = await removedEditedTest(fixture);
    expect(selected.retired).toHaveLength(1);

    const operation: PracticeSaveOperation = {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "restore",
      expected: null,
      next: nextFrom(selected),
    };
    expect(await save(fixture.db, operation)).toEqual({ status: "saved" });
    const current = (await snapshotOf(fixture))!;
    expect(current.questions).toEqual(selected.questions);
    expect(current.retired).toContainEqual(selected.retired[0]);
    expect(current.versionNumber).toBeGreaterThan(selected.versionNumber);

    // The exact retry answers from the receipt without a second version.
    expect(await save(fixture.db, operation)).toEqual({ status: "already_saved" });
    expect((await snapshotOf(fixture))!.versionId).toBe(current.versionId);
  });

  it("restoring without a retirement the preserved history holds is refused with no new version", async () => {
    const fixture = await nodeFixture();
    const selected = await removedEditedTest(fixture);
    const versionsBefore = await count(
      fixture.db,
      "practice_test_versions",
      `source_material_id = '${fixture.materialId}'`,
    );

    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: fixture.materialId,
        reason: "restore",
        expected: null,
        next: { ...nextFrom(selected), retired: [] },
      }),
      "INVALID_ARGUMENT",
    );
    expect(
      await count(fixture.db, "practice_test_versions", `source_material_id = '${fixture.materialId}'`),
    ).toBe(versionsBefore);
    expect(await snapshotOf(fixture)).toBeNull();
  });

  it("restoring with no expected state while a current test exists is stale", async () => {
    const fixture = await nodeFixture();
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([question({ origin: "user" })]),
    });
    const selected = (await snapshotOf(fixture))!;
    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: fixture.materialId,
        reason: "restore",
        expected: null,
        next: nextFrom(selected),
      }),
      "STALE_CONTENT",
    );
  });

  it("restoring a removed instructor question relabelled as user is refused", async () => {
    const fixture = await nodeFixture();
    const q = question({ origin: "instructor" });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([q]),
    });
    const selected = (await snapshotOf(fixture))!;
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "remove",
      expected: selected,
      next: null,
    });

    const relabelled = selected.questions.map((item) => ({ ...item, origin: "user" as const }));
    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: fixture.materialId,
        reason: "restore",
        expected: null,
        next: { ...nextFrom(selected), questions: relabelled },
      }),
      "INVALID_ARGUMENT",
    );
    expect(await snapshotOf(fixture)).toBeNull();
  });
});

describe("pure contract guards and hash stability", () => {
  const snap = (q: PracticeAuthoringQuestion, retired: PracticeRetirementRecord[] = []): PracticeSnapshot => ({
    schemaVersion: 1,
    versionId: uid(),
    versionNumber: 1,
    title: "Synthetic test",
    provider: "gemini",
    model: "synthetic",
    savedAt: STAMP,
    questions: [q],
    retired,
  });
  const next = (questions: PracticeAuthoringQuestion[], retired: PracticeRetirementRecord[] = []): PracticeNext => ({
    title: "Synthetic test",
    provider: "gemini",
    model: "synthetic",
    questions,
    retired,
  });

  it("keeps the reviewer's transition and fingerprint rules at contract level", async () => {
    const plain = question();
    await expect(
      validateProtection(
        snap(plain),
        next([{ ...plain, question: "Changed", origin: "user" }], [await practiceRetirementRecord(plain, "corrected")]),
        "edit",
      ),
    ).resolves.toBeUndefined();

    const instructor = question({ origin: "instructor" });
    const laundered = question({ origin: "user", replaces: instructor.identity });
    await expect(
      validateProtection(snap(instructor), next([laundered], [await practiceRetirementRecord(instructor, "corrected")]), "correct"),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    const hers = question({ origin: "user" });
    const wrong = { ...(await practiceRetirementRecord(hers, "corrected")), textKey: "0".repeat(64) };
    await expect(
      validateProtection(snap(hers), next([{ ...hers, question: "Changed" }], [wrong]), "edit"),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    await expect(
      validateProtection(snap(hers), next([{ ...hers, origin: undefined }], []), "edit"),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("editor metadata never enters the content hash; origin does only when present", async () => {
    const fixture = await nodeFixture();
    async function newMaterial(title: string): Promise<string> {
      const materialId = uid();
      await fixture.db.execute("INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", [
        materialId,
        title,
        STAMP,
        STAMP,
      ]);
      return materialId;
    }

    /**
     * Hashes one question the way production does — by saving it as a material's
     * active version. One identity belongs to one material, so each save here
     * carries its own. With a `prior` question the save is a real replacement of
     * an identity that material owns: `lineage` names it in `replaces` as a
     * correction, otherwise the same wording is retired as deleted.
     */
    async function hashOf(
      q: PracticeAuthoringQuestion,
      prior?: { question: PracticeAuthoringQuestion; lineage: boolean },
    ): Promise<string> {
      const materialId = await newMaterial("Hash fixture");
      const stored: PracticeAuthoringQuestion = {
        question: q.question,
        options: [...q.options],
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        sourcePage: q.sourcePage,
        identity: uid(),
        ...(q.origin ? { origin: q.origin } : {}),
        ...(prior?.lineage ? { replaces: prior.question.identity } : {}),
      };
      let expected: PracticeSnapshot | null = null;
      if (prior) {
        await save(fixture.db, {
          operationId: uid(),
          sourceMaterialId: materialId,
          reason: "create",
          expected: null,
          next: { title: "t", provider: "gemini", model: "m", questions: [prior.question], retired: [] },
        });
        expected = await readCurrentSnapshot(async (sql, params) => fixture.db.select(sql, params), materialId);
      }
      const retired = prior
        ? [await practiceRetirementRecord(prior.question, prior.lineage ? "corrected" : "deleted")]
        : [];
      await save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: materialId,
        reason: prior ? "edit" : "create",
        expected,
        next: { title: "t", provider: "gemini", model: "m", questions: [stored], retired },
      });
      const [row] = await fixture.db.select<{ content_hash: string }>(
        "SELECT content_hash FROM practice_test_versions WHERE source_material_id = ? AND is_active = 1",
        [materialId],
      );
      return row!.content_hash;
    }
    const strip = (q: PracticeAuthoringQuestion): PracticeAuthoringQuestion => ({
      question: q.question,
      options: [...q.options],
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      sourcePage: q.sourcePage,
      identity: q.identity,
    });
    const a = question();
    const base = await hashOf(a);
    expect(await hashOf({ ...a, identity: uid() })).toBe(base);
    expect(await hashOf(strip(a))).toBe(base);
    expect(await hashOf({ ...a, origin: "user" })).not.toBe(base);
    const withLineage = await hashOf({ ...a, origin: "user" }, { question: question(), lineage: true });
    expect(withLineage).toBe(await hashOf({ ...a, origin: "user" }, { question: question(), lineage: false }));
    expect(await hashOf({ ...a, origin: "instructor" }, { question: question(), lineage: true })).not.toBe(withLineage);
    expect(withLineage).not.toBe(base);

    // The guard stays strict: a `replaces` naming no identity this material ever
    // held is refused outright, exactly as the lineage test above proves.
    const stranger = await newMaterial("Fabricated target");
    await expectRefusal(
      save(fixture.db, {
        operationId: uid(),
        sourceMaterialId: stranger,
        reason: "create",
        expected: null,
        next: {
          title: "t",
          provider: "gemini",
          model: "m",
          questions: [question({ origin: "user" as const, replaces: uid() })],
          retired: [],
        },
      }),
      "INVALID_ARGUMENT",
    );
  });

  it("a stored question's hash matches the shared canonical projection", async () => {
    const fixture = await nodeFixture();
    const q = question({ origin: "instructor" });
    await save(fixture.db, {
      operationId: uid(),
      sourceMaterialId: fixture.materialId,
      reason: "create",
      expected: null,
      next: nextOf([q]),
    });
    const [row] = await fixture.db.select<{ content_hash: string }>("SELECT content_hash FROM practice_test_versions");
    expect(row!.content_hash).toBe(await practiceContentHash([q]));
    expect(await practiceContentHash([{ ...q, origin: undefined }])).not.toBe(await practiceContentHash([q]));
  });
});
