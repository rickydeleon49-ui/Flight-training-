/**
 * SqlDatabase backed by Node's built-in SQLite. Used by the test suite so
 * repositories are exercised against real SQLite — including foreign keys
 * and partial unique indexes — rather than a hand-written fake.
 */
import { DatabaseSync } from "node:sqlite";

import type { SqlDatabase, SqlValue } from "../db";
import { applyMigrations } from "../migrations";

export interface TestDatabase extends SqlDatabase {
  close(): void;
}

export async function createNodeSqliteDatabase(path = ":memory:"): Promise<TestDatabase> {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");

  await applyMigrations((sql) => db.exec(sql), new Set());

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
