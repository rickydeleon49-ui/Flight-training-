/**
 * SQLite through Tauri's SQL plugin — the real desktop database.
 *
 * The file lives in the application data directory chosen by Tauri, never
 * inside the project, so private training data is never near the repository.
 */
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import type { StudyMaterial } from "@/domain/types";

import {
  toNumberedPlaceholders,
  type NativeImportSaveResult,
  type SqlDatabase,
  type SqlValue,
  type StructuredImportSaveOperation,
} from "./db";
import { IMPORT_SAVE_MESSAGES, isImportSaveErrorCode, StructuredImportSaveError } from "./persistenceErrors";

const DB_URL = "sqlite:her-flight-deck.db";

/**
 * Invoke the native structured-import save and accept only its allowlisted
 * outcomes. A refusal is recognized only when it is exactly one native code
 * with its fixed message; anything else (an outer invoke failure, a rejected
 * envelope, an unexpected result) becomes `IPC_TRANSPORT_ERROR` and is never
 * shown raw.
 */
export async function invokeStructuredImportSave(
  operation: StructuredImportSaveOperation,
  call: typeof invoke = invoke,
): Promise<NativeImportSaveResult> {
  let result: unknown;
  try {
    result = await call("save_structured_study_material_atomically", { operation });
  } catch (rejection) {
    const { code, message } = (rejection ?? {}) as { code?: unknown; message?: unknown };
    if (
      isImportSaveErrorCode(code) &&
      code !== "IPC_TRANSPORT_ERROR" &&
      message === IMPORT_SAVE_MESSAGES[code]
    ) {
      throw new StructuredImportSaveError(code);
    }
    throw new StructuredImportSaveError("IPC_TRANSPORT_ERROR", { cause: rejection });
  }
  const { status, materialId } = (result ?? {}) as { status?: unknown; materialId?: unknown };
  if ((status === "saved" || status === "already_saved") && materialId === operation.materialId) {
    return { status, materialId };
  }
  throw new StructuredImportSaveError("IPC_TRANSPORT_ERROR");
}

export async function createTauriDatabase(): Promise<SqlDatabase> {
  // Migrations were registered in Rust and run as part of this load().
  const db = await Database.load(DB_URL);

  // Foreign keys are off by default in SQLite and must be enabled per
  // connection, otherwise our ON DELETE rules silently do nothing.
  await db.execute("PRAGMA foreign_keys = ON");

  // The Rust SQL plugin opens a small pool of connections to this one file.
  // Without WAL, any write holds a lock that blocks *every* reader too, so a
  // slow write (a multi-part PDF split saving its records, a backup snapshot
  // reading it) and an unrelated autosave can collide as "database is locked"
  // even though neither is doing anything wrong. WAL lets readers proceed
  // alongside a single writer, which is what actually removes that
  // contention — it is a property of the database file itself, not of this
  // one connection, so setting it once here is enough for the whole pool and
  // for every future launch. `busy_timeout` is *not* set here: it is
  // per-connection, so doing it through one pooled connection would not
  // reach the others — sqlx's own default of five seconds already applies to
  // every connection the pool opens (see `SqliteConnectOptions::default()`),
  // and `documentRepository.createMany`'s retry exists for the case where
  // even that is not enough.
  //
  // Best-effort: a database still on the old journal mode elsewhere (another
  // running instance, an unusual filesystem) should not stop this one from
  // starting.
  try {
    // `journal_mode` is a query, not a plain statement — it hands back the
    // mode it ended up in, even when setting it — so this goes through
    // `select`, the same way `wal_checkpoint` already does elsewhere.
    await db.select("PRAGMA journal_mode = WAL");
  } catch {
    // Nothing to do — the database still works, just with more contention.
  }

  return {
    async saveMaterialsAtomically(materials: StudyMaterial[]): Promise<void> {
      await invoke("save_split_materials", { materials });
    },
    async saveDebriefAtomically(operation: import("./db").DebriefSaveOperation): Promise<void> {
      await invoke("save_debrief_operation", { operation });
    },
    async saveMaterialAtomically(
      operation: import("./db").MaterialSaveOperation,
    ): Promise<StudyMaterial> {
      return invoke<StudyMaterial>("save_material_operation", { operation });
    },
    saveStructuredImportAtomically(
      operation: StructuredImportSaveOperation,
    ): Promise<NativeImportSaveResult> {
      return invokeStructuredImportSave(operation);
    },
    async select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return db.select<T[]>(toNumberedPlaceholders(sql), params);
    },
    async execute(sql: string, params: SqlValue[] = []): Promise<void> {
      await db.execute(toNumberedPlaceholders(sql), params);
    },
  };
}
