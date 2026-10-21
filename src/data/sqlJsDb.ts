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
 * see the same data.
 *
 * Initialization contract: migrations, legacy practice-test conversion and
 * whole-database validation (`practiceStateValidation.ts`) run on the one
 * connection, with conversion and validation in a single transaction, before
 * anything is stored or the adapter exists. Startup succeeds only when
 * validation passes and the result is in localStorage. On any failure the
 * handle is discarded, localStorage keeps its previous bytes untouched, no
 * adapter is returned, and a later start retries from those same bytes.
 *
 * Connection invariant: `foreign_keys` is per connection, and sql.js resets
 * it whenever a connection is created or `export()` reopens one. Every such
 * point (initial open, every export, and recovery from the last stored bytes)
 * goes through `initializeConnection`, which switches it on and verifies it.
 * Recovery that cannot re-establish it disables the adapter
 * (`DatabaseDisabledError`) rather than continue without foreign keys.
 *
 * The pre-operation snapshot of the Slice B design is `lastStored`: every
 * write is durable or undone, so between operations the live database always
 * equals those bytes, and they are what a failed write is restored from.
 */
import initSqlJs, { type Database as SqlJsDatabaseHandle } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

import { createConnectionOwner, refuseTransactionControl, rollbackIfOpen } from "./connectionOwner";
import { applyMigrations } from "./migrations";
import { executeLegacyConversion } from "./practiceSessionTransaction";
import { validateApplicationDatabase } from "./practiceStateValidation";
import type { SqlDatabase, SqlValue } from "./db";
import { DatabaseDisabledError, StorageDurabilityError } from "./persistenceErrors";

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

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Switch foreign keys on for this connection and prove they are on. Runs after
 * every point that creates or reopens a connection; throws if it cannot.
 */
export function initializeConnection(db: SqlJsDatabaseHandle): void {
  db.run("PRAGMA foreign_keys = ON");
  const result = db.exec("PRAGMA foreign_keys");
  if (result[0]?.values[0]?.[0] !== 1) {
    throw new Error("Connection invariant violation: PRAGMA foreign_keys could not be enabled.");
  }
}

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJs>>;

/**
 * An in-memory database built from the registered migrations: the schema
 * reference initialization validation compares against. Read-only use.
 */
async function createReference(SQL: SqlJsStatic) {
  const handle = new SQL.Database();
  await applyMigrations((sql) => handle.run(sql), new Set());
  return {
    query: (sql: string, params: SqlValue[]): Record<string, unknown>[] => {
      const statement = handle.prepare(sql);
      try {
        statement.bind(params as never);
        const rows: Record<string, unknown>[] = [];
        while (statement.step()) rows.push(statement.getAsObject());
        return rows;
      } finally {
        statement.free();
      }
    },
    close: () => handle.close(),
  };
}

export async function createSqlJsDatabase(): Promise<SqlDatabase> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });

  const open = (bytes: Uint8Array | null): SqlJsDatabaseHandle => {
    const handle = bytes ? new SQL.Database(bytes) : new SQL.Database();
    try {
      initializeConnection(handle);
    } catch (error) {
      handle.close();
      throw error;
    }
    return handle;
  };
  /** The previous durable bytes; initialization never overwrites them unless it succeeds. */
  const saved = loadSaved();
  let db = open(saved);

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


  /**
   * sql.js `export()` closes and reopens the connection: it silently rolls
   * back an open transaction and resets per-connection settings such as
   * foreign keys. It is only ever called inside the connection owner, between
   * operations, and the connection is initialized again straight away.
   */
  const exportBytes = (): Uint8Array => {
    const bytes = db.export();
    initializeConnection(db);
    return bytes;
  };

  /**
   * Initialization (see the contract above): migrate, then convert and
   * validate on one transaction, then store. Any failure discards the handle
   * without touching localStorage, so no adapter is ever exposed over an
   * unvalidated or unsaved state.
   */
  let lastStored: Uint8Array;
  try {
    const applied = new Set<number>();
    try {
      const result = db.exec("SELECT version FROM schema_migrations");
      for (const row of result[0]?.values ?? []) applied.add(Number(row[0]));
    } catch {
      // No migrations table yet — this is a fresh database.
    }
    await applyMigrations((sql) => db.run(sql), applied);

    const reference = await createReference(SQL);
    try {
      await executeLegacyConversion(exec, run, query, undefined, () =>
        validateApplicationDatabase(query, reference.query),
      );
    } finally {
      reference.close();
    }

    lastStored = exportBytes();
    if (!saved || !sameBytes(saved, lastStored)) {
      try {
        store(lastStored);
      } catch (storageError) {
        throw new StorageDurabilityError(
          "Browser storage refused the prepared database, so nothing was changed. Free some browser storage and reload.",
          { cause: storageError },
        );
      }
    }
  } catch (error) {
    try {
      db.close();
    } catch {
      // Handle might already be closed or invalid
    }
    throw error;
  }

  let connectionBroken: DatabaseDisabledError | null = null;

  /**
   * Put the live database back to the last stored bytes. The restored handle
   * is initialized before it replaces the old one; if that fails the adapter
   * is disabled and every later call is refused.
   */
  const restoreLastStored = (): void => {
    let restored: SqlJsDatabaseHandle;
    try {
      restored = open(lastStored);
    } catch (error) {
      connectionBroken = new DatabaseDisabledError({ cause: error });
      try {
        db.close();
      } catch {
        // Handle might already be closed or invalid
      }
      throw connectionBroken;
    }
    try {
      db.close();
    } catch {
      // Handle might already be closed or invalid
    }
    db = restored;
  };

  /**
   * Run a write; succeed only once its result is in storage, otherwise undo it.
   * `durabilityError`, when given, replaces an error from the export, encoding
   * or storage step (after the undo), so a caller can type that failure.
   */
  const durableWrite = async <T>(
    work: () => Promise<T> | T,
    durabilityError?: (cause: unknown) => Error,
  ): Promise<T> => {
    if (connectionBroken) throw connectionBroken;
    let result: T;
    try {
      result = await work();
    } catch (error) {
      restoreLastStored();
      throw error;
    }
    try {
      const bytes = exportBytes();
      const encoded = encodeBytes(bytes);
      try {
        localStorage.setItem(STORAGE_KEY, encoded);
      } catch (storageError) {
        throw new StorageDurabilityError(
          "Browser storage refused this change, so it was undone and nothing was saved. Free some browser storage and try again.",
          { cause: storageError },
        );
      }
      lastStored = bytes;
      return result;
    } catch (error) {
      restoreLastStored();
      throw durabilityError ? durabilityError(error) : error;
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
    /**
     * Slice B import: one owned operation, one immediate transaction, then the
     * durable export. A storage or export failure after the commit restores
     * the last stored bytes and reports `StorageDurabilityError`, so a retry
     * with the same id saves afresh rather than reporting `already_saved`.
     */
    saveStructuredImportAtomically(
      operation: import("./db").StructuredImportSaveOperation,
    ): Promise<import("./db").NativeImportSaveResult> {
      return owner.exclusive(() =>
        durableWrite(
          async () => {
            const { executeStructuredImport } = await import("./structuredImportTransaction");
            return executeStructuredImport(exec, run, query, operation);
          },
          (cause) =>
            new StorageDurabilityError(
              "The study packet could not be saved to browser storage, so nothing was saved. Free some browser storage and try again.",
              { cause },
            ),
        ),
      );
    },
    savePracticeSessionAtomically(
      action: import("@/domain/types").PracticeSessionAction,
    ): Promise<import("@/domain/types").PracticeSessionActionResult> {
      return owner.exclusive(() =>
        durableWrite(async () => {
          const { executePracticeSessionAction } = await import("./practiceSessionTransaction");
          return executePracticeSessionAction(exec, run, query, action);
        }),
      );
    },
    savePracticeAuthoringAtomically(
      operation: import("@/domain/types").PracticeSaveOperation,
    ): Promise<import("@/domain/types").PracticeSaveResult> {
      return owner.exclusive(() =>
        durableWrite(
          async () => {
            const { executePracticeAuthoring } = await import("./practiceAuthoring");
            return executePracticeAuthoring(exec, run, query, operation);
          },
          (cause) =>
            new StorageDurabilityError(
              "The browser storage refused the committed practice save; the live database was restored.",
              { cause },
            ),
        ),
      );
    },
    saveHomeworkAtomically(operation) {
      return owner.exclusive(() => durableWrite(async () => {
        const { executeHomeworkOperation } = await import("./homeworkTransaction");
        return executeHomeworkOperation(exec, run, query, operation);
      }, (cause) => new StorageDurabilityError("Homework could not be saved to browser storage, so nothing was saved.", { cause })));
    },
    saveStudySetAtomically(
      operation: import("./studySetTransaction").StudySetSaveOperation,
    ): Promise<import("./studySetTransaction").StudySetSaveResult> {
      return owner.exclusive(() =>
        durableWrite(
          async () => {
            const { executeStudySetSave } = await import("./studySetTransaction");
            return executeStudySetSave(exec, run, query, operation);
          },
          (cause) =>
            new StorageDurabilityError(
              "The study set could not be saved to browser storage, so nothing was saved. Free some browser storage and try again.",
              { cause },
            ),
        ),
      );
    },
    erasePracticeHistoryAtomically(
      action: import("@/domain/types").EraseHistoryAction,
    ): Promise<import("@/domain/types").EraseHistoryResult> {
      return owner.exclusive(() =>
        durableWrite(async () => {
          const { executeEraseHistoryAction } = await import("./practiceSessionTransaction");
          return executeEraseHistoryAction(exec, run, query, action);
        }),
      );
    },
    saveCardReviewAtomically(
      action: import("@/domain/types").CardReviewAction,
    ): Promise<import("@/domain/types").CardReviewResult> {
      return owner.exclusive(() =>
        durableWrite(async () => {
          const { executeCardReviewAction } = await import("./cardReviewTransaction");
          return executeCardReviewAction(exec, run, query, action);
        }),
      );
    },
    /** Reads only: owned like every other call, never exported or stored. */
    readLibraryReviewDue(
      input: import("@/domain/types").LibraryReviewDueInput,
    ): Promise<import("@/domain/types").LibraryReviewDueResult> {
      return owner.exclusive(async () => {
        if (connectionBroken) throw connectionBroken;
        const { readLibraryReviewDue } = await import("./cardLibraryReader");
        return readLibraryReviewDue(query, input);
      });
    },
    readLibraryRecentReviews(
      input: import("@/domain/types").LibraryRecentReviewsInput,
    ): Promise<import("@/domain/types").LibraryRecentReviewsResult> {
      return owner.exclusive(async () => {
        if (connectionBroken) throw connectionBroken;
        const { readLibraryRecentReviews } = await import("./cardLibraryReader");
        return readLibraryRecentReviews(query, input);
      });
    },
    saveSkillEvidenceAtomically(
      action: import("@/domain/types").SkillEvidenceAction,
    ): Promise<import("@/domain/types").SkillEvidenceOutcome> {
      return owner.exclusive(() =>
        durableWrite(async () => {
          const { executeSkillEvidenceAction } = await import("./skillEvidenceTransaction");
          return executeSkillEvidenceAction(exec, run, query, action);
        }),
      );
    },
    /** Skill-evidence reads: owned like every other call, never exported or stored. */
    readSkillEvidencePage(input: import("@/domain/types").EvidencePageInput) {
      return owner.exclusive(async () => {
        if (connectionBroken) throw connectionBroken;
        const { readEvidencePage } = await import("./skillEvidenceReader");
        return readEvidencePage(query, input);
      });
    },
    readSkillSummary(skillId: string) {
      return owner.exclusive(async () => {
        if (connectionBroken) throw connectionBroken;
        const { readSkillSummary } = await import("./skillEvidenceReader");
        return readSkillSummary(query, skillId);
      });
    },
    listSkills(options: { includeRetired?: boolean }) {
      return owner.exclusive(async () => {
        if (connectionBroken) throw connectionBroken;
        const { listSkills } = await import("./skillEvidenceReader");
        return listSkills(query, options);
      });
    },
    readObservationHistory(input: import("@/domain/types").ObservationHistoryInput) {
      return owner.exclusive(async () => {
        if (connectionBroken) throw connectionBroken;
        const { readObservationHistory } = await import("./skillEvidenceReader");
        return readObservationHistory(query, input);
      });
    },
    /** Document navigation (M4). Reads stay in memory; every change is stored before it is acknowledged. */
    navigationOperation<K extends import("@/domain/types").NavigationOperation["kind"]>(
      operation: Extract<import("@/domain/types").NavigationOperation, { kind: K }>,
    ): Promise<import("@/domain/types").NavigationResultByKind[K]> {
      return owner.exclusive(async () => {
        if (connectionBroken) throw connectionBroken;
        const { executeNavigationOperation } = await import("./navigationTransaction");
        const work = () => executeNavigationOperation(exec, run, query, operation);
        const result = operation.kind === "read" ? await work() : await durableWrite(work);
        return result as import("@/domain/types").NavigationResultByKind[K];
      });
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
