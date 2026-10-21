/** Schema 17 -> 19 through both real startup drivers, preserving older rows. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS } from "./migrations";
import { validateApplicationDatabase } from "./practiceStateValidation";
import { createSqlJsDatabase } from "./sqlJsDb";
import { createNodeSqliteDatabase } from "./testing/nodeSqliteDb";
import { dumpTables, openNodeEngine, openSqlJsEngine } from "./testing/skillEvidenceEngines";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm` }));
afterEach(() => vi.unstubAllGlobals());

async function schema17() {
  const engine = await openNodeEngine();
  engine.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL)");
  for (const m of MIGRATIONS.filter((m) => m.version <= 17)) {
    engine.exec(m.sql);
    engine.exec(`INSERT INTO schema_migrations VALUES (${m.version}, '${m.description}', 'x')`);
  }
  engine.exec("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('old','Synthetic','x','x')");
  const bytes = engine.snapshot();
  const before = dumpTables(engine, { exclude: ["schema_migrations"] });
  engine.close();
  return { bytes, before };
}

function assertUpgrade(before: Record<string, unknown[]>, after: Record<string, unknown[]>) {
  for (const [table, rows] of Object.entries(before)) expect(after[table], table).toEqual(rows);
  const added = Object.keys(after).filter((t) => !(t in before)).sort();
  expect(added).toEqual(["pdf_kit_item_sources", "pdf_kit_runs", "study_set_save_operations"]);
  for (const table of added) expect(after[table]).toEqual([]);
}

describe("schema 17 to 19", () => {
  it("accepts a schema-17 library without the new tables in the validation ladder", async () => {
    const { bytes } = await schema17();
    const old = await openSqlJsEngine(bytes);
    const ref = await openNodeEngine();
    try {
      for (const m of MIGRATIONS) ref.exec(m.sql);
      await validateApplicationDatabase((s, p) => old.query(s, p), (s, p) => ref.query(s, p));
    } finally { old.close(); ref.close(); }
  });

  it("upgrades and reopens the browser library preserving every older row", async () => {
    const { bytes, before } = await schema17();
    let stored = btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
    vi.stubGlobal("localStorage", { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } });
    await createSqlJsDatabase();
    await createSqlJsDatabase();
    const reopened = await openSqlJsEngine(Uint8Array.from(atob(stored), (c) => c.charCodeAt(0)));
    try {
      expect(reopened.query("SELECT MAX(version) AS v FROM schema_migrations")).toEqual([{ v: 19 }]);
      assertUpgrade(before, dumpTables(reopened, { exclude: ["schema_migrations"] }));
    } finally { reopened.close(); }
  });

  it("upgrades and reopens the node library preserving every older row", async () => {
    const { bytes, before } = await schema17();
    const dir = mkdtempSync(join(tmpdir(), "kit-upgrade-"));
    const path = join(dir, "library.db");
    try {
      writeFileSync(path, bytes);
      const db = await createNodeSqliteDatabase(path);
      db.close();
      const again = await createNodeSqliteDatabase(path);
      expect(await again.select("SELECT MAX(version) AS v FROM schema_migrations")).toEqual([{ v: 19 }]);
      again.close();
      const reopened = await openNodeEngine(path);
      try { assertUpgrade(before, dumpTables(reopened, { exclude: ["schema_migrations"] })); }
      finally { reopened.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
