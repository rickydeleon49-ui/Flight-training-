/** Populated schema 19 -> 20 through the actual startup and persistence boundaries. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HomeworkOperation } from "@/domain/homework";
import { HOMEWORK_TABLES } from "@/domain/homework";
import { MIGRATIONS } from "./migrations";
import { StorageDurabilityError } from "./persistenceErrors";
import { homeworkRepository } from "./repositories/homeworkRepository";
import { createSqlJsDatabase } from "./sqlJsDb";
import { createNodeSqliteDatabase } from "./testing/nodeSqliteDb";
import { dumpTables, openNodeEngine, openSqlJsEngine } from "./testing/skillEvidenceEngines";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({ default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm` }));
afterEach(() => vi.unstubAllGlobals());
const fixture = JSON.parse(readFileSync("src-tauri/fixtures/homework-validation/cases.json", "utf8")) as { baseline: string[]; card_seed: string[]; operations: Record<string, HomeworkOperation> };
const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
const decode = (bytes: string) => Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
async function schema19() {
  const engine = await openNodeEngine();
  try {
    engine.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL)");
    for (const m of MIGRATIONS.filter((m) => m.version <= 19)) {
      engine.exec(m.sql);
      engine.exec(`INSERT INTO schema_migrations VALUES (${m.version}, '${m.description}', '2026-10-21T10:00:00.000Z')`);
    }
    for (const sql of fixture.baseline) engine.exec(sql);
    engine.exec("INSERT INTO journal_entries (id,date,title,created_at,updated_at) VALUES ('synthetic-upgrade-sentinel','2026-10-21','Synthetic upgrade','2026-10-21T10:00:00.000Z','2026-10-21T10:00:00.000Z')");
    return { bytes: engine.snapshot(), before: dumpTables(engine) };
  } finally { engine.close(); }
}
function assertUpgrade(before: Record<string, unknown[]>, after: Record<string, unknown[]>) {
  for (const [table, rows] of Object.entries(before)) {
    if (table === "schema_migrations") {
      expect(after[table]!.slice(0, 19)).toEqual(rows);
      expect(after[table]!.slice(19)).toEqual([
        expect.objectContaining({ version: 20, description: "homework" }),
        expect.objectContaining({ version: 21, description: "flight_schools" }),
        expect.objectContaining({ version: 22, description: "journal_school" }),
        expect.objectContaining({ version: 23, description: "homework_answers" }),
        expect.objectContaining({ version: 24, description: "study_page_sources" }),
        expect.objectContaining({ version: 25, description: "oral_scenarios" }),
        expect.objectContaining({ version: 26, description: "visual_card_regions" }),
        expect.objectContaining({ version: 27, description: "faa_reference_copies" }),
        expect.objectContaining({ version: 28, description: "practice_item_acs_tasks" }),
        expect.objectContaining({ version: 29, description: "material_video_links" }),
      ]);
    } else if (table === "journal_entries") {
      expect(after[table], table).toEqual(
        rows.map((r) => ({ ...(r as Record<string, unknown>), school_name: null })),
      );
    } else expect(after[table], table).toEqual(rows);
  }
  const added = [...HOMEWORK_TABLES, "flight_schools", "study_page_sources", "study_page_source_bindings", "oral_save_operations", "oral_scenario_versions", "oral_scenarios", "visual_card_regions", "card_item_visual_regions", "faa_reference_copies", "practice_item_acs_tasks", "material_video_links"].sort();
  expect(Object.keys(after).filter((t) => !(t in before)).sort()).toEqual(added);
  for (const table of added) expect(after[table]).toEqual([]);
}

describe("homework schema upgrade and driver durability", () => {
  it("populated 19 to 20 browser upgrade and repeated reopen preserve every old row", async () => {
    const { bytes, before } = await schema19();
    let stored = encode(bytes);
    vi.stubGlobal("localStorage", { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } });
    await createSqlJsDatabase();
    const first = await openSqlJsEngine(decode(stored));
    let upgraded: ReturnType<typeof dumpTables>;
    try { upgraded = dumpTables(first); assertUpgrade(before, upgraded); } finally { first.close(); }
    await createSqlJsDatabase();
    const reopened = await openSqlJsEngine(decode(stored));
    try { expect(dumpTables(reopened)).toEqual(upgraded); } finally { reopened.close(); }
  });
  it("populated 19 to 20 node upgrade and repeated reopen preserve every old row", async () => {
    const { bytes, before } = await schema19();
    const dir = mkdtempSync(join(tmpdir(), "homework-upgrade-"));
    const path = join(dir, "library.db");
    try {
      writeFileSync(path, bytes);
      (await createNodeSqliteDatabase(path)).close();
      const first = await openNodeEngine(path);
      let upgraded: ReturnType<typeof dumpTables>;
      try { upgraded = dumpTables(first); assertUpgrade(before, upgraded); } finally { first.close(); }
      (await createNodeSqliteDatabase(path)).close();
      const reopened = await openNodeEngine(path);
      try { expect(dumpTables(reopened)).toEqual(upgraded); } finally { reopened.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("interrupted browser upgrade never overwrites the populated schema 19 bytes", async () => {
    const { bytes, before } = await schema19();
    const stored = encode(bytes);
    vi.stubGlobal("localStorage", { getItem: () => stored, setItem: () => { throw new Error("synthetic persistence refusal"); } });
    await expect(createSqlJsDatabase()).rejects.toBeInstanceOf(StorageDurabilityError);
    const reopened = await openSqlJsEngine(decode(stored));
    try { expect(dumpTables(reopened)).toEqual(before); } finally { reopened.close(); }
  });
  it("homework final persistence failure restores every live table and receipt; retry saves once", async () => {
    let stored: string | null = null, fail = false;
    vi.stubGlobal("localStorage", { getItem: () => stored, setItem: (_key: string, value: string) => {
      if (fail) throw new Error("synthetic persistence refusal");
      stored = value;
    } });
    const db = await createSqlJsDatabase();
    for (const sql of fixture.baseline) await db.execute(sql);
    const repo = homeworkRepository(db);
    const before = stored!;
    const original = await openSqlJsEngine(decode(before));
    let tables: ReturnType<typeof dumpTables>;
    try { tables = dumpTables(original); } finally { original.close(); }
    fail = true;
    await expect(repo.save(structuredClone(fixture.operations.create!))).rejects.toBeInstanceOf(StorageDurabilityError);
    expect(stored).toBe(before);
    for (const [table, rows] of Object.entries(tables)) expect(await db.select(`SELECT * FROM "${table}" ORDER BY rowid`), table).toEqual(rows);
    fail = false;
    const result = await repo.save(structuredClone(fixture.operations.create!));
    expect(await repo.save(structuredClone(fixture.operations.create!))).toEqual(result);
    for (const table of ["homework_operations", "homework_history"]) expect(await db.select(`SELECT COUNT(*) AS n FROM ${table}`)).toEqual([{ n: 1 }]);
    const reopened = homeworkRepository(await createSqlJsDatabase());
    expect(await reopened.get(result.assignmentId)).toEqual(await repo.get(result.assignmentId));
    expect(await reopened.history(result.assignmentId)).toEqual(await repo.history(result.assignmentId));
  });
  it("homework card persistence refusal restores rating, run and history; restart resumes saved evidence", async () => {
    let stored:string|null=null,fail=false;
    vi.stubGlobal("localStorage",{getItem:()=>stored,setItem:(_key:string,value:string)=>{if(fail)throw new Error("synthetic quota");stored=value;}});
    const db=await createSqlJsDatabase();
    for(const sql of [...fixture.baseline,...fixture.card_seed])await db.execute(sql);
    const repo=homeworkRepository(db);
    await repo.save(structuredClone(fixture.operations.card_create!));await repo.save(structuredClone(fixture.operations.card_start!));
    const start=fixture.operations.card_start!,run=start.next.runs[0] as import("@/domain/homework").HomeworkCardRun;
    const action:import("@/domain/types").CardReviewAction={action:"rate",operationId:"00000000-0000-4000-8000-0000000000dc",materialId:run.scope.material_id,versionContentHash:run.scope.source_revision,itemId:run.scope.item_ids[0]!,expectedGeneration:0,expectedRevision:0,rating:"again",homework:{assignmentId:start.assignmentId,runId:run.id,expectedRevision:2,activityRevision:1,cycle:1}};
    const before=stored!,original=await openSqlJsEngine(decode(before));let tables:ReturnType<typeof dumpTables>;
    try{tables=dumpTables(original);}finally{original.close();}
    fail=true;await expect(db.saveCardReviewAtomically!(action)).rejects.toBeInstanceOf(StorageDurabilityError);
    expect(stored).toBe(before);
    for(const [table,rows] of Object.entries(tables))expect(await db.select(`SELECT * FROM "${table}" ORDER BY rowid`),table).toEqual(rows);
    fail=false;const result=await db.saveCardReviewAtomically!(action);expect(await db.saveCardReviewAtomically!(action)).toEqual(result);
    const reopened=homeworkRepository(await createSqlJsDatabase());const current=await reopened.get(start.assignmentId);
    const currentRun = current!.runs[0] as import("@/domain/homework").HomeworkCardRun;
    expect(current).toEqual(await repo.get(start.assignmentId));expect(currentRun.ratings).toHaveLength(1);
    expect(currentRun.scope.item_ids).toEqual(run.scope.item_ids);expect(current!.activities[0]!.record.state).toBe("in_progress");
  });

});
