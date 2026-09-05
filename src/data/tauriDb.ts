/**
 * SQLite through Tauri's SQL plugin — the real desktop database.
 *
 * The file lives in the application data directory chosen by Tauri, never
 * inside the project, so private training data is never near the repository.
 */
import Database from "@tauri-apps/plugin-sql";

import { toNumberedPlaceholders, type SqlDatabase, type SqlValue } from "./db";

const DB_URL = "sqlite:her-flight-deck.db";

export async function createTauriDatabase(): Promise<SqlDatabase> {
  // Migrations were registered in Rust and run as part of this load().
  const db = await Database.load(DB_URL);

  // Foreign keys are off by default in SQLite and must be enabled per
  // connection, otherwise our ON DELETE rules silently do nothing.
  await db.execute("PRAGMA foreign_keys = ON");

  return {
    async select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return db.select<T[]>(toNumberedPlaceholders(sql), params);
    },
    async execute(sql: string, params: SqlValue[] = []): Promise<void> {
      await db.execute(toNumberedPlaceholders(sql), params);
    },
  };
}
