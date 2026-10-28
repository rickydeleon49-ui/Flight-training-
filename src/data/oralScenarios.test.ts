/** ORAL-01c: saved scenario codec, transaction (node:sqlite and sql.js) and verifier. Fictional fixtures only. */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

import type { SqlDatabase, SqlValue } from "./db";
import { applyMigrations } from "./migrations";
import {
  decodeOralPoints,
  encodeOralPoints,
  executeOralOperation,
  oralContentHash,
  OralScenarioError,
  type OralScenarioContent,
} from "./oralScenarios";
import { PracticeStateValidationError, validateApplicationDatabase, validateOralScenarios } from "./practiceStateValidation";
import { createRepositories } from "./repositories";
import { createSqlJsDatabase } from "./sqlJsDb";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";

const nativeSqlite = "node:sqlite";
const M = "oral-material";
const uid = (n: number) => `0a1c0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const content = (prompt: string, points = 3): OralScenarioContent => ({
  prompt,
  assumptions: "Imagine the fictional Alpha panel.\nLine two ✈",
  points: Array.from({ length: points }, (_, i) => `Point ${i} — Bravo`),
  sourcePage: 3,
  origin: "instructor",
});
const create = (op: number, scenario: number, version: number, prompt: string) => ({
  action: "create" as const,
  operationId: uid(op),
  materialId: M,
  at: "2026-10-28T10:00:00.000Z",
  scenarioId: uid(scenario),
  versionId: uid(version),
  content: content(prompt),
});

let open: TestDatabase | undefined;
afterEach(() => {
  open?.close();
  open = undefined;
});

async function engines(): Promise<Array<[string, SqlDatabase]>> {
  open = await createNodeSqliteDatabase();
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value) },
    configurable: true,
    writable: true,
  });
  const sqlJs = await createSqlJsDatabase();
  for (const db of [open, sqlJs]) {
    await db.execute("INSERT INTO study_materials (id, title, created_at, updated_at) VALUES (?, 'Fictional practice panel', 'x', 'x')", [M]);
  }
  return [["node:sqlite", open], ["sql.js", sqlJs]];
}

async function raw() {
  const { DatabaseSync } = await import(/* @vite-ignore */ nativeSqlite);
  const make = async () => {
    const handle = new DatabaseSync(":memory:");
    handle.exec("PRAGMA foreign_keys = ON");
    await applyMigrations((sql) => handle.exec(sql), new Set());
    const query = (sql: string, params: SqlValue[] = []) => handle.prepare(sql).all(...params) as Record<string, unknown>[];
    return { handle, query };
  };
  const reference = await make();
  const db = await make();
  db.handle.exec(`INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('${M}', 'Fictional', 'x', 'x')`);
  const save = (op: unknown) =>
    executeOralOperation((sql) => db.handle.exec(sql), (sql, params) => void db.handle.prepare(sql).run(...params), db.query, op);
  return { db, reference, save };
}

describe("points codec", () => {
  it("accepts 1–12 points of 1–500 characters, exactly encoded", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `p${i}`);
    expect(decodeOralPoints(encodeOralPoints(twelve))).toEqual(twelve);
    expect(() => decodeOralPoints(JSON.stringify([...twelve, "p12"]))).toThrow(OralScenarioError);
    expect(() => decodeOralPoints("[]")).toThrow(OralScenarioError);
    expect(() => decodeOralPoints('[""]')).toThrow(OralScenarioError);
    expect(() => decodeOralPoints('["  "]')).toThrow(OralScenarioError);
    expect(decodeOralPoints(JSON.stringify(["é".repeat(500)]))).toHaveLength(1);
    expect(() => decodeOralPoints(JSON.stringify(["é".repeat(501)]))).toThrow(OralScenarioError);
    expect(() => decodeOralPoints('["a", "b"]')).toThrow(OralScenarioError);
    expect(() => decodeOralPoints("[1]")).toThrow(OralScenarioError);
    expect(() => decodeOralPoints('["\\ud800"]')).toThrow(OralScenarioError);
  });

  it("hashes the same canonical descriptor as the native twin", async () => {
    // The same literal is asserted in src-tauri/src/oral_scenarios_tests.rs.
    expect(await oralContentHash(uid(10), 2, content("Scenario Alpha \"quoted\"\n✈", 2))).toBe(PARITY_HASH);
  });
});

const PARITY_HASH = "b2a60eb7007922a82cf294fb7974d960fb422064142dab736482c9c0aa928c91";

describe("saving scenarios", () => {
  it("creates, edits into a new version, reorders, removes and retries idempotently in both engines", async () => {
    for (const [name, db] of await engines()) {
      const repos = createRepositories(db);
      const save = db.saveOralScenarioAtomically!.bind(db);
      const first = await save(create(1, 10, 11, "Scenario Alpha"));
      expect(await save(create(1, 10, 11, "Scenario Alpha")), name).toEqual(first);
      await expect(save(create(1, 10, 11, "Changed"))).rejects.toMatchObject({ code: "CONFLICT" });
      await save(create(2, 20, 21, "Scenario Bravo"));
      const edit = { action: "edit" as const, operationId: uid(3), materialId: M, at: "t", scenarioId: uid(10), versionId: uid(12), baseVersion: 1, content: content("Scenario Alpha, edited", 12) };
      expect((await save(edit)).versionNumber).toBe(2);
      await expect(save({ ...edit, operationId: uid(4), versionId: uid(13) })).rejects.toMatchObject({ code: "STALE" });
      expect(await db.select("SELECT version_number, prompt FROM oral_scenario_versions WHERE scenario_id = ? ORDER BY version_number", [uid(10)])).toEqual([
        { version_number: 1, prompt: "Scenario Alpha" },
        { version_number: 2, prompt: "Scenario Alpha, edited" },
      ]);
      await repos.oralScenarios.reorder(M, [uid(20), uid(10)]);
      expect((await repos.oralScenarios.list(M)).map((s) => [s.id, s.versionNumber])).toEqual([[uid(20), 1], [uid(10), 2]]);
      await expect(repos.oralScenarios.reorder(M, [uid(20)])).rejects.toMatchObject({ code: "STALE" });
      await repos.oralScenarios.remove(M, uid(20));
      await expect(repos.oralScenarios.remove(M, uid(20))).rejects.toMatchObject({ code: "MISSING" });
      const added = await repos.oralScenarios.create(M, { ...content("Scenario Charlie"), origin: "user" });
      const list = await repos.oralScenarios.list(M);
      expect(list.map((s) => s.id)).toEqual([uid(10), added.scenarioId]);
      expect(list[0]!.points).toHaveLength(12);
      expect(list[1]!.origin).toBe("user");
      const receipts = await db.select<{ t: string }>("SELECT group_concat(payload_hash || result_json, '') AS t FROM oral_save_operations");
      expect(receipts[0]!.t).not.toMatch(/Scenario|Bravo/);
    }
  });

  it("refuses invalid operations without writing", async () => {
    for (const [, db] of await engines()) {
      const save = db.saveOralScenarioAtomically!.bind(db);
      const base = create(1, 10, 11, "x");
      for (const bad of [
        { ...base, content: content("x", 13) },
        { ...base, content: { ...content("x"), origin: "study_aid" } },
        { ...base, content: content("   ") },
        { ...base, extra: 1 },
        { ...base, content: { ...content("x"), sourcePage: 0 } },
      ]) {
        await expect(save(bad as never)).rejects.toMatchObject({ code: "INVALID" });
      }
      await expect(save({ ...base, materialId: "nope" })).rejects.toMatchObject({ code: "MISSING" });
      expect(await db.select("SELECT (SELECT COUNT(*) FROM oral_scenarios) + (SELECT COUNT(*) FROM oral_save_operations) AS n")).toEqual([{ n: 0 }]);
    }
  });

  it("deleting the material removes its scenarios, versions and receipts", async () => {
    for (const [, db] of await engines()) {
      await db.saveOralScenarioAtomically!(create(1, 10, 11, "Scenario Alpha"));
      await createRepositories(db).documents.remove(M);
      for (const table of ["oral_scenarios", "oral_scenario_versions", "oral_save_operations"]) {
        expect(await db.select(`SELECT COUNT(*) AS n FROM ${table}`), table).toEqual([{ n: 0 }]);
      }
    }
  });
});

describe("verifier", () => {
  const thirteen = JSON.stringify(Array.from({ length: 13 }, (_, i) => `Point ${i}`));
  const corruptions = [
    "UPDATE oral_scenario_versions SET prompt = 'Changed behind her back' WHERE version_number = 1",
    `UPDATE oral_scenario_versions SET points_json = '${thirteen}' WHERE version_number = 1`,
    `UPDATE oral_scenario_versions SET points_json = '["a", "b"]' WHERE version_number = 1`,
    "UPDATE oral_scenario_versions SET content_hash = replace(content_hash, substr(content_hash, 1, 1), CASE substr(content_hash, 1, 1) WHEN 'a' THEN 'b' ELSE 'a' END) WHERE version_number = 2",
    "DELETE FROM oral_scenario_versions WHERE version_number = 1",
    "UPDATE oral_scenario_versions SET scenario_id = '0a1c0000-0000-4000-8000-999999999999' WHERE version_number = 2",
    `UPDATE oral_save_operations SET result_json = '{"prompt":"Scenario Alpha"}'`,
    "UPDATE oral_save_operations SET action = 'answer'",
    "DROP INDEX idx_oral_scenario_order",
  ];

  it("accepts saved scenarios and refuses each corrupt row", async () => {
    for (const sql of [null, ...corruptions]) {
      const { db, reference, save } = await raw();
      await save(create(1, 10, 11, "Scenario Alpha"));
      await save({ action: "edit", operationId: uid(2), materialId: M, at: "t", scenarioId: uid(10), versionId: uid(12), baseVersion: 1, content: content("Edited", 2) });
      await validateOralScenarios(db.query, reference.query);
      if (sql === null) continue;
      db.handle.exec("PRAGMA foreign_keys = OFF");
      db.handle.exec(sql);
      await expect(validateOralScenarios(db.query, reference.query), sql).rejects.toBeInstanceOf(PracticeStateValidationError);
    }
  });

  it("runs from the whole-database check, which still refuses a newer schema", async () => {
    const { db, reference, save } = await raw();
    await save(create(1, 10, 11, "Scenario Alpha"));
    await validateApplicationDatabase(db.query, reference.query);
    db.handle.exec(`UPDATE oral_scenario_versions SET points_json = '["Only one"]'`);
    await expect(validateApplicationDatabase(db.query, reference.query)).rejects.toBeInstanceOf(PracticeStateValidationError);
    const fresh = await raw();
    fresh.db.handle.exec("INSERT INTO schema_migrations (version, description, applied_at) VALUES (27, 'future', 'x')");
    await expect(validateApplicationDatabase(fresh.db.query, fresh.reference.query)).rejects.toThrow(/newer format/);
  });

  it("a schema-24 library upgrades with empty scenario tables", async () => {
    const { DatabaseSync } = await import(/* @vite-ignore */ nativeSqlite);
    const handle = new DatabaseSync(":memory:");
    const { MIGRATIONS } = await import("./migrations");
    await applyMigrations((sql) => handle.exec(sql), new Set(MIGRATIONS.filter((m) => m.version > 24).map((m) => m.version)));
    expect(handle.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'oral_scenarios'").get()).toEqual({ n: 0 });
    await applyMigrations((sql) => handle.exec(sql), new Set(MIGRATIONS.filter((m) => m.version <= 24).map((m) => m.version)));
    expect(handle.prepare("SELECT COUNT(*) AS n FROM oral_scenarios").get()).toEqual({ n: 0 });
  });
});
