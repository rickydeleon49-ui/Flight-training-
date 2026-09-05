/**
 * SQLite compiled to WebAssembly, for running the app in a plain browser.
 *
 * This exists so the interface can be developed and reviewed with `npm run
 * dev` without a Rust toolchain. It is not the product's storage: the
 * desktop app always uses the Tauri driver. Data is kept in localStorage and
 * is explicitly development-only.
 */
import initSqlJs, { type Database as SqlJsDatabaseHandle } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

import { applyMigrations } from "./migrations";
import type { SqlDatabase, SqlValue } from "./db";

const STORAGE_KEY = "her-flight-deck.dev-database";

function loadSaved(): Uint8Array | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const binary = atob(saved);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    // A corrupt or oversized dev database should never block startup.
    return null;
  }
}

function save(db: SqlJsDatabaseHandle): void {
  try {
    const bytes = db.export();
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i] as number);
    }
    localStorage.setItem(STORAGE_KEY, btoa(binary));
  } catch (error) {
    console.warn("Development database could not be saved.", error);
  }
}

export async function createSqlJsDatabase(): Promise<SqlDatabase> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const saved = loadSaved();
  const db = saved ? new SQL.Database(saved) : new SQL.Database();

  db.run("PRAGMA foreign_keys = ON");

  const applied = new Set<number>();
  try {
    const result = db.exec("SELECT version FROM schema_migrations");
    for (const row of result[0]?.values ?? []) applied.add(Number(row[0]));
  } catch {
    // No migrations table yet — this is a fresh database.
  }
  await applyMigrations((sql) => db.run(sql), applied);
  save(db);

  return {
    async select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      const statement = db.prepare(sql);
      try {
        statement.bind(params as never);
        const rows: T[] = [];
        while (statement.step()) rows.push(statement.getAsObject() as T);
        return rows;
      } finally {
        statement.free();
      }
    },
    async execute(sql: string, params: SqlValue[] = []): Promise<void> {
      db.run(sql, params as never);
      save(db);
    },
    async persist() {
      save(db);
    },
  };
}
