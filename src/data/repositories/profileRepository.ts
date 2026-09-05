import { nowIso } from "@/lib/dates";
import { ACCENT_LABELS, type AccentColor, type Profile } from "@/domain/types";
import { toEnum, toNullableText, toText, type SqlDatabase } from "../db";

const PROFILE_ID = "profile";

interface Row {
  id: string;
  pilot_name: unknown;
  certificate_goal: unknown;
  current_focus: unknown;
  current_milestone_id: unknown;
  flight_school: unknown;
  instructor_name: unknown;
  home_airport: unknown;
  aircraft_type: unknown;
  training_started_on: unknown;
  medical_expiry: unknown;
  why_note: unknown;
  photo: unknown;
  accent_color: unknown;
  created_at: unknown;
  updated_at: unknown;
}

const map = (row: Row): Profile => ({
  id: row.id,
  pilotName: toText(row.pilot_name),
  certificateGoal: toText(row.certificate_goal),
  currentFocus: toText(row.current_focus),
  currentMilestoneId: toNullableText(row.current_milestone_id),
  flightSchool: toText(row.flight_school),
  instructorName: toText(row.instructor_name),
  homeAirport: toText(row.home_airport),
  aircraftType: toText(row.aircraft_type),
  trainingStartedOn: toNullableText(row.training_started_on),
  medicalExpiry: toNullableText(row.medical_expiry),
  whyNote: toText(row.why_note),
  photo: toNullableText(row.photo),
  accentColor: toEnum<AccentColor>(row.accent_color, ACCENT_LABELS, "berry"),
  createdAt: toText(row.created_at),
  updatedAt: toText(row.updated_at),
});

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

    async update(
      changes: Partial<Omit<Profile, "id" | "createdAt" | "updatedAt">>,
    ): Promise<void> {
      const next = { ...(await this.get()), ...changes };
      await db.execute(
        `UPDATE settings
            SET pilot_name = ?, certificate_goal = ?, current_focus = ?,
                current_milestone_id = ?, flight_school = ?, instructor_name = ?,
                home_airport = ?, aircraft_type = ?, training_started_on = ?,
                medical_expiry = ?, why_note = ?, photo = ?, accent_color = ?,
                updated_at = ?
          WHERE id = ?`,
        [
          next.pilotName, next.certificateGoal, next.currentFocus,
          next.currentMilestoneId, next.flightSchool, next.instructorName,
          next.homeAirport, next.aircraftType, next.trainingStartedOn,
          next.medicalExpiry, next.whyNote, next.photo, next.accentColor,
          nowIso(), PROFILE_ID,
        ],
      );
    },
  };
}
