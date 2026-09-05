import type { SqlDatabase } from "../db";

/** Product-level metadata that is not part of her personal training record. */
export function appRepository(db: SqlDatabase) {
  return {
    async get(key: string): Promise<string | null> {
      const rows = await db.select<{ value: string }>(
        "SELECT value FROM app_metadata WHERE key = ?",
        [key],
      );
      return rows[0]?.value ?? null;
    },

    async set(key: string, value: string): Promise<void> {
      await db.execute(
        `INSERT INTO app_metadata (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [key, value],
      );
    },

    /** Fold committed WAL pages into the main file before a portable backup. */
    async checkpoint(): Promise<void> {
      await db.select("PRAGMA wal_checkpoint(TRUNCATE)");
      await db.persist?.();
    },
  };
}
