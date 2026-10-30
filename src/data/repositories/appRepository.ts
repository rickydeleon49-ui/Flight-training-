import type { SqlDatabase } from "../db";
import {
  parseDailyPlanState,
  serializeDailyPlanState,
  type DailyPlanState,
} from "@/logic/dailyPlan";

/** When the last complete backup was saved, and what wrote it. */
export interface LastCompleteBackup {
  /** ISO timestamp. */
  at: string;
  /** The app version that wrote it. */
  version: string;
  /** Where it was saved, so the interface can show her the file. */
  path: string;
}

const LAST_BACKUP_AT = "last_complete_backup_at";
const LAST_BACKUP_VERSION = "last_complete_backup_version";
const LAST_BACKUP_PATH = "last_complete_backup_path";
const DAILY_PLAN_KEY = "daily_plan_session";

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

    /**
     * Fold committed WAL pages into the main file before a portable backup.
     *
     * SQLite writes into a separate log first, so the database file on its own
     * can be missing everything she did today. A blocked checkpoint is reported
     * rather than swallowed: a backup that quietly omits her latest lesson is
     * worse than one she is told to retry.
     */
    async checkpoint(): Promise<void> {
      const rows = await db.select<{ busy?: number }>("PRAGMA wal_checkpoint(TRUNCATE)");
      if (Number(rows[0]?.busy ?? 0) !== 0) {
        throw new Error(
          "The database was busy, so the backup was stopped rather than saved incomplete. Close any other window and try again.",
        );
      }
      await db.persist?.();
    },

    /** Remember that a complete backup was saved, so staleness can be shown. */
    async recordCompleteBackup(backup: LastCompleteBackup): Promise<void> {
      // One statement, so time, version and path are written together or not at all.
      await db.execute(
        `INSERT INTO app_metadata (key, value) VALUES (?, ?), (?, ?), (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [LAST_BACKUP_AT, backup.at, LAST_BACKUP_VERSION, backup.version, LAST_BACKUP_PATH, backup.path],
      );
    },

    /** The last complete backup she saved, or null if there has never been one. */
    async lastCompleteBackup(): Promise<LastCompleteBackup | null> {
      const at = await this.get(LAST_BACKUP_AT);
      if (!at) return null;
      return {
        at,
        version: (await this.get(LAST_BACKUP_VERSION)) ?? "",
        path: (await this.get(LAST_BACKUP_PATH)) ?? "",
      };
    },

    /** Get the persisted daily plan session state, or null if none saved. */
    async getDailyPlanState(): Promise<DailyPlanState | null> {
      const raw = await this.get(DAILY_PLAN_KEY);
      return parseDailyPlanState(raw);
    },

    /** Persist the daily plan session state to app_metadata. */
    async setDailyPlanState(state: DailyPlanState): Promise<void> {
      await this.set(DAILY_PLAN_KEY, serializeDailyPlanState(state));
    },
  };
}
