import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm` }));
import { createNodeSqliteDatabase, type TestDatabase } from "../testing/nodeSqliteDb";
import { createSqlJsDatabase } from "../sqlJsDb";
import type { SqlDatabase } from "../db";
import { journalRepository } from "./journalRepository";
import { scheduleRepository } from "./scheduleRepository";
import { financeRepository } from "./financeRepository";
const opened: TestDatabase[] = [];
afterEach(() => { opened.splice(0).forEach(db => db.close()); vi.unstubAllGlobals(); });
for (const engine of ["node", "browser"]) describe(engine, () => {
  async function database(): Promise<SqlDatabase> {
    if (engine === "node") { const db = await createNodeSqliteDatabase(); opened.push(db); return db; }
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
    return createSqlJsDatabase();
  }
  for (const kind of ["journal", "schedule"] as const) for (const failed of ["a", "b"]) {
    it(`${kind} preserves old links when insert ${failed} fails, then replaces/clears on success`, async () => {
      const db = await database();
      const repo = kind === "journal" ? journalRepository(db) : scheduleRepository(db);
      const parent = await repo.create({ date: "2026-10-29", title: "Synthetic" });
      for (const id of ["old", "a", "b"]) await db.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES (?, '', '', '')", [id]);
      await repo.setMaterials(parent.id, ["old"]);
      const table = kind === "journal" ? "journal_materials" : "event_materials";
      await db.execute(`CREATE TRIGGER fail_link BEFORE INSERT ON ${table} WHEN NEW.material_id = '${failed}' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`);
      await expect(repo.setMaterials(parent.id, ["a", "b"])).rejects.toThrow();
      expect(await db.select(`SELECT material_id FROM ${table}`)).toEqual([{ material_id: "old" }]);
      await db.execute("DROP TRIGGER fail_link");
      await repo.setMaterials(parent.id, ["a", "b"]);
      await repo.setMaterials(parent.id, ["a", "b"]);
      expect(await db.select(`SELECT material_id FROM ${table} ORDER BY material_id`)).toEqual([{ material_id: "a" }, { material_id: "b" }]);
      await repo.setMaterials(parent.id, []);
      expect(await db.select(`SELECT * FROM ${table}`)).toEqual([]);
    });
  }
  for (const kind of ["journal", "schedule"] as const) it(`${kind} saves a material listed twice as one link`, async () => {
    const db = await database();
    const repo = kind === "journal" ? journalRepository(db) : scheduleRepository(db);
    const parent = await repo.create({ date: "2026-10-29", title: "Synthetic" });
    await db.execute("INSERT INTO study_materials (id,title,created_at,updated_at) VALUES ('a', '', '', '')");
    await repo.setMaterials(parent.id, ["a", "a"]);
    const table = kind === "journal" ? "journal_materials" : "event_materials";
    expect(await db.select(`SELECT material_id FROM ${table}`)).toEqual([{ material_id: "a" }]);
  });
  it("preserves every goal column on insertion failure, then retires old goals on success", async () => {
    const db = await database(); const repo = financeRepository(db);
    await repo.saveFundGoal({ title: "Old", target: 100 });
    const before = await db.select("SELECT * FROM fund_goals");
    await db.execute("CREATE TRIGGER fail_goal BEFORE INSERT ON fund_goals BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END");
    await expect(repo.saveFundGoal({ title: "New", target: 200 })).rejects.toThrow();
    expect(await db.select("SELECT * FROM fund_goals")).toEqual(before);
    await db.execute("DROP TRIGGER fail_goal");
    const goal = await repo.saveFundGoal({ title: "New", target: 200 });
    expect((await repo.listFundGoals()).filter(g => g.active)).toEqual([goal]);
    await db.createFundGoalAtomically!(goal);
    const later = await repo.saveFundGoal({ title: "Later", target: 300 });
    await db.createFundGoalAtomically!(goal);
    expect((await repo.listFundGoals()).filter(g => g.active)).toEqual([later]);
    await expect(db.createFundGoalAtomically!({ ...goal, target: 999 })).rejects.toThrow();
  });
});
