/**
 * Schema 15 (document navigation) through the production browser driver and
 * the test driver (M4 Slice 1, M4S1-R4, OD-10): a populated schema-14 library
 * upgrades keeping every row; a tampered schema-14 library is refused before
 * any upgrade is kept; malformed navigation schema is refused; and navigation
 * rows survive a reopen.
 *
 * Real engines only: sql.js with its WASM over an in-memory localStorage map,
 * and node:sqlite on disposable temporary files. Never a real profile.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MIGRATIONS } from "./migrations";
import { NAVIGATION_TABLES, PracticeStateValidationError } from "./practiceStateValidation";
import { createSqlJsDatabase } from "./sqlJsDb";
import { createNodeSqliteDatabase } from "./testing/nodeSqliteDb";
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
  type Engine,
} from "./testing/skillEvidenceEngines";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

const STORAGE_KEY = "her-flight-deck.dev-database";
const CURRENT = MIGRATIONS.at(-1)!.version;
const POPULATED_13 = readFileSync(`${FIXTURES}/populated-schema13.sql`, "utf8");
const HASH = "a".repeat(64);

let stored: Map<string, string>;
const engines: Engine[] = [];
const dirs: string[] = [];

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const e of engines.splice(0)) {
    try {
      e.close();
    } catch {
      // closed by the test already
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** A populated schema-14 library with real skill evidence, as bytes. */
async function populated14(): Promise<Uint8Array> {
  const engine = await openNodeEngine();
  engines.push(engine);
  await migrate(engine, { through13: true });
  engine.exec(POPULATED_13);
  const store = await openStore(engine);
  const [journal] = engine.query("SELECT id, date FROM journal_entries ORDER BY rowid LIMIT 1");
  await store.act(createRequest({ journalId: String(journal!["id"]), observedOn: String(journal!["date"]), wording: "Flare later." }));
  expect(Math.max(...appliedVersions(engine))).toBe(14);
  return engine.snapshot();
}

async function storedEngine(): Promise<Engine> {
  const engine = await openSqlJsEngine(fromBase64(stored.get(STORAGE_KEY)!));
  engines.push(engine);
  return engine;
}

describe("the browser driver opening a schema-14 library", () => {
  it("upgrades a populated library to schema 15, keeping every row and adding four empty navigation tables", async () => {
    const bytes = await populated14();
    const before = dumpTables(await openSqlJsEngine(bytes), { exclude: ["schema_migrations"] });
    stored.set(STORAGE_KEY, toBase64(bytes));
    await createSqlJsDatabase();
    const after = await storedEngine();
    expect(Math.max(...appliedVersions(after))).toBe(CURRENT);
    const rows = withoutSchema16And17Columns(dumpTables(after, { exclude: ["schema_migrations"] }));
    for (const [table, content] of Object.entries(before)) expect(rows[table], table).toEqual(content);
    const added = Object.keys(rows).filter((t) => !(t in before)).sort();
    expect(added).toEqual([...NAVIGATION_TABLES, ...MANUAL_STUDY_NEW_TABLES, ...PRACTICE_AUTHORING_NEW_TABLES, ...PDF_KIT_NEW_TABLES].sort());
    for (const table of added) expect(rows[table], table).toEqual([]);
  });

  it("refuses a tampered schema-14 library and leaves the stored bytes exactly as they were", async () => {
    const engine = await openSqlJsEngine(await populated14());
    engines.push(engine);
    engine.exec("UPDATE skill_observations SET wording = 'Altered.'");
    const tampered = toBase64(engine.snapshot());
    stored.set(STORAGE_KEY, tampered);
    await expect(createSqlJsDatabase()).rejects.toBeInstanceOf(PracticeStateValidationError);
    expect(stored.get(STORAGE_KEY)).toBe(tampered);
    const still = await storedEngine();
    expect(Math.max(...appliedVersions(still)), "no upgrade was kept").toBe(14);
  });

  it("refuses a schema-15 library whose navigation schema was altered, storing nothing", async () => {
    await createSqlJsDatabase();
    const engine = await storedEngine();
    engine.exec("DROP INDEX idx_material_reading_state_owner");
    const altered = toBase64(engine.snapshot());
    stored.set(STORAGE_KEY, altered);
    await expect(createSqlJsDatabase()).rejects.toBeInstanceOf(PracticeStateValidationError);
    expect(stored.get(STORAGE_KEY)).toBe(altered);
  });

  it("keeps navigation rows across a reopen, and deleting the material removes all of them", async () => {
    const db = await createSqlJsDatabase();
    await db.execute("INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('mat', 'Synthetic', 'x', 'x')");
    // Identity comes only from the native inspector; seed it as that inspector would have.
    await db.execute("INSERT INTO material_content_identities VALUES ('mat', ?, 20, 'x')", [HASH]);
    const { generation } = await db.navigationOperation!({ kind: "begin", materialId: "mat", supersedeGeneration: null });
    await db.navigationOperation!({ kind: "commit", materialId: "mat", generation, contentSha256: HASH, physicalPage: 7, pageLabel: "3-1" });
    await db.navigationOperation!({
      kind: "add_bookmark", materialId: "mat", expectedContentSha256: HASH, bookmarkId: "b1", physicalPage: 2, pageLabel: null, title: "Charts", notes: "",
    });
    await db.navigationOperation!({
      kind: "set_read", materialId: "mat", expectedContentSha256: HASH, expectedOwnerGeneration: generation, physicalPage: 7, confirmed: true,
    });

    const reopened = await createSqlJsDatabase();
    const state = await reopened.navigationOperation!({ kind: "read", materialId: "mat" });
    expect(state.readingState).toMatchObject({ lastRequestedPage: 7, lastRequestedPageLabel: "3-1", confirmedRead: true, status: "active" });
    expect(state.bookmarks.map((b) => b.id)).toEqual(["b1"]);
    await reopened.execute("DELETE FROM study_materials WHERE id = 'mat'");
    const engine = await storedEngine();
    for (const table of NAVIGATION_TABLES) expect(engine.query(`SELECT COUNT(*) AS n FROM ${table}`), table).toEqual([{ n: 0 }]);
  });
});

describe("the node test driver opening a schema-14 file", () => {
  const temp = (name: string) => {
    const dir = mkdtempSync(join(tmpdir(), "m4-upgrade-"));
    dirs.push(dir);
    return join(dir, name);
  };

  it("upgrades a valid file to schema 15 and reopens it without migrating again", async () => {
    const path = temp("library.db");
    writeFileSync(path, await populated14());
    const first = await createNodeSqliteDatabase(path);
    expect(await first.select("SELECT MAX(version) AS v FROM schema_migrations")).toEqual([{ v: CURRENT }]);
    first.close();
    const second = await createNodeSqliteDatabase(path);
    expect(await second.select("SELECT COUNT(*) AS n FROM schema_migrations WHERE version = 15")).toEqual([{ n: 1 }]);
    second.close();
  });
});
