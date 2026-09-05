import { nowIso } from "@/lib/dates";
import type { Profile } from "@/domain/types";
import { toText, type SqlDatabase } from "../db";

const PROFILE_ID = "profile";

interface Row {
  id: string;
  pilot_name: unknown;
  certificate_goal: unknown;
  current_focus: unknown;
  current_milestone_id: unknown;
  created_at: unknown;
  updated_at: unknown;
}

const map = (row: Row): Profile => ({
  id: row.id,
  pilotName: toText(row.pilot_name),
  certificateGoal: toText(row.certificate_goal),
  currentFocus: toText(row.current_focus),
  currentMilestoneId: row.current_milestone_id ? String(row.current_milestone_id) : null,
  createdAt: toText(row.created_at),
  updatedAt: toText(row.updated_at),
});

/** Profile is a single row; it is created on first run if absent. */
export function profileRepository(db: SqlDatabase) {
  return {
    /**
     * Read the profile, creating it on first run.
     *
     * The insert is idempotent because two callers can reach this at once
     * (React re-running an effect, or two screens loading together) and both
     * would otherwise try to create the same row.
     */
    async get(): Promise<Profile> {
      const timestamp = nowIso();
      await db.execute(
        `INSERT INTO settings (id, pilot_name, certificate_goal, current_focus,
           current_milestone_id, created_at, updated_at)
         VALUES (?, '', 'Private Pilot', '', NULL, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [PROFILE_ID, timestamp, timestamp],
      );

      const rows = await db.select<Row>("SELECT * FROM settings WHERE id = ?", [PROFILE_ID]);
      const profile = rows[0];
      if (!profile) throw new Error("The profile record could not be created.");
      return map(profile);
    },

    async update(changes: Partial<Omit<Profile, "id" | "createdAt" | "updatedAt">>): Promise<void> {
      const current = await this.get();
      const next = { ...current, ...changes };
      await db.execute(
        `UPDATE settings
            SET pilot_name = ?, certificate_goal = ?, current_focus = ?,
                current_milestone_id = ?, updated_at = ?
          WHERE id = ?`,
        [
          next.pilotName,
          next.certificateGoal,
          next.currentFocus,
          next.currentMilestoneId,
          nowIso(),
          PROFILE_ID,
        ],
      );
    },
  };
}
