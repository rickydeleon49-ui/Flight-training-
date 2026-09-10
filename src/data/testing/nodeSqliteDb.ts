/**
 * SqlDatabase backed by Node's built-in SQLite. Used by the test suite so
 * repositories are exercised against real SQLite — including foreign keys
 * and partial unique indexes — rather than a hand-written fake.
 */
import type { SqlDatabase, SqlValue } from "../db";
import { applyMigrations } from "../migrations";

export interface TestDatabase extends SqlDatabase {
  close(): void;
}

export async function createNodeSqliteDatabase(path = ":memory:"): Promise<TestDatabase> {
  // Keep this native-only module out of Vite's jsdom client transform. Node 22
  // supports it, but does not expose it through builtinModules for Vite to
  // recognize automatically.
  const nativeSqlite = "node:sqlite";
  const { DatabaseSync } = await import(/* @vite-ignore */ nativeSqlite);
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");

  // Reopening an existing file must skip the migrations it already has, the
  // same way the real drivers do; otherwise a second launch fails outright.
  const applied = new Set<number>();
  try {
    for (const row of db.prepare("SELECT version FROM schema_migrations").all()) {
      applied.add(Number((row as { version: number }).version));
    }
  } catch {
    // No migrations table yet — this is a fresh database.
  }

  await applyMigrations((sql) => db.exec(sql), applied);

  return {
    async select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },
    async execute(sql: string, params: SqlValue[] = []): Promise<void> {
      db.prepare(sql).run(...params);
    },
    close() {
      db.close();
    },
  };
}
