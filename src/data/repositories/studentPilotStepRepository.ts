import { nowIso } from "@/lib/dates";
import type { SqlDatabase } from "../db";

/** Saved ticks for the "Before you enroll" steps; one row per step she has touched. */
export function studentPilotStepRepository(db: SqlDatabase) {
  return {
    /** Ids of the steps currently ticked. */
    async listDone(): Promise<string[]> {
      const rows = await db.select<{ stepId: string }>(
        "SELECT step_id AS stepId FROM student_pilot_steps WHERE done_at IS NOT NULL ORDER BY step_id ASC", []);
      return rows.map((row) => row.stepId);
    },
    async setDone(stepId: string, done: boolean): Promise<void> {
      const timestamp = nowIso();
      await db.execute(`INSERT INTO student_pilot_steps (step_id, done_at, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(step_id) DO UPDATE SET done_at = excluded.done_at, updated_at = excluded.updated_at`,
      [stepId, done ? timestamp : null, timestamp]);
    },
    /** Adds ticks from an older version without un-ticking or overwriting anything already saved. */
    async importDone(stepIds: string[]): Promise<void> {
      const timestamp = nowIso();
      for (const stepId of stepIds) {
        await db.execute("INSERT OR IGNORE INTO student_pilot_steps (step_id, done_at, updated_at) VALUES (?, ?, ?)",
          [stepId, timestamp, timestamp]);
      }
    },
  };
}
