import initSqlJs from "sql.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNodeSqliteDatabase } from "./testing/nodeSqliteDb";
import { createSqlJsDatabase } from "./sqlJsDb";
import type { SqlDatabase } from "./db";

const WASM = `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
});

describe.each(["node:sqlite", "sql.js"] as const)("R9 omitted-column preservation — %s", (engine) => {
  it.each(["unrecognized stored enums", "explicit empty optional text"] as const)(
    "a title/tag-only save must preserve %s", async (fixture) => {
      const db: SqlDatabase = engine === "node:sqlite"
        ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
      try {
        await db.saveMaterialAtomically!({
          mode: "create", id: "kept", fields: { title: "Prior", originalFileName: "", lastReviewedAt: "" },
          tags: ["Before"], createdAt: "2026-10-03T10:00:00.000Z", updatedAt: "2026-10-03T10:00:00.000Z",
        });
        if (fixture === "unrecognized stored enums") {
          await db.execute("UPDATE study_materials SET material_type=?, topic=?, review_status=?, priority=? WHERE id=?",
            ["future-type", "future-topic", "future-status", "future-priority", "kept"]);
        }
        const before = await db.select<Record<string, unknown>>("SELECT * FROM study_materials WHERE id='kept'");
        await db.saveMaterialAtomically!({ mode: "update", id: "kept", fields: { title: "Changed" }, tags: ["After"] });
        const after = await db.select<Record<string, unknown>>("SELECT * FROM study_materials WHERE id='kept'");
        const untouched = (row: Record<string, unknown>) => {
          const { title: _title, updated_at: _updated, ...rest } = row;
          return rest;
        };
        console.log(JSON.stringify({ engine, fixture, before, after }));
        expect(untouched(after[0]!)).toEqual(untouched(before[0]!));
        if (engine === "sql.js") {
          const reopened = await createSqlJsDatabase();
          expect(await reopened.select("SELECT * FROM study_materials WHERE id='kept'")).toEqual(after);
        }
      } finally { if ("close" in db) (db as { close(): void }).close(); }
    },
  );
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const triggers = [
  ["CASE in trigger body", `CREATE TRIGGER case_body AFTER INSERT ON unrelated
    BEGIN
      INSERT INTO observed (value) VALUES (CASE WHEN NEW.id = 'probe' THEN 'kept' ELSE 'other' END);
    END;`],
  ["CASE in trigger WHEN", `CREATE TRIGGER case_when AFTER INSERT ON unrelated
    WHEN CASE WHEN NEW.id = 'probe' THEN 1 ELSE 0 END = 1
    BEGIN INSERT INTO observed (value) VALUES ('kept'); END;`],
] as const;

describe.each(["node:sqlite", "sql.js"] as const)("R8 legitimate trigger compatibility — %s", (engine) => {
  it.each(triggers)("raw engine control: %s is legal and fires", async (_name, sql) => {
    if (engine === "node:sqlite") {
      const native = "node:sqlite";
      const { DatabaseSync } = await import(/* @vite-ignore */ native);
      const raw = new DatabaseSync(":memory:");
      try {
        raw.exec("CREATE TABLE unrelated (id TEXT); CREATE TABLE observed (value TEXT)");
        raw.prepare(sql).run();
        raw.prepare("INSERT INTO unrelated VALUES ('probe')").run();
        expect(raw.prepare("SELECT value FROM observed").all()).toEqual([{ value: "kept" }]);
      } finally { raw.close(); }
    } else {
      const SQL = await initSqlJs({ locateFile: () => WASM });
      const raw = new SQL.Database();
      try {
        raw.run("CREATE TABLE unrelated (id TEXT); CREATE TABLE observed (value TEXT)");
        raw.run(sql, []);
        raw.run("INSERT INTO unrelated VALUES ('probe')", []);
        expect(raw.exec("SELECT value FROM observed")[0]?.values).toEqual([["kept"]]);
      } finally { raw.close(); }
    }
  });

  it.each(triggers)("public driver must preserve %s", async (_name, sql) => {
    const db: SqlDatabase = engine === "node:sqlite"
      ? await createNodeSqliteDatabase() : await createSqlJsDatabase();
    try {
      await db.execute("CREATE TABLE unrelated (id TEXT)");
      await db.execute("CREATE TABLE observed (value TEXT)");
      await expect(db.execute(sql)).resolves.toBeUndefined();
      await db.execute("INSERT INTO unrelated VALUES ('probe')");
      expect(await db.select("SELECT value FROM observed")).toEqual([{ value: "kept" }]);
    } finally { if ("close" in db) (db as { close(): void }).close(); }
  });
});
