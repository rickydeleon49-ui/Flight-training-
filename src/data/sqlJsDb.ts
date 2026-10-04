/**
 * SQLite compiled to WebAssembly, for running the app in a plain browser.
 *
 * This exists so the interface can be developed and reviewed with `npm run
 * dev` without a Rust toolchain. It is not the product's storage: the
 * desktop app always uses the Tauri driver. Data is kept in localStorage and
 * is explicitly development-only.
 *
 * Durability contract (browser only): a write reports success only after the
 * whole database, including that write, is in localStorage. If storage
 * refuses it (quota, private mode), the write reports failure, localStorage
 * keeps its previous bytes, and the live in-memory database is put back to
 * the last state that was stored, so the screen, a retry and a reload all
 * see the same data. The one gap: if storage already failed while the app
 * was starting, the live database is ahead of what a reload would find until
 * the next successful write.
 */
import initSqlJs, { type Database as SqlJsDatabaseHandle } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

import { createConnectionOwner, refuseTransactionControl, rollbackIfOpen } from "./connectionOwner";
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

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}

/** Write the bytes to localStorage; throws if storage refuses them. */
function store(bytes: Uint8Array): void {
  localStorage.setItem(STORAGE_KEY, encodeBytes(bytes));
}

export async function createSqlJsDatabase(): Promise<SqlDatabase> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });

  const open = (bytes: Uint8Array | null): SqlJsDatabaseHandle => {
    const handle = bytes ? new SQL.Database(bytes) : new SQL.Database();
    handle.run("PRAGMA foreign_keys = ON");
    return handle;
  };
  let db = open(loadSaved());

  const applied = new Set<number>();
  try {
    const result = db.exec("SELECT version FROM schema_migrations");
    for (const row of result[0]?.values ?? []) applied.add(Number(row[0]));
  } catch {
    // No migrations table yet — this is a fresh database.
  }
  await applyMigrations((sql) => db.run(sql), applied);

  /**
   * sql.js `export()` closes and reopens the connection: it silently rolls
   * back an open transaction and resets per-connection settings such as
   * foreign keys. It is only ever called inside the connection owner, between
   * operations, and foreign keys are switched straight back on.
   */
  const exportBytes = (): Uint8Array => {
    const bytes = db.export();
    db.run("PRAGMA foreign_keys = ON");
    return bytes;
  };

  /** The last database state known to match storage (or startup, see above). */
  let lastStored = exportBytes();
  try {
    store(lastStored);
  } catch (error) {
    console.warn("Development database could not be saved.", error);
  }

  let connectionBroken: Error | null = null;

  const restoreLastStored = (): void => {
    try {
      try {
        db.close();
      } catch {
        // Handle might already be closed or invalid
      }
      db = open(lastStored);
    } catch (error) {
      connectionBroken = new Error(
        "The local database connection could not be returned to a safe state. Reload the app before making more changes.",
        { cause: error },
      );
      throw connectionBroken;
    }
  };

  /** Run a write; succeed only once its result is in storage, otherwise undo it. */
  const durableWrite = async <T>(work: () => Promise<T> | T): Promise<T> => {
    if (connectionBroken) throw connectionBroken;
    let result: T;
    try {
      result = await work();
      const bytes = exportBytes();
      let encoded: string;
      try {
        encoded = encodeBytes(bytes);
      } catch (encodeError) {
        throw encodeError;
      }
      try {
        localStorage.setItem(STORAGE_KEY, encoded);
      } catch (storageError) {
        throw new Error(
          "Browser storage refused this change, so it was undone and nothing was saved. Free some browser storage and try again.",
          { cause: storageError },
        );
      }
      lastStored = bytes;
      return result;
    } catch (error) {
      restoreLastStored();
      throw error;
    }
  };

  // Raw statements for use inside an owned operation only; `db` is read at
  // call time because a failed write replaces the handle.
  const exec = (sql: string): void => {
    db.run(sql);
  };
  const run = (sql: string, params: SqlValue[]): void => {
    db.run(sql, params as never);
  };
  const query = (sql: string, params: SqlValue[]): Record<string, unknown>[] => {
    const statement = db.prepare(sql);
    try {
      statement.bind(params as never);
      const rows: Record<string, unknown>[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  };

  const releaseAfterFailure = (): void => {
    if (connectionBroken) {
      throw connectionBroken;
    }
    rollbackIfOpen(exec);
  };

  const owner = createConnectionOwner(releaseAfterFailure);

  return {
    select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return owner.exclusive(() => {
        refuseTransactionControl(sql);
        return query(sql, params) as T[];
      });
    },
    execute(sql: string, params: SqlValue[] = []): Promise<void> {
      return owner.exclusive(() => {
        refuseTransactionControl(sql);
        return durableWrite(() => {
          run(sql, params);
        });
      });
    },
    saveDebriefAtomically(operation: import("./db").DebriefSaveOperation): Promise<void> {
      return owner.exclusive(() =>
        durableWrite(async () => {
          const { executeDebriefSave } = await import("./debriefTransaction");
          await executeDebriefSave(
            exec,
            run,
            (sql, params) => query(sql, params).length > 0,
            operation,
          );
        }),
      );
    },
    saveMaterialAtomically(
      operation: import("./db").MaterialSaveOperation,
    ): Promise<import("@/domain/types").StudyMaterial> {
      return owner.exclusive(() =>
        durableWrite(async () => {
          const { executeMaterialSave } = await import("./materialTransaction");
          return executeMaterialSave(exec, run, query, operation);
        }),
      );
    },
    saveMaterialsAtomically(materials: import("@/domain/types").StudyMaterial[]): Promise<void> {
      return owner.exclusive(() =>
        durableWrite(async () => {
          const { executeMaterialsBatch } = await import("./materialTransaction");
          await executeMaterialsBatch(exec, run, query, materials);
        }),
      );
    },
    /** Every acknowledged write is already stored; this re-stores and reports failure. */
    persist(): Promise<void> {
      return owner.exclusive(() => {
        if (connectionBroken) throw connectionBroken;
        try {
          const bytes = exportBytes();
          const encoded = encodeBytes(bytes);
          localStorage.setItem(STORAGE_KEY, encoded);
          lastStored = bytes;
        } catch (error) {
          restoreLastStored();
          throw error;
        }
      });
    },
  };
}
