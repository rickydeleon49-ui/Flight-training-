/**
 * Chooses the storage driver for the current environment.
 *
 * Inside the desktop shell this is always real SQLite through Tauri. In a
 * plain browser it falls back to the WebAssembly build so the interface can
 * be developed without a Rust toolchain.
 */
import type { SqlDatabase } from "./db";

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let connection: Promise<SqlDatabase> | null = null;

export function getDatabase(): Promise<SqlDatabase> {
  if (!connection) {
    connection = isTauri()
      ? import("./tauriDb").then((m) => m.createTauriDatabase())
      : import("./sqlJsDb").then((m) => m.createSqlJsDatabase());
  }
  return connection;
}

/** Test seam: lets suites install an in-memory database. */
export function __setDatabase(db: Promise<SqlDatabase> | null): void {
  connection = db;
}
