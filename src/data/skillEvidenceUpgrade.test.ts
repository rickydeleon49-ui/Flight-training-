/**
 * Schema 13 -> 14 on a genuine populated library, rollback of a failed
 * upgrade, backup/restore round trips across engines and the refusal of a
 * tampered backup. The starting library is the row dump a shipped schema-13
 * driver wrote (debrief with action and question, practice attempt, rated
 * card, split lineage): `src-tauri/fixtures/skill-evidence/populated-schema13.sql`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { MIGRATIONS, applyMigrations } from "./migrations";
import { createRepositories } from "./repositories";
import { NAVIGATION_TABLES, PracticeStateValidationError, SKILL_EVIDENCE_TABLES, validateApplicationDatabase } from "./practiceStateValidation";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";
import {
  FIXTURES,
  appliedVersions,
  createRequest,
  dumpTables,
  MANUAL_STUDY_NEW_TABLES,
  PRACTICE_AUTHORING_NEW_TABLES,
  PDF_KIT_NEW_TABLES,
  withoutSchema16And17Columns,
  migrate,
  openNodeEngine,
  openSqlJsEngine,
  openStore,
  schemaReference,
  type Engine,
} from "./testing/skillEvidenceEngines";

const POPULATED_13 = readFileSync(`${FIXTURES}/populated-schema13.sql`, "utf8");
const engines: Engine[] = [];
const databases: TestDatabase[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const e of new Set(engines.splice(0))) {
    try {
      e.close();
    } catch {
      // closed by the test already
    }
  }
  for (const d of databases.splice(0)) d.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const tempPath = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), "m3-upgrade-"));
  dirs.push(dir);
  return join(dir, name);
};

const RETAINED = (engine: Engine) => dumpTables(engine, { exclude: ["schema_migrations", ...SKILL_EVIDENCE_TABLES] });
const master = (engine: Engine) => engine.query("SELECT type, name, sql FROM sqlite_master ORDER BY name");

async function schema13(engine: Engine): Promise<Engine> {
  engines.push(engine);
  await migrate(engine, { through13: true });
  engine.exec(POPULATED_13);
  return engine;
}

describe("upgrading a populated schema-13 library", () => {
  it("node:sqlite through the production driver: every retained row identical, catalog seeded, nothing backfilled", async () => {
    const path = tempPath("library.db");
    const raw = await schema13(await openNodeEngine(path));
    expect([...appliedVersions(raw)].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    for (const [table, minimum] of [
      ["journal_entries", 2], ["next_actions", 2], ["questions", 2], ["debrief_operations", 2],
      ["practice_responses", 1], ["card_review_events", 1], ["material_split_lineage", 1],
    ] as const) {
      expect(Number(raw.query(`SELECT COUNT(*) AS n FROM ${table}`)[0]!["n"]), table).toBeGreaterThanOrEqual(minimum);
    }
    const before = RETAINED(raw);
    raw.close();
    engines.splice(engines.indexOf(raw), 1);

    const db = await createNodeSqliteDatabase(path);
    databases.push(db);
    expect(await db.select("SELECT MAX(version) AS v FROM schema_migrations")).toEqual([{ v: MIGRATIONS.at(-1)!.version }]);
    const after = await openNodeEngine(path);
    engines.push(after);
    // Later migrations only add: schema 15's four navigation tables, schema
    // 16's four history and origin tables and schema 17's receipt table, all
    // empty, and defaulted columns.
    const retained = withoutSchema16And17Columns(RETAINED(after)) as Record<string, unknown>;
    expect(Object.fromEntries(Object.keys(before).map((k) => [k, retained[k]]))).toEqual(before);
    const added = Object.keys(retained).filter((k) => !Object.hasOwn(before, k)).sort();
    expect(added).toEqual([...NAVIGATION_TABLES, ...MANUAL_STUDY_NEW_TABLES, ...PRACTICE_AUTHORING_NEW_TABLES, ...PDF_KIT_NEW_TABLES, "study_set_save_operations", "homework_assignments", "homework_activities", "homework_runs", "homework_operations", "homework_history", "flight_schools", "study_page_sources", "study_page_source_bindings"].sort());
    for (const table of added) expect(retained[table], table).toEqual([]);
    expect(after.query("SELECT COUNT(*) AS n FROM skill_catalog_entries")).toEqual([{ n: 15 }]);
    expect(after.query("SELECT COUNT(*) AS n FROM skill_observations")).toEqual([{ n: 0 }]);
    expect(after.query("SELECT COUNT(*) AS n FROM skill_evidence_operations")).toEqual([{ n: 0 }]);

    // The upgraded library takes evidence against an existing debrief through the repository.
    const [journal] = after.query("SELECT id, date FROM journal_entries ORDER BY rowid LIMIT 1");
    const repos = createRepositories(db);
    const outcome = await repos.skillEvidence.act(
      createRequest({ journalId: String(journal!["id"]), observedOn: String(journal!["date"]) }) as never,
    );
    expect(outcome.status).toBe("applied");
    expect((await repos.skillEvidence.page({ journalId: String(journal!["id"]) })).items).toHaveLength(1);
  });

  it("sql.js: the same upgrade keeps every retained row and validates", async () => {
    const engine = await schema13(await openSqlJsEngine());
    const before = RETAINED(engine);
    const store = await openStore(engine);
    expect(RETAINED(engine)).toEqual(before);
    expect(engine.query("SELECT MAX(version) AS v FROM schema_migrations")).toEqual([{ v: 14 }]);
    await store.validate();
  });

  for (const [name, open] of [["node:sqlite", () => openNodeEngine()], ["sql.js", () => openSqlJsEngine()]] as const) {
    it(`a failed upgrade rolls back completely to 13 (${name})`, async () => {
      const engine = await schema13(await open());
      const rows = dumpTables(engine);
      const objects = master(engine);
      const broken = `${(await import("./testing/skillEvidenceEngines")).SKILL_EVIDENCE_MIGRATION.sql}\nINSERT INTO no_such_table VALUES (1);`;
      await expect(migrate(engine, { migration14: broken })).rejects.toThrow();
      expect(dumpTables(engine)).toEqual(rows);
      expect(master(engine)).toEqual(objects);
      expect(appliedVersions(engine).has(14)).toBe(false);
      await validateApplicationDatabase((sql, params) => engine.query(sql, params), await schemaReference());
    });
  }
});

describe("backup and restore of a schema-14 library", () => {
  async function populated14(engine: Engine) {
    await schema13(engine);
    const store = await openStore(engine);
    const [journal] = engine.query("SELECT id, date FROM journal_entries ORDER BY rowid LIMIT 1");
    const first = createRequest({ journalId: String(journal!["id"]), observedOn: String(journal!["date"]), wording: "Flare later." });
    await store.act(first);
    await store.act({
      action: "edit_observation", operationId: crypto.randomUUID(), observationId: first.observationId, expectedRevision: 1,
      wording: "Flare a little later.", observedOn: String(journal!["date"]), attribution: "self_report", instructorName: "",
    });
    await store.act({ action: "set_status", operationId: crypto.randomUUID(), skillId: "builtin.normal_landing", expectedSequence: 0, status: "practicing" });
    const erased = createRequest({ journalId: String(journal!["id"]), observedOn: String(journal!["date"]), wording: "Erase me." });
    await store.act(erased);
    await store.act({ action: "erase_observation", operationId: crypto.randomUUID(), observationId: erased.observationId, confirm: "erase" });
    return store;
  }

  it("round trips node -> node, node -> sql.js and sql.js -> node with every row identical and validated", async () => {
    const reference = await schemaReference();
    const node = await openNodeEngine();
    engines.push(node);
    await populated14(node);
    const expected = dumpTables(node);

    const restoredPath = tempPath("restored-from-node.db");
    writeFileSync(restoredPath, node.snapshot());
    const restored = await openNodeEngine(restoredPath);
    engines.push(restored);
    await validateApplicationDatabase((s, p) => restored.query(s, p), reference);
    expect(dumpTables(restored)).toEqual(expected);

    const inBrowser = await openSqlJsEngine(node.snapshot());
    engines.push(inBrowser);
    await validateApplicationDatabase((s, p) => inBrowser.query(s, p), reference);
    expect(dumpTables(inBrowser)).toEqual(expected);

    const backPath = tempPath("from-browser.db");
    writeFileSync(backPath, inBrowser.snapshot());
    const back = await openNodeEngine(backPath);
    engines.push(back);
    expect(dumpTables(back)).toEqual(expected);
    // The production driver opens the restored library.
    back.close();
    const db = await createNodeSqliteDatabase(backPath);
    databases.push(db);
    expect((await createRepositories(db).skillEvidence.summary("builtin.normal_landing"))?.status).toBe("practicing");
  });

  const TAMPERS = [
    "UPDATE skill_observations SET wording = 'Altered.'",
    "DELETE FROM skill_evidence_operations WHERE action = 'set_status'",
    "UPDATE skill_evidence_operations SET is_erased = 0, result_json = '{\"action\":\"create_observation\",\"observationId\":\"x\",\"revision\":1}' WHERE is_erased = 1",
  ];

  // The genuine older-schema case (M4S1-R4): a tampered schema-14 file that the driver would have
  // to upgrade before it can validate. It must be refused and its bytes left exactly as they were.
  it("a schema-14 backup with altered evidence is refused before any upgrade is kept; its bytes are untouched", async () => {
    const node = await openNodeEngine();
    engines.push(node);
    await populated14(node);
    for (const tamper of TAMPERS) {
      const path = tempPath("tampered14.db");
      writeFileSync(path, node.snapshot());
      const copy = await openNodeEngine(path);
      expect(Math.max(...appliedVersions(copy)), "the specimen stays at schema 14").toBe(14);
      copy.exec(tamper);
      copy.close();
      const bytes = readFileSync(path);
      await expect(createNodeSqliteDatabase(path), tamper).rejects.toBeInstanceOf(PracticeStateValidationError);
      expect(readFileSync(path).equals(bytes), tamper).toBe(true);
    }
  });

  it("a current-schema backup with altered evidence is refused, and the production driver will not open it; its bytes are untouched", async () => {
    const node = await openNodeEngine();
    engines.push(node);
    await populated14(node);
    for (const tamper of TAMPERS) {
      const path = tempPath("tampered-current.db");
      writeFileSync(path, node.snapshot());
      const copy = await openNodeEngine(path);
      // Bring this copy to the current schema first, so opening it only validates and never migrates.
      await applyMigrations((sql) => copy.exec(sql), appliedVersions(copy));
      expect(Math.max(...appliedVersions(copy))).toBe(MIGRATIONS.at(-1)!.version);
      copy.exec(tamper);
      copy.close();
      const bytes = readFileSync(path);
      await expect(createNodeSqliteDatabase(path), tamper).rejects.toBeInstanceOf(PracticeStateValidationError);
      expect(readFileSync(path).equals(bytes)).toBe(true);
    }
  });
});
