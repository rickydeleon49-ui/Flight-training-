/**
 * Disposable engines for the M3 prototype: real node:sqlite and real sql.js
 * connections, migrated with the SHIPPED registry (0001-0013, imported from
 * src/data/migrations.ts unchanged) and then, when asked, the candidate 0014
 * from this evidence pack. Nothing here touches the production registry.
 *
 * Each store serializes its calls through the production ConnectionOwner,
 * exactly as the TS drivers do.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { createConnectionOwner, rollbackIfOpen } from "@/data/connectionOwner";
import type { SqlValue } from "@/data/db";
import { MIGRATIONS, applyMigrations } from "@/data/migrations";
import type { ValidationQuery } from "@/data/practiceStateValidation";

import candidateSql from "../candidate/0014_skills_evidence.sql?raw";
import { listSkills, readEvidencePage, readObservationHistory, readSkillSummary } from "./skillEvidenceReader";
import { executeSkillEvidenceAction, type TransactionOptions } from "./skillEvidenceTransaction";
import { CANDIDATE_VERSION, validateCandidateDatabase } from "./skillEvidenceValidation";
import type { EvidencePageInput, ObservationHistoryInput, SkillEvidenceOutcome } from "./types";

export const CANDIDATE_SQL: string = candidateSql;
export const WASM = `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;

export type EngineName = "node:sqlite" | "sql.js";

export interface Engine {
  name: EngineName;
  exec(sql: string): void;
  run(sql: string, params: SqlValue[]): void;
  query(sql: string, params?: SqlValue[]): Record<string, unknown>[];
  /** Test-only fault seam, awaited before data statements inside the store. */
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

/** Shipped migrations (always), then the candidate when `candidate` is set. */
export async function migrate(engine: Engine, options: { candidate: boolean; candidateSql?: string }): Promise<void> {
  const applied = appliedVersions(engine);
  await applyMigrations((sql) => engine.exec(sql), applied);
  if (options.candidate && !applied.has(CANDIDATE_VERSION)) {
    engine.exec("BEGIN IMMEDIATE");
    try {
      engine.exec(options.candidateSql ?? CANDIDATE_SQL);
      engine.run("INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, 'skills_evidence', ?)", [
        CANDIDATE_VERSION,
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
}

let reference: Promise<ValidationQuery> | null = null;

/** Registered migrations + candidate 0014, built once, read-only. */
export function candidateReference(): Promise<ValidationQuery> {
  reference ??= (async () => {
    const engine = await openNodeEngine();
    await migrate(engine, { candidate: true });
    return (sql: string, params: SqlValue[]) => engine.query(sql, params);
  })();
  return reference;
}

export const SHIPPED_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));

export interface CandidateStore {
  engine: Engine;
  act(action: unknown, options?: TransactionOptions): Promise<SkillEvidenceOutcome>;
  page(input?: EvidencePageInput): ReturnType<typeof readEvidencePage>;
  summary(skillId: string): ReturnType<typeof readSkillSummary>;
  skills(options?: { includeRetired?: boolean }): ReturnType<typeof listSkills>;
  /** One bounded page of an observation's history (newest first; follow nextCursor to revision 1). */
  history(input: ObservationHistoryInput): ReturnType<typeof readObservationHistory>;
  validate(): Promise<void>;
}

/** A candidate-binary store over an engine: migrate, validate, then serve. */
export async function openCandidateStore(engine: Engine, options: { migrate?: boolean } = {}): Promise<CandidateStore> {
  if (options.migrate !== false) await migrate(engine, { candidate: true });
  const ref = await candidateReference();
  const q = (sql: string, params: SqlValue[]) => engine.query(sql, params);
  await validateCandidateDatabase(q, ref);
  const owner = createConnectionOwner(() => rollbackIfOpen((sql) => engine.exec(sql)));
  return {
    engine,
    act: (action, opts) =>
      owner.exclusive(() => executeSkillEvidenceAction((sql) => engine.exec(sql), (sql, p) => engine.run(sql, p), q, action, opts)),
    page: (input = {}) => owner.exclusive(() => readEvidencePage(q, input)),
    summary: (skillId) => owner.exclusive(() => readSkillSummary(q, skillId)),
    skills: (opts) => owner.exclusive(() => listSkills(q, opts)),
    history: (input) => owner.exclusive(() => readObservationHistory(q, input)),
    validate: () => owner.exclusive(() => validateCandidateDatabase(q, ref)),
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
