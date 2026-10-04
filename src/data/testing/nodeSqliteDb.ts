/**
 * SqlDatabase backed by Node's built-in SQLite. Used by the test suite so
 * repositories are exercised against real SQLite — including foreign keys
 * and partial unique indexes — rather than a hand-written fake.
 *
 * It holds one connection, so every public method runs through a
 * `ConnectionOwner` (see `connectionOwner.ts`), exactly like the sql.js
 * browser driver.
 */
import type { SqlDatabase, SqlValue } from "../db";
import { createConnectionOwner, refuseTransactionControl, rollbackIfOpen } from "../connectionOwner";
import { executeDebriefSave } from "../debriefTransaction";
import { executeMaterialSave, executeMaterialsBatch } from "../materialTransaction";
import { applyMigrations } from "../migrations";

export interface TestDatabase extends SqlDatabase {
  close(): void;
  /**
   * Test-only fault seam: awaited before every data statement — public
   * `execute` and the statements inside the atomic saves — so a test can fail
   * or pause one specific write. Transaction control and reads are not routed
   * through it. This driver is never used by the app.
   */
  beforeStatement?: (sql: string, params: SqlValue[]) => void | Promise<void>;
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

  // Raw statements for use inside an owned operation only.
  const exec = (sql: string): void => {
    db.exec(sql);
  };
  const run = async (sql: string, params: SqlValue[]): Promise<void> => {
    await testDb.beforeStatement?.(sql, params);
    db.prepare(sql).run(...params);
  };
  const query = (sql: string, params: SqlValue[]) =>
    db.prepare(sql).all(...params) as Record<string, unknown>[];

  const owner = createConnectionOwner(() => rollbackIfOpen(exec));

  const testDb: TestDatabase = {
    select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return owner.exclusive(() => {
        refuseTransactionControl(sql);
        return query(sql, params) as T[];
      });
    },
    execute(sql: string, params: SqlValue[] = []): Promise<void> {
      return owner.exclusive(() => {
        refuseTransactionControl(sql);
        return run(sql, params);
      });
    },
    saveDebriefAtomically(operation: import("../db").DebriefSaveOperation): Promise<void> {
      return owner.exclusive(() =>
        executeDebriefSave(
          exec,
          run,
          (sql, params) => Boolean(db.prepare(sql).get(...params)),
          operation,
        ),
      );
    },
    saveMaterialAtomically(
      operation: import("../db").MaterialSaveOperation,
    ): Promise<import("@/domain/types").StudyMaterial> {
      return owner.exclusive(() => executeMaterialSave(exec, run, query, operation));
    },
    saveMaterialsAtomically(materials: import("@/domain/types").StudyMaterial[]): Promise<void> {
      return owner.exclusive(() => executeMaterialsBatch(exec, run, query, materials));
    },
    close() {
      db.close();
    },
  };
  return testDb;
}
