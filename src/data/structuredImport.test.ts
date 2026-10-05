/**
 * Slice B browser and test persistence for structured study import, against
 * the real engines: sql.js (WebAssembly, plain-browser development) and
 * node:sqlite (tests). Test names carry the accepted acceptance-row IDs
 * (docs/STRUCTURED_STUDY_IMPORT_SLICE_B_PREPARATION_2026-10-03.md §5).
 */
import { readFileSync } from "node:fs";
import initSqlJs, { type BindParams } from "sql.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validatePacketText } from "@/logic/studyPacket";
import { buildImportOperation } from "@/services/studyPackets";

import type { DebriefSaveOperation, SqlDatabase, StructuredImportSaveOperation } from "./db";
import { DatabaseDisabledError, IMPORT_SAVE_MESSAGES, StorageDurabilityError, StructuredImportSaveError } from "./persistenceErrors";
import { createSqlJsDatabase, initializeConnection } from "./sqlJsDb";
import { decodeStructuredImport } from "./structuredImportTransaction";
import { createNodeSqliteDatabase } from "./testing/nodeSqliteDb";

const WASM = `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

const CONTRACT = new URL("../../src-tauri/fixtures/import-contract/", import.meta.url);
const BASE: StructuredImportSaveOperation = JSON.parse(readFileSync(new URL("operation.json", CONTRACT), "utf8"));
const CASES = JSON.parse(readFileSync(new URL("cases.json", CONTRACT), "utf8")).cases as Array<{
  name: string;
  patches: Array<{ pointer: string; value?: unknown; delete?: true; repeat?: string; count?: number }>;
  expected: string;
}>;
const STORAGE_KEY = "her-flight-deck.dev-database";

let stored: Map<string, string>;
let storageFails: boolean;
let setItemCalls: number;

beforeEach(() => {
  stored = new Map();
  storageFails = false;
  setItemCalls = 0;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      setItemCalls++;
      if (storageFails) throw new DOMException("synthetic quota failure", "QuotaExceededError");
      stored.set(key, value);
    },
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The base operation under another (valid v4) id. */
function withId(id: string): StructuredImportSaveOperation {
  return { ...structuredClone(BASE), operationId: id, materialId: id };
}

function patched(patches: (typeof CASES)[number]["patches"]): unknown {
  let op: unknown = structuredClone(BASE);
  for (const patch of patches) {
    const value = patch.repeat !== undefined ? patch.repeat.repeat(patch.count!) : patch.value;
    if (patch.pointer === "") {
      op = value;
      continue;
    }
    const parts = patch.pointer.split("/").slice(1);
    const key = parts.pop()!;
    let target = op as Record<string, unknown>;
    for (const part of parts) target = target[part] as Record<string, unknown>;
    if (patch.delete) delete target[key];
    else target[key] = value;
  }
  return op;
}

async function counts(db: SqlDatabase) {
  const one = async (table: string) =>
    Number((await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))[0]!.n);
  return [await one("study_materials"), await one("ai_study_sets"), await one("practice_tests")];
}

async function everything(db: SqlDatabase) {
  return {
    materials: await db.select("SELECT * FROM study_materials ORDER BY id"),
    sets: await db.select("SELECT * FROM ai_study_sets ORDER BY source_material_id"),
    tests: await db.select("SELECT * FROM practice_tests ORDER BY source_material_id"),
  };
}

async function sqlJs() {
  const SQL = await initSqlJs({ locateFile: () => WASM });
  return { SQL, db: await createSqlJsDatabase() };
}

/** Make the next sql.js statement containing `marker` throw. */
function failStatement(SQL: Awaited<ReturnType<typeof initSqlJs>>, marker: string) {
  const original = SQL.Database.prototype.run;
  let fired = false;
  vi.spyOn(SQL.Database.prototype, "run").mockImplementation(function (
    this: InstanceType<typeof SQL.Database>,
    sql: string,
    params?: BindParams,
  ) {
    if (!fired && sql.includes(marker)) {
      fired = true;
      throw new Error("synthetic statement failure");
    }
    return original.call(this, sql, params);
  });
}

const PRIOR = `INSERT INTO study_materials (id, title, material_type, topic, created_at, updated_at)
  VALUES ('prior-material', 'Synthetic prior material', 'reference', 'weather', 't', 't')`;

/* --------------------------- shared contract --------------------------- */

describe("shared save contract (replayed by the native tests too)", () => {
  it("operation.json is exactly what the validator and buildImportOperation produce for fixture 02", async () => {
    const text = readFileSync(
      new URL("../testing/fixtures/study-packets/02-flashcards-and-test.json", import.meta.url),
      "utf8",
    );
    const result = validatePacketText(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await buildImportOperation(result.payload, BASE.materialId)).toEqual(BASE);
  });

  it("covers the 49 shared cases", () => {
    expect(CASES).toHaveLength(49);
  });

  it.each(CASES.map((c) => [c.name, c] as const))("%s", async (_name, testCase) => {
    const db = await createNodeSqliteDatabase();
    let outcome: string;
    try {
      const result = await db.saveStructuredImportAtomically!(patched(testCase.patches) as StructuredImportSaveOperation);
      outcome = result.status;
    } catch (error) {
      expect(error).toBeInstanceOf(StructuredImportSaveError);
      const { code, message } = error as StructuredImportSaveError;
      expect(message).toBe(IMPORT_SAVE_MESSAGES[code]);
      expect(message).not.toMatch(/apiKey_secret|extraField|sensitive/);
      expect(await counts(db)).toEqual([0, 0, 0]);
      outcome = code;
    }
    expect(outcome).toBe(testCase.expected);
    db.close();
  });

  it("decoding happens before any database access", () => {
    expect(() => decodeStructuredImport({ ...BASE, extra: 1 })).toThrow(StructuredImportSaveError);
    expect(decodeStructuredImport(BASE).materialId).toBe(BASE.materialId);
  });
});

/* -------------------------- sql.js persistence -------------------------- */

describe("sql.js structured import", () => {
  it("TB-ATOM-02: commits all three rows together and stores them", async () => {
    const { db } = await sqlJs();
    const before = stored.get(STORAGE_KEY);
    expect(await db.saveStructuredImportAtomically!(BASE)).toEqual({ status: "saved", materialId: BASE.materialId });
    expect(await counts(db)).toEqual([1, 1, 1]);
    expect(stored.get(STORAGE_KEY)).not.toBe(before);
    const reopened = await createSqlJsDatabase();
    expect(await counts(reopened)).toEqual([1, 1, 1]);
    const [set] = await reopened.select<{ provider: string; model: string }>("SELECT provider, model FROM ai_study_sets");
    expect(set).toEqual({ provider: "import", model: "" });
  });

  it.each([
    ["TB-ROLL-05", "INSERT INTO study_materials"],
    ["TB-ROLL-06", "INSERT INTO ai_study_sets"],
    ["TB-ROLL-03", "INSERT INTO practice_tests"],
  ])("%s: a failing %s statement rolls back every row and stores nothing", async (_id, marker) => {
    const { SQL, db } = await sqlJs();
    await db.execute(PRIOR);
    const prior = await everything(db);
    const storedBefore = stored.get(STORAGE_KEY);
    failStatement(SQL, marker);
    const error = await db.saveStructuredImportAtomically!(BASE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StructuredImportSaveError);
    expect((error as StructuredImportSaveError).code).toBe("STORAGE_FAILURE");
    expect((error as Error).message).not.toContain("synthetic");
    vi.restoreAllMocks();
    expect(await everything(db)).toEqual(prior);
    expect(stored.get(STORAGE_KEY)).toBe(storedBefore);
    expect(await everything(await createSqlJsDatabase())).toEqual(prior);
  });

  it("TB-DUR-01 / TB-SQLJS-04: refused storage restores the snapshot; prior rows and stored bytes are untouched", async () => {
    const { db } = await sqlJs();
    await db.execute(PRIOR);
    const prior = await everything(db);
    const storedBefore = stored.get(STORAGE_KEY)!;
    storageFails = true;
    const error = await db.saveStructuredImportAtomically!(BASE).catch((e: unknown) => e);
    storageFails = false;
    expect(error).toBeInstanceOf(StorageDurabilityError);
    expect((error as Error).cause).toBeInstanceOf(StorageDurabilityError);
    expect(await everything(db)).toEqual(prior);
    expect(stored.get(STORAGE_KEY)).toBe(storedBefore);
    expect(stored.get(STORAGE_KEY)!.length).toBe(storedBefore.length);
    expect(await everything(await createSqlJsDatabase())).toEqual(prior);
  });

  it("TB-DUR-02: an export failure after the commit restores the snapshot", async () => {
    const { SQL, db } = await sqlJs();
    await db.execute(PRIOR);
    const prior = await everything(db);
    const storedBefore = stored.get(STORAGE_KEY);
    vi.spyOn(SQL.Database.prototype, "export").mockImplementationOnce(() => {
      throw new Error("synthetic out of memory");
    });
    const error = await db.saveStructuredImportAtomically!(BASE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageDurabilityError);
    expect(await everything(db)).toEqual(prior);
    expect(stored.get(STORAGE_KEY)).toBe(storedBefore);
  });

  it("TB-DUR-03 / TB-SQLJS-06: when recovery cannot re-establish foreign keys the adapter is disabled", async () => {
    const { SQL, db } = await sqlJs();
    await db.execute(PRIOR);
    const prior = await everything(db);
    vi.spyOn(SQL.Database.prototype, "export").mockImplementationOnce(() => {
      throw new Error("synthetic export failure");
    });
    // The verification read reports foreign keys off on every handle from now on.
    const originalExec = SQL.Database.prototype.exec;
    vi.spyOn(SQL.Database.prototype, "exec").mockImplementation(function (
      this: InstanceType<typeof SQL.Database>,
      sql: string,
      params?: BindParams,
    ) {
      if (/^\s*PRAGMA foreign_keys\s*;?\s*$/i.test(sql)) return [{ columns: ["foreign_keys"], values: [[0]] }];
      return originalExec.call(this, sql, params);
    });
    await expect(db.saveStructuredImportAtomically!(BASE)).rejects.toBeInstanceOf(DatabaseDisabledError);
    await expect(db.select("SELECT 1")).rejects.toBeInstanceOf(DatabaseDisabledError);
    await expect(db.execute("DELETE FROM study_materials")).rejects.toBeInstanceOf(DatabaseDisabledError);
    await expect(db.saveStructuredImportAtomically!(BASE)).rejects.toBeInstanceOf(DatabaseDisabledError);
    vi.restoreAllMocks();
    expect(await everything(await createSqlJsDatabase())).toEqual(prior);
  });

  it("TB-SQLJS-06: opening refuses a connection whose foreign keys cannot be verified", async () => {
    const { SQL } = await sqlJs();
    vi.spyOn(SQL.Database.prototype, "exec").mockImplementation(() => [{ columns: ["foreign_keys"], values: [[0]] }]);
    await expect(createSqlJsDatabase()).rejects.toThrow(/Connection invariant violation/);
  });

  it("TB-DUR-04: an unrelated write requested mid-import waits until the import is stored", async () => {
    const { SQL, db } = await sqlJs();
    await db.execute("CREATE TABLE unrelated (id TEXT PRIMARY KEY)");
    const events: string[] = [];
    const original = SQL.Database.prototype.run;
    let concurrent: Promise<void> | undefined;
    vi.spyOn(SQL.Database.prototype, "run").mockImplementation(function (
      this: InstanceType<typeof SQL.Database>,
      sql: string,
      params?: BindParams,
    ) {
      if (!concurrent && sql.includes("INSERT INTO ai_study_sets")) {
        concurrent = db.execute("INSERT INTO unrelated (id) VALUES ('during')");
      }
      if (sql.includes("INSERT INTO unrelated")) events.push("unrelated");
      if (sql.trim() === "COMMIT") events.push("commit");
      return original.call(this, sql, params);
    });
    const storeSpy = vi.spyOn(globalThis.localStorage, "setItem");
    storeSpy.mockImplementation((key: string, value: string) => {
      events.push("store");
      stored.set(key, value);
    });
    await db.saveStructuredImportAtomically!(BASE);
    await concurrent;
    expect(events).toEqual(["commit", "store", "unrelated", "store"]);
    const reopened = await createSqlJsDatabase();
    expect(await counts(reopened)).toEqual([1, 1, 1]);
    expect(await reopened.select("SELECT id FROM unrelated")).toEqual([{ id: "during" }]);
  });

  it("TB-DUR-05: a retry after a recovered durability failure saves afresh", async () => {
    const { db } = await sqlJs();
    storageFails = true;
    await expect(db.saveStructuredImportAtomically!(BASE)).rejects.toBeInstanceOf(StorageDurabilityError);
    storageFails = false;
    expect(await db.saveStructuredImportAtomically!(BASE)).toEqual({ status: "saved", materialId: BASE.materialId });
    expect(await counts(await createSqlJsDatabase())).toEqual([1, 1, 1]);
  });

  it("TB-IDEM-02: an identical retry is already_saved and changes nothing", async () => {
    const { db } = await sqlJs();
    const op = withId("b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e");
    await db.saveStructuredImportAtomically!(op);
    const after = await everything(db);
    const storedAfter = stored.get(STORAGE_KEY);
    expect(await db.saveStructuredImportAtomically!(op)).toEqual({ status: "already_saved", materialId: op.materialId });
    expect(await everything(db)).toEqual(after);
    expect(stored.get(STORAGE_KEY)).toBe(storedAfter);
  });

  it("a changed retry under the same id conflicts and changes nothing", async () => {
    const { db } = await sqlJs();
    await db.saveStructuredImportAtomically!(BASE);
    const after = await everything(db);
    const forged = structuredClone(BASE);
    forged.practiceTest!.questions[0]!.question = "A forged question?";
    await expect(db.saveStructuredImportAtomically!(forged)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await db.execute("UPDATE ai_study_sets SET source_notes = 'Changed' WHERE source_material_id = ?", [BASE.materialId]);
    await expect(db.saveStructuredImportAtomically!(BASE)).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await everything(db)).materials).toEqual(after.materials);
  });

  it("a refused operation writes nothing and leaves storage alone", async () => {
    const { db } = await sqlJs();
    const writes = setItemCalls;
    await expect(
      db.saveStructuredImportAtomically!({ ...BASE, apiKey_secret: "x" } as unknown as StructuredImportSaveOperation),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(await counts(db)).toEqual([0, 0, 0]);
    // The failed operation is undone from the stored bytes, never written.
    expect(setItemCalls).toBe(writes);
  });
});

/* --------------------- sql.js connection lifecycle ---------------------- */

describe("sql.js connection lifecycle (foreign keys)", () => {
  async function foreignKeysEnforced(db: SqlDatabase) {
    await expect(
      db.execute(
        "INSERT INTO ai_study_sets (source_material_id, generated_at, updated_at) VALUES ('missing-material', 't', 't')",
      ),
    ).rejects.toThrow(/FOREIGN KEY/i);
  }

  async function deleteCascades(db: SqlDatabase, id: string) {
    await db.execute("DELETE FROM study_materials WHERE id = ?", [id]);
    expect(await counts(db)).toEqual([0, 0, 0]);
  }

  it("TB-SQLJS-01: export resets foreign keys and initializeConnection restores and verifies them", async () => {
    const SQL = await initSqlJs({ locateFile: () => WASM });
    const raw = new SQL.Database();
    raw.run("CREATE TABLE parent (id TEXT PRIMARY KEY)");
    raw.run("CREATE TABLE child (id TEXT, parent_id TEXT REFERENCES parent(id) ON DELETE CASCADE)");
    initializeConnection(raw);
    raw.export();
    // The engine fact the initializer exists for.
    expect(raw.exec("PRAGMA foreign_keys")[0]!.values[0]![0]).toBe(0);
    initializeConnection(raw);
    expect(raw.exec("PRAGMA foreign_keys")[0]!.values[0]![0]).toBe(1);
    expect(() => raw.run("INSERT INTO child VALUES ('c', 'missing')")).toThrow(/FOREIGN KEY/i);
    raw.run("INSERT INTO parent VALUES ('p')");
    raw.run("INSERT INTO child VALUES ('c', 'p')");
    raw.run("DELETE FROM parent");
    expect(raw.exec("SELECT COUNT(*) FROM child")[0]!.values[0]![0]).toBe(0);
    raw.close();
  });

  it("TB-SQLJS-02: after a committed import's durable export, orphans are refused and deletes cascade", async () => {
    const { db } = await sqlJs();
    await db.saveStructuredImportAtomically!(BASE);
    await foreignKeysEnforced(db);
    await deleteCascades(db, BASE.materialId);
  });

  it("TB-SQLJS-03: the handle restored after a durability failure enforces foreign keys", async () => {
    const { db } = await sqlJs();
    await db.saveStructuredImportAtomically!(BASE);
    storageFails = true;
    await expect(
      db.saveStructuredImportAtomically!(withId("c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f")),
    ).rejects.toBeInstanceOf(StorageDurabilityError);
    storageFails = false;
    await foreignKeysEnforced(db);
    await deleteCascades(db, BASE.materialId);
  });

  it("TB-SQLJS-05: ordinary writes and debrief saves work on the recovered handle", async () => {
    const { db } = await sqlJs();
    storageFails = true;
    await expect(db.saveStructuredImportAtomically!(BASE)).rejects.toBeInstanceOf(StorageDurabilityError);
    storageFails = false;
    await db.execute(PRIOR);
    const debrief: DebriefSaveOperation = {
      operationId: "op-1",
      targetId: "journal-1",
      journal: { date: "2026-10-04", title: "Synthetic debrief", materialIds: ["prior-material"] },
    };
    await db.saveDebriefAtomically!(debrief);
    await db.saveStructuredImportAtomically!(BASE);
    await foreignKeysEnforced(db);
    const reopened = await createSqlJsDatabase();
    expect(await reopened.select("SELECT journal_id, material_id FROM journal_materials")).toEqual([
      { journal_id: "journal-1", material_id: "prior-material" },
    ]);
    expect(await counts(reopened)).toEqual([2, 1, 1]);
  });
});
