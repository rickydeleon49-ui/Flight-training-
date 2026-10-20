/**
 * Test-only engines for the M3 skill-evidence contract: real node:sqlite and
 * real sql.js connections, migrated with the registered migrations (or with
 * an edited migration 14, for the shared validation cases), each store
 * serialized through the production ConnectionOwner exactly as the drivers
 * are. Never used by the app.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import type { EvidencePageInput, ObservationHistoryInput, SkillEvidenceAction, SkillEvidenceOutcome } from "@/domain/types";

import { createConnectionOwner, rollbackIfOpen } from "../connectionOwner";
import type { SqlValue } from "../db";
import { MIGRATIONS, applyMigrations } from "../migrations";
import { validateApplicationDatabase, type ValidationQuery } from "../practiceStateValidation";
import { listSkills, readEvidencePage, readObservationHistory, readSkillSummary } from "../skillEvidenceReader";
import { executeSkillEvidenceAction, type TransactionOptions } from "../skillEvidenceTransaction";

export const SKILL_EVIDENCE_MIGRATION = MIGRATIONS.find((m) => m.version === 14)!;
export const FIXTURES = `${process.cwd()}/src-tauri/fixtures/skill-evidence`;
export const WASM = `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;

export type EngineName = "node:sqlite" | "sql.js";
export const ENGINES: EngineName[] = ["node:sqlite", "sql.js"];

export interface Engine {
  name: EngineName;
  exec(sql: string): void;
  run(sql: string, params: SqlValue[]): void;
  query(sql: string, params?: SqlValue[]): Record<string, unknown>[];
  /** Test-only fault seam, called before data statements inside the store. */
  beforeStatement?: (sql: string, params: SqlValue[]) => void;
  /** A consistent copy of the whole database file. */
  snapshot(): Uint8Array;
  close(): void;
}

const nativeSqlite = "node:sqlite";

export async function openNodeEngine(path = ":memory:"): Promise<Engine> {
  const { DatabaseSync } = await import(/* @vite-ignore */ nativeSqlite);
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  const engine: Engine = {
    name: "node:sqlite",
    exec: (sql) => db.exec(sql),
    run: (sql, params) => {
      engine.beforeStatement?.(sql, params);
      db.prepare(sql).run(...params);
    },
    query: (sql, params = []) => db.prepare(sql).all(...params) as Record<string, unknown>[],
    snapshot: () => {
      const dir = mkdtempSync(`${tmpdir()}/m3-snapshot-`);
      try {
        db.prepare("VACUUM INTO ?").run(`${dir}/copy.db`);
        return new Uint8Array(readFileSync(`${dir}/copy.db`));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    close: () => db.close(),
  };
  return engine;
}

export async function openSqlJsEngine(bytes?: Uint8Array): Promise<Engine> {
  const { default: initSqlJs } = await import("sql.js");
  const SQL = await initSqlJs({ locateFile: () => WASM });
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  db.run("PRAGMA foreign_keys = ON");
  const all = (sql: string, params: SqlValue[] = []) => {
    const statement = db.prepare(sql);
    try {
      statement.bind(params as never);
      const out: Record<string, unknown>[] = [];
      while (statement.step()) out.push(statement.getAsObject());
      return out;
    } finally {
      statement.free();
    }
  };
  const engine: Engine = {
    name: "sql.js",
    exec: (sql) => db.exec(sql),
    run: (sql, params) => {
      engine.beforeStatement?.(sql, params);
      db.run(sql, params as never);
    },
    query: all,
    snapshot: () => {
      const out = db.export();
      // export() reopens the connection; foreign keys are per connection.
      db.run("PRAGMA foreign_keys = ON");
      return out;
    },
    close: () => db.close(),
  };
  return engine;
}

export async function openEngine(name: EngineName, path?: string): Promise<Engine> {
  return name === "node:sqlite" ? openNodeEngine(path) : openSqlJsEngine();
}

export function appliedVersions(engine: Engine): Set<number> {
  try {
    return new Set(engine.query("SELECT version FROM schema_migrations").map((r) => Number(r["version"])));
  } catch {
    return new Set();
  }
}

/** Replace exact substrings of migration 14 (each must match once), for the shared validation cases. */
export function editedMigration(edits: [string, string][] = []): string {
  let sql = SKILL_EVIDENCE_MIGRATION.sql;
  for (const [from, to] of edits) {
    const at = sql.indexOf(from);
    if (at < 0 || sql.indexOf(from, at + 1) >= 0) throw new Error(`migration edit must match exactly once: ${from}`);
    sql = sql.replace(from, to);
  }
  return sql;
}

/**
 * Migrations 1-13 as registered, then 14 (possibly edited) in one
 * transaction, or the schema-13 library only when `through13` is set.
 */
export async function migrate(engine: Engine, options: { through13?: boolean; migration14?: string } = {}): Promise<void> {
  const applied = appliedVersions(engine);
  for (const v of MIGRATIONS) if (v.version >= 14) applied.add(v.version);
  await applyMigrations((sql) => engine.exec(sql), applied);
  if (options.through13 || appliedVersions(engine).has(14)) return;
  engine.exec("BEGIN IMMEDIATE");
  try {
    engine.exec(options.migration14 ?? SKILL_EVIDENCE_MIGRATION.sql);
    engine.run("INSERT INTO schema_migrations (version, description, applied_at) VALUES (14, 'skills_evidence', ?)", [
      new Date().toISOString(),
    ]);
    engine.exec("COMMIT");
  } catch (error) {
    try {
      engine.exec("ROLLBACK");
    } catch {
      // keep the original error
    }
    throw error;
  }
}

let reference: Promise<ValidationQuery> | null = null;

/** The registered migrations, built once, read-only: what validation compares against. */
export function schemaReference(): Promise<ValidationQuery> {
  reference ??= (async () => {
    const engine = await openNodeEngine();
    await applyMigrations((sql) => engine.exec(sql), new Set());
    return (sql: string, params: SqlValue[]) => engine.query(sql, params);
  })();
  return reference;
}

export interface SkillEvidenceStore {
  engine: Engine;
  act(action: unknown, options?: TransactionOptions): Promise<SkillEvidenceOutcome>;
  page(input?: EvidencePageInput): ReturnType<typeof readEvidencePage>;
  summary(skillId: string): ReturnType<typeof readSkillSummary>;
  skills(options?: { includeRetired?: boolean }): ReturnType<typeof listSkills>;
  history(input: ObservationHistoryInput): ReturnType<typeof readObservationHistory>;
  /** The whole-database validation the drivers run on open and restore. */
  validate(): Promise<void>;
}

/** A store over an engine: migrate, validate, then serve. */
export async function openStore(engine: Engine, options: { migrate?: boolean } = {}): Promise<SkillEvidenceStore> {
  if (options.migrate !== false) await migrate(engine);
  const ref = await schemaReference();
  const q = (sql: string, params: SqlValue[]) => engine.query(sql, params);
  await validateApplicationDatabase(q, ref);
  const owner = createConnectionOwner(() => rollbackIfOpen((sql) => engine.exec(sql)));
  return {
    engine,
    act: (action, opts) =>
      owner.exclusive(() => executeSkillEvidenceAction((sql) => engine.exec(sql), (sql, p) => engine.run(sql, p), q, action, opts)),
    page: (input = {}) => owner.exclusive(() => readEvidencePage(q, input)),
    summary: (skillId) => owner.exclusive(() => readSkillSummary(q, skillId)),
    skills: (opts) => owner.exclusive(() => listSkills(q, opts)),
    history: (input) => owner.exclusive(() => readObservationHistory(q, input)),
    validate: () => owner.exclusive(() => validateApplicationDatabase(q, ref)),
  };
}

/** Every row of every user table, keyed by table, in rowid order: the comparison unit for upgrade and restore. */
export function dumpTables(engine: Engine, options: { exclude?: string[] } = {}): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  const tables = engine
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((r) => String(r["name"]))
    .filter((t) => !(options.exclude ?? []).includes(t));
  for (const table of tables) out[table] = engine.query(`SELECT * FROM "${table}" ORDER BY rowid`);
  return out;
}

export function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(`${FIXTURES}/${name}`, "utf8")) as T;
}

let counter = 0;
/** Deterministic UUID v4s, unique per process. */
export function uuid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
}

/** A fixed, injectable clock: every call returns the same instant unless advanced. */
export function clock(start = "2026-10-10T09:00:00.000Z") {
  let ms = Date.parse(start);
  const now = () => new Date(ms).toISOString();
  return { now, advance: (by = 1000) => (ms += by) };
}

export const T = "2026-10-10T09:00:00.000Z";

/** A plain debrief row (the debrief writer's own tests cover how real ones are saved). */
export function insertJournal(
  engine: Engine,
  id: string,
  fields: { date?: string; title?: string; instructorFeedback?: string; wasDifficult?: string } = {},
): void {
  engine.run(
    `INSERT INTO journal_entries (id, date, title, instructor_feedback, was_difficult, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, fields.date ?? "2026-10-01", fields.title ?? "Pattern work", fields.instructorFeedback ?? "Flare later.", fields.wasDifficult ?? "", T, T],
  );
}

export function insertAction(engine: Engine, id: string, title = "Review flare timing", journalId: string | null = null): void {
  engine.run(
    `INSERT INTO next_actions (id, title, related_type, related_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, title, journalId ? "journal" : null, journalId, T, T],
  );
}

/** Builds create_observation requests with sensible defaults. */
export function createRequest(
  overrides: Partial<{
    operationId: string;
    observationId: string;
    skillId: string;
    journalId: string;
    sourceField: string;
    wording: string;
    observedOn: string;
    attribution: string;
    instructorName: string;
  }> = {},
) {
  return {
    action: "create_observation",
    operationId: overrides.operationId ?? uuid(),
    observationId: overrides.observationId ?? uuid(),
    skillId: overrides.skillId ?? "builtin.normal_landing",
    journalId: overrides.journalId ?? "j1",
    sourceField: overrides.sourceField ?? "none",
    wording: overrides.wording ?? "Flare a little later.",
    observedOn: overrides.observedOn ?? "2026-10-01",
    attribution: overrides.attribution ?? "instructor_transcribed",
    instructorName: overrides.instructorName ?? "Synthetic CFI",
  };
}

/** A store with one real debrief (journal and action) saved through the shipped debrief transaction on the same connection. */
export async function storeWithDebrief(engineName: EngineName = "node:sqlite") {
  const engine = await openEngine(engineName);
  const store = await openStore(engine);
  const { executeDebriefSave } = await import("../debriefTransaction");
  const journalId = uuid();
  const actionId = uuid();
  await executeDebriefSave(
    (sql) => engine.exec(sql),
    (sql, params) => engine.run(sql, params),
    (sql, params) => engine.query(sql, params).length > 0,
    {
      operationId: uuid(),
      targetId: journalId,
      journal: {
        date: "2026-10-01",
        title: "Pattern work",
        instructorFeedback: "Look further down the runway in the flare.",
        wasDifficult: "Holding centerline in the gusts.",
        instructorName: "Synthetic CFI",
      },
      action: { id: actionId, title: "Review flare timing" },
    },
  );
  return { engine, store, journalId, actionId };
}

/** A create_observation request with the debrief's instructor feedback as its source. */
export function observation(
  skillId: string,
  journalId: string,
  overrides: Partial<Extract<SkillEvidenceAction, { action: "create_observation" }>> = {},
): Extract<SkillEvidenceAction, { action: "create_observation" }> {
  return {
    action: "create_observation",
    operationId: uuid(),
    observationId: uuid(),
    skillId,
    journalId,
    sourceField: "instructor_feedback",
    wording: "Look further down the runway in the flare.",
    observedOn: "2026-10-01",
    attribution: "instructor_transcribed",
    instructorName: "Synthetic CFI",
    ...overrides,
  };
}

/** Tables migration 16 (OFFLINE-03a) adds, all empty after an upgrade. */
export const MANUAL_STUDY_NEW_TABLES = ["study_set_history", "card_version_origins", "card_item_origins", "practice_item_origins"] as const;

/** Tables migration 17 (OFFLINE-03b) adds, all empty after an upgrade. */
export const PRACTICE_AUTHORING_NEW_TABLES = ["practice_save_operations"] as const;

/**
 * An upgraded dump with the columns migrations 16 and 17 add to existing tables
 * removed, after checking each holds its default: `ai_study_sets` gains
 * `summary_origin` (NULL) and `retired_json` ('[]'), and `material_bookmarks`
 * gains `quote` (NULL); migration 17 then gives `practice_tests` its own
 * `retired_json` ('[]') and `practice_test_items` `logical_id` and `replaces_id`
 * (both NULL). Every older value is then compared as it was.
 */
export function withoutSchema16And17Columns(rows: Record<string, unknown[]>): Record<string, unknown[]> {
  const strip = (table: string, columns: Record<string, unknown>) =>
    (rows[table] ?? []).map((row) => {
      const copy = { ...(row as Record<string, unknown>) };
      for (const [column, value] of Object.entries(columns)) {
        if (copy[column] !== value) throw new Error(`${table}.${column} is not its upgrade default`);
        delete copy[column];
      }
      return copy;
    });
  const out = { ...rows };
  if ("ai_study_sets" in rows) out.ai_study_sets = strip("ai_study_sets", { summary_origin: null, retired_json: "[]" });
  if ("material_bookmarks" in rows) out.material_bookmarks = strip("material_bookmarks", { quote: null });
  if ("practice_tests" in rows) out.practice_tests = strip("practice_tests", { retired_json: "[]" });
  if ("practice_test_items" in rows) out.practice_test_items = strip("practice_test_items", { logical_id: null, replaces_id: null });
  return out;
}
