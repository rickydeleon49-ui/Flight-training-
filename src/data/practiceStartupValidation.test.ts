/**
 * M2 PR 1 R3 (initialization re-review, 4 October): browser and test-driver
 * initialization validates practice state before an adapter exists.
 *
 * Real engines only: sql.js with its WASM (URL mocked to the installed test
 * asset) over an in-memory localStorage map, and node:sqlite on disposable
 * temporary files. Never the user's browser store, profile or app data.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import initSqlJs, { type BindParams, type Database as SqlJsHandle } from "sql.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlDatabase } from "./db";
import { applyMigrations } from "./migrations";
import { DatabaseDisabledError, StorageDurabilityError } from "./persistenceErrors";
import { readCurrentSnapshot } from "./practiceAuthoring";
import {
  PracticeStateValidationError,
  validatePracticeAuthoringState,
  validatePracticeState,
} from "./practiceStateValidation";
import { canonicalJson, sha256Hex } from "@/logic/cardIdentity";
import { practiceSessionRepository } from "./repositories/practiceSessionRepository";
import { createSqlJsDatabase } from "./sqlJsDb";
import { seedPracticeTest } from "./testing/practiceTestFixtures";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";

const WASM = `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

const STORAGE_KEY = "her-flight-deck.dev-database";
const CONTRACT: {
  baseline: string[];
  cases: { name: string; category: string; sql: string[]; expect: "accept" | "refuse" }[];
} = JSON.parse(readFileSync(`${process.cwd()}/src-tauri/fixtures/practice-validation/cases.json`, "utf8"));

const LEGACY_QUESTIONS = JSON.stringify([
  { question: "Synthetic legacy", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null },
]);

let stored: Map<string, string>;
let storageFails: boolean;

beforeEach(() => {
  stored = new Map();
  storageFails = false;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (storageFails) throw new Error("synthetic quota failure");
      stored.set(key, value);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const sqlJs = () => initSqlJs({ locateFile: () => WASM });

function rows(handle: SqlJsHandle, sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const statement = handle.prepare(sql);
  try {
    statement.bind(params as BindParams);
    const out: Record<string, unknown>[] = [];
    while (statement.step()) out.push(statement.getAsObject());
    return out;
  } finally {
    statement.free();
  }
}

/** The database currently in (fake) localStorage, opened read-only for assertions. */
async function storedDatabase(): Promise<SqlJsHandle> {
  const SQL = await sqlJs();
  const binary = atob(stored.get(STORAGE_KEY)!);
  return new SQL.Database(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** Rewrite the stored bytes directly, as a repair outside the app would. */
async function editStored(sql: string): Promise<void> {
  const handle = await storedDatabase();
  handle.run(sql);
  const bytes = handle.export();
  handle.close();
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  stored.set(STORAGE_KEY, btoa(binary));
}

/** One material, one saved test, one unfinished attempt with one answer. */
async function seedSession(db: SqlDatabase) {
  await db.execute(
    "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('mat', 'Synthetic', '2026-10-04', '2026-10-04')",
  );
  await seedPracticeTest(db, {
    sourceMaterialId: "mat",
    title: "Synthetic",
    questions: [{ question: "Synthetic", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null }],
    model: "synthetic",
  });
  const repo = practiceSessionRepository(db);
  const active = (await repo.getActiveVersion("mat"))!;
  const started = await repo.saveSessionAction({
    action: "start_or_resume",
    operationId: crypto.randomUUID(),
    materialId: "mat",
    versionId: active.version.id,
  });
  await repo.saveSessionAction({
    action: "record_response",
    operationId: crypto.randomUUID(),
    attemptId: started.attemptId,
    itemId: active.items[0]!.id,
    expectedRevision: 0,
    selectedIndex: 1,
    isDontKnow: false,
  });
  return { repo, versionId: active.version.id, attemptId: started.attemptId };
}

const legacyRow = (id: string) =>
  `INSERT INTO practice_tests (source_material_id, title, questions_json, provider, model, generated_at, updated_at)
   VALUES ('${id}', 'Legacy synthetic', '${LEGACY_QUESTIONS}', 'gemini', 'synthetic', '2026-10-04', '2026-10-04')`;

/* ------------------------- shared contract ------------------------- */

describe("shared validation contract on the real sql.js engine", () => {
  it("matches every native accept/refuse outcome", async () => {
    const SQL = await sqlJs();
    const reference = new SQL.Database();
    await applyMigrations((sql) => reference.run(sql), new Set());
    const mismatches: string[] = [];
    for (const testCase of CONTRACT.cases) {
      const build = new SQL.Database();
      build.run("PRAGMA foreign_keys = ON");
      await applyMigrations((sql) => build.run(sql), new Set());
      for (const statement of [...CONTRACT.baseline, ...testCase.sql]) build.run(statement);
      // Reopen from bytes so schema edits are what the validator reads.
      const reopened = new SQL.Database(build.export());
      build.close();
      const outcome = await validatePracticeState(
        (sql, params) => rows(reopened, sql, params),
        (sql, params) => rows(reference, sql, params),
      ).then(
        () => "accept",
        (error: unknown) => {
          expect(error).toBeInstanceOf(PracticeStateValidationError);
          return "refuse";
        },
      );
      reopened.close();
      if (outcome !== testCase.expect) mismatches.push(`${testCase.name}: expected ${testCase.expect}, got ${outcome}`);
    }
    reference.close();
    expect(mismatches).toEqual([]);
    expect(CONTRACT.cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(CONTRACT.cases.map((c) => c.category))).toEqual(
      new Set([
        "control",
        "schema",
        "schema-fk",
        "schema-check",
        "schema-index",
        "schema-trigger",
        "relations",
        "items",
        "ownership",
        "responses",
        "unfinished",
        "completed",
        "receipts",
      ]),
    );
  });
});

/* ------------------------- actual sql.js startup ------------------------- */

describe("sql.js initialization", () => {
  it("valid reopen control: a saved session reopens with a usable adapter", async () => {
    const { attemptId } = await seedSession(await createSqlJsDatabase());
    const reopened = await createSqlJsDatabase();
    const attempt = await practiceSessionRepository(reopened).getAttempt(attemptId);
    expect(attempt).toMatchObject({ status: "in_progress", totalQuestions: 1, answeredCount: 1 });
  });

  it("promoted browser-startup regression: reopen refuses persisted 99 total / 88 answered", async () => {
    const db = await createSqlJsDatabase();
    await seedSession(db);
    await db.execute("UPDATE practice_attempts SET total_questions = 99, answered_count = 88");
    const before = stored.get(STORAGE_KEY);
    await expect(createSqlJsDatabase()).rejects.toBeInstanceOf(PracticeStateValidationError);
    // Refusal never rewrites the previous durable bytes; a retry refuses again.
    expect(stored.get(STORAGE_KEY)).toBe(before);
    await expect(createSqlJsDatabase()).rejects.toBeInstanceOf(PracticeStateValidationError);
    expect(stored.get(STORAGE_KEY)).toBe(before);
  });

  it("refuses a stored database whose schema lost a foreign key definition", async () => {
    await seedSession(await createSqlJsDatabase());
    const handle = await storedDatabase();
    handle.run("PRAGMA writable_schema = ON");
    handle.run(
      "UPDATE sqlite_master SET sql = replace(sql, ' REFERENCES study_materials(id) ON DELETE SET NULL', '') WHERE name = 'practice_test_versions'",
    );
    handle.run("PRAGMA writable_schema = OFF");
    const bytes = handle.export();
    handle.close();
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    stored.set(STORAGE_KEY, btoa(binary));
    await expect(createSqlJsDatabase()).rejects.toThrow("foreign keys do not match");
  });

  it("conversion plus validation is atomic: a failure stores nothing, and a repaired retry converts once", async () => {
    const db = await createSqlJsDatabase();
    await seedSession(db);
    await db.execute("UPDATE practice_responses SET selected_index = 99");
    await db.execute(
      "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('legacy', 'Legacy synthetic', '2026-10-04', '2026-10-04')",
    );
    await db.execute(legacyRow("legacy"));
    const before = stored.get(STORAGE_KEY);

    await expect(createSqlJsDatabase()).rejects.toBeInstanceOf(PracticeStateValidationError);
    expect(stored.get(STORAGE_KEY)).toBe(before);
    const unchanged = await storedDatabase();
    expect(rows(unchanged, "SELECT COUNT(*) AS n FROM practice_test_versions WHERE source_material_id = 'legacy'")).toEqual([
      { n: 0 },
    ]);
    expect(rows(unchanged, "SELECT legacy_migrated_at FROM practice_tests WHERE source_material_id = 'legacy'")).toEqual([
      { legacy_migrated_at: null },
    ]);
    unchanged.close();

    await editStored("UPDATE practice_responses SET selected_index = 1");
    const retried = await createSqlJsDatabase();
    const converted = await retried.select<{ id: string }>(
      "SELECT id FROM practice_test_versions WHERE source_material_id = 'legacy'",
    );
    expect(converted).toHaveLength(1);
    const again = await createSqlJsDatabase();
    expect(await again.select("SELECT id FROM practice_test_versions WHERE source_material_id = 'legacy'")).toEqual(converted);
  });

  it("storage refusing the prepared database fails startup, keeps the previous bytes, and a retry converts once", async () => {
    const db = await createSqlJsDatabase();
    await db.execute(
      "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('legacy', 'Legacy synthetic', '2026-10-04', '2026-10-04')",
    );
    await db.execute(legacyRow("legacy"));
    const before = stored.get(STORAGE_KEY);

    storageFails = true;
    await expect(createSqlJsDatabase()).rejects.toBeInstanceOf(StorageDurabilityError);
    expect(stored.get(STORAGE_KEY)).toBe(before);

    storageFails = false;
    const retried = await createSqlJsDatabase();
    expect(await retried.select("SELECT COUNT(*) AS n FROM practice_test_versions")).toEqual([{ n: 1 }]);
    const reopened = await createSqlJsDatabase();
    expect(await reopened.select("SELECT COUNT(*) AS n FROM practice_test_versions")).toEqual([{ n: 1 }]);
    expect(
      await reopened.select<{ marked: number }>(
        "SELECT legacy_migrated_at IS NOT NULL AS marked FROM practice_tests WHERE source_material_id = 'legacy'",
      ),
    ).toEqual([{ marked: 1 }]);
  });

  it("an unchanged database reopens without needing to store again", async () => {
    await seedSession(await createSqlJsDatabase());
    storageFails = true;
    await expect(createSqlJsDatabase()).resolves.toBeDefined();
  });

  it("a practice write whose recovery fails disables the adapter", async () => {
    const SQL = await sqlJs();
    const db = await createSqlJsDatabase();
    const { repo, attemptId } = await seedSession(db);
    vi.spyOn(SQL.Database.prototype, "export").mockImplementationOnce(() => {
      throw new Error("synthetic export failure");
    });
    const originalExec = SQL.Database.prototype.exec;
    vi.spyOn(SQL.Database.prototype, "exec").mockImplementation(function (
      this: InstanceType<typeof SQL.Database>,
      sql: string,
      params?: BindParams,
    ) {
      if (/^\s*PRAGMA foreign_keys\s*;?\s*$/i.test(sql)) return [{ columns: ["foreign_keys"], values: [[0]] }];
      return originalExec.call(this, sql, params);
    });
    const complete = {
      action: "complete_attempt" as const,
      operationId: crypto.randomUUID(),
      attemptId,
      expectedRevision: 1,
    };
    await expect(repo.saveSessionAction(complete)).rejects.toBeInstanceOf(DatabaseDisabledError);
    await expect(repo.saveSessionAction(complete)).rejects.toBeInstanceOf(DatabaseDisabledError);
    await expect(db.select("SELECT 1")).rejects.toBeInstanceOf(DatabaseDisabledError);
    vi.restoreAllMocks();
    const attempt = await practiceSessionRepository(await createSqlJsDatabase()).getAttempt(attemptId);
    expect(attempt).toMatchObject({ status: "in_progress", revision: 1 });
  });
});

/* ------------------------- node:sqlite test driver ------------------------- */

describe("node:sqlite test driver initialization", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "hfd-practice-startup-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function raw(path: string) {
    const nativeSqlite = "node:sqlite";
    const { DatabaseSync } = await import(/* @vite-ignore */ nativeSqlite);
    return new DatabaseSync(path);
  }

  it("refuses persisted false progress, and a valid file reopens", async () => {
    const path = join(dir, "valid.db");
    const first = await createNodeSqliteDatabase(path);
    const { attemptId } = await seedSession(first);
    first.close();
    const reopened = await createNodeSqliteDatabase(path);
    expect(await practiceSessionRepository(reopened).getAttempt(attemptId)).toMatchObject({ answeredCount: 1 });
    await reopened.execute("UPDATE practice_attempts SET total_questions = 99, answered_count = 88");
    reopened.close();
    await expect(createNodeSqliteDatabase(path)).rejects.toBeInstanceOf(PracticeStateValidationError);
  });

  it("rolls back conversion when validation fails, then a repaired retry converts once", async () => {
    const path = join(dir, "rollback.db");
    const first = await createNodeSqliteDatabase(path);
    await seedSession(first);
    await first.execute("UPDATE practice_responses SET selected_index = 99");
    await first.execute(
      "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('legacy', 'Legacy synthetic', '2026-10-04', '2026-10-04')",
    );
    await first.execute(legacyRow("legacy"));
    first.close();

    await expect(createNodeSqliteDatabase(path)).rejects.toBeInstanceOf(PracticeStateValidationError);
    const check = await raw(path);
    expect(check.prepare("SELECT COUNT(*) AS n FROM practice_test_versions WHERE source_material_id = 'legacy'").get()).toEqual({
      n: 0,
    });
    expect(check.prepare("SELECT legacy_migrated_at FROM practice_tests WHERE source_material_id = 'legacy'").get()).toEqual({
      legacy_migrated_at: null,
    });
    check.exec("UPDATE practice_responses SET selected_index = 1");
    check.close();

    const retried = await createNodeSqliteDatabase(path);
    const converted = await retried.select("SELECT id FROM practice_test_versions WHERE source_material_id = 'legacy'");
    expect(converted).toHaveLength(1);
    retried.close();
    const again = await createNodeSqliteDatabase(path);
    expect(await again.select("SELECT id FROM practice_test_versions WHERE source_material_id = 'legacy'")).toEqual(converted);
    again.close();
  });
});

/* ---------------- schema-17 receipts: the validator decodes the whole operation ---------------- */

describe("authoring receipt validation decodes the whole operation", () => {
  const stamp = "2026-10-20T04:00:00.000Z";
  let opened: TestDatabase[];

  beforeEach(() => {
    opened = [];
  });
  afterEach(() => {
    for (const db of opened) db.close();
  });

  /** A data database with one material, plus a pristine twin as the schema reference. */
  async function pair(): Promise<{ db: TestDatabase; reference: TestDatabase; materialId: string }> {
    const db = await createNodeSqliteDatabase();
    const reference = await createNodeSqliteDatabase();
    opened.push(db, reference);
    const materialId = crypto.randomUUID();
    await db.execute(
      "INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [materialId, "Synthetic material", stamp, stamp],
    );
    return { db, reference, materialId };
  }

  function validate(db: TestDatabase, reference: TestDatabase): Promise<void> {
    return validatePracticeAuthoringState(
      (sql, params) => db.select(sql, params),
      (sql, params) => reference.select(sql, params),
    );
  }

  function createOperation(materialId: string) {
    return {
      operationId: crypto.randomUUID(),
      sourceMaterialId: materialId,
      reason: "create" as const,
      expected: null,
      next: {
        title: "Synthetic test",
        provider: "manual" as const,
        model: "",
        questions: [
          {
            question: "Synthetic stem",
            options: ["First", "Second"],
            correctIndex: 0,
            explanation: "Synthetic explanation",
            sourcePage: null,
            identity: crypto.randomUUID(),
          },
        ],
        retired: [],
      },
    };
  }

  /** Rewrite one receipt's payload with a recomputed digest, as an outside repair would. */
  async function tamperReceipt(db: TestDatabase, payload: string): Promise<void> {
    await db.execute("UPDATE practice_save_operations SET payload_json = ?, payload_hash = ?", [
      payload,
      await sha256Hex(payload),
    ]);
  }

  it("accepts a real receipt holding its complete canonical operation", async () => {
    const { db, reference, materialId } = await pair();
    expect(await db.savePracticeAuthoringAtomically!(createOperation(materialId))).toEqual({ status: "saved" });
    await expect(validate(db, reference)).resolves.toBeUndefined();
  });

  it("refuses a receipt whose payload drops operationId, expected and next, even with a recomputed digest", async () => {
    const { db, reference, materialId } = await pair();
    await db.savePracticeAuthoringAtomically!(createOperation(materialId));
    await tamperReceipt(db, JSON.stringify({ reason: "create", sourceMaterialId: materialId }));
    const error = await validate(db, reference).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(PracticeStateValidationError);
    expect((error as Error).message).toBe("A practice save receipt does not hold a complete authoring operation.");
  });

  it("refuses a complete receipt payload naming a different operation id than its row key, with the digest recomputed", async () => {
    const { db, reference, materialId } = await pair();
    await db.savePracticeAuthoringAtomically!(createOperation(materialId));
    const [row] = await db.select<{ payload_json: string }>("SELECT payload_json FROM practice_save_operations");
    const payload = JSON.parse(row!.payload_json) as Record<string, unknown>;
    payload["operationId"] = crypto.randomUUID();
    await tamperReceipt(db, canonicalJson(payload));
    const error = await validate(db, reference).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(PracticeStateValidationError);
    expect((error as Error).message).toBe("A practice save receipt does not bind its operation id to its row key.");
  });

  it("accepts a real receipt whose result version was later pruned by remove", async () => {
    const { db, reference, materialId } = await pair();
    await db.savePracticeAuthoringAtomically!(createOperation(materialId));
    const current = await readCurrentSnapshot((sql, params) => db.select(sql, params), materialId);
    expect(current).not.toBeNull();
    expect(await db.savePracticeAuthoringAtomically!({
      operationId: crypto.randomUUID(),
      sourceMaterialId: materialId,
      reason: "remove",
      expected: current,
      next: null,
    })).toEqual({ status: "saved" });
    // The receipt survives precisely because a receipt never requires its
    // version row to exist: the prune leaves the create receipt's versionId
    // naming a gone version, and that stays valid.
    expect(await db.select("SELECT id FROM practice_test_versions WHERE source_material_id = ?", [materialId])).toEqual([]);
    await expect(validate(db, reference)).resolves.toBeUndefined();
  });
});
