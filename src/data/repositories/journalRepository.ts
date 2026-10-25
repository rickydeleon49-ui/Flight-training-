import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import type { Id, JournalEntry } from "@/domain/types";
import { toNullableNumber, toNullableText, toText, type SqlDatabase } from "../db";

interface Row {
  id: string; event_id: unknown; date: unknown; title: unknown; mission: unknown;
  aircraft_type: unknown; aircraft_id: unknown; departure_airport: unknown;
  arrival_airport: unknown; instructor_name: unknown; total_time: unknown;
  dual_received: unknown; solo_time: unknown; pic_time: unknown;
  cross_country_time: unknown; night_time: unknown; actual_instrument_time: unknown;
  simulated_instrument_time: unknown; day_landings: unknown; night_landings: unknown;
  practiced: unknown; went_well: unknown; was_difficult: unknown;
  instructor_feedback: unknown; questions_for_next_time: unknown; confidence: unknown;
  school_name: unknown; goal_id: unknown; created_at: unknown; updated_at: unknown;
}

function validateSchoolName(rawSchoolName: unknown): string | null {
  if (rawSchoolName === null || rawSchoolName === undefined) {
    return null;
  }
  if (typeof rawSchoolName !== "string") {
    throw new Error("School name must be a string or null.");
  }
  const trimmed = rawSchoolName.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > 200) {
    throw new Error("School name exceeds maximum length of 200 characters.");
  }
  return trimmed;
}

const map = (row: Row, materialIds: Id[]): JournalEntry => ({
  id: row.id,
  eventId: toNullableText(row.event_id),
  date: toText(row.date),
  title: toText(row.title),
  aircraftType: toText(row.aircraft_type),
  aircraftId: toText(row.aircraft_id),
  departureAirport: toText(row.departure_airport),
  arrivalAirport: toText(row.arrival_airport),
  instructorName: toText(row.instructor_name),
  totalTime: toNullableNumber(row.total_time),
  dualReceived: toNullableNumber(row.dual_received),
  soloTime: toNullableNumber(row.solo_time),
  picTime: toNullableNumber(row.pic_time),
  crossCountryTime: toNullableNumber(row.cross_country_time),
  nightTime: toNullableNumber(row.night_time),
  actualInstrumentTime: toNullableNumber(row.actual_instrument_time),
  simulatedInstrumentTime: toNullableNumber(row.simulated_instrument_time),
  dayLandings: toNullableNumber(row.day_landings),
  nightLandings: toNullableNumber(row.night_landings),
  mission: toText(row.mission),
  practiced: toText(row.practiced),
  wentWell: toText(row.went_well),
  wasDifficult: toText(row.was_difficult),
  instructorFeedback: toText(row.instructor_feedback),
  questionsForNextTime: toText(row.questions_for_next_time),
  confidence: toNullableNumber(row.confidence),
  schoolName: toNullableText(row.school_name),
  goalId: toNullableText(row.goal_id),
  createdAt: toText(row.created_at),
  updatedAt: toText(row.updated_at),
  materialIds,
});

export type NewJournalEntry = Partial<Omit<JournalEntry, "createdAt" | "updatedAt">> &
  Pick<JournalEntry, "date">;

export function journalRepository(db: SqlDatabase) {
  async function materialsByEntry(): Promise<Map<string, string[]>> {
    const rows = await db.select<{ journal_id: string; material_id: string }>(
      "SELECT journal_id, material_id FROM journal_materials",
    );
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const list = grouped.get(row.journal_id) ?? [];
      list.push(row.material_id);
      grouped.set(row.journal_id, list);
    }
    return grouped;
  }

  return {
    async list(): Promise<JournalEntry[]> {
      const [rows, materials] = await Promise.all([
        db.select<Row>("SELECT * FROM journal_entries ORDER BY date DESC, created_at DESC"),
        materialsByEntry(),
      ]);
      return rows.map((row) => map(row, materials.get(row.id) ?? []));
    },

    async get(id: Id): Promise<JournalEntry | null> {
      const rows = await db.select<Row>("SELECT * FROM journal_entries WHERE id = ?", [id]);
      const row = rows[0];
      if (!row) return null;
      const materials = await db.select<{ material_id: string }>(
        "SELECT material_id FROM journal_materials WHERE journal_id = ?",
        [id],
      );
      return map(row, materials.map((m) => m.material_id));
    },

    async create(input: NewJournalEntry): Promise<JournalEntry> {
      const timestamp = nowIso();
      const entry: JournalEntry = {
        id: input.id ?? newId(),
        eventId: input.eventId ?? null,
        date: input.date,
        title: input.title ?? "",
        aircraftType: input.aircraftType ?? "",
        aircraftId: input.aircraftId ?? "",
        departureAirport: input.departureAirport ?? "",
        arrivalAirport: input.arrivalAirport ?? "",
        instructorName: input.instructorName ?? "",
        totalTime: input.totalTime ?? null,
        dualReceived: input.dualReceived ?? null,
        soloTime: input.soloTime ?? null,
        picTime: input.picTime ?? null,
        crossCountryTime: input.crossCountryTime ?? null,
        nightTime: input.nightTime ?? null,
        actualInstrumentTime: input.actualInstrumentTime ?? null,
        simulatedInstrumentTime: input.simulatedInstrumentTime ?? null,
        dayLandings: input.dayLandings ?? null,
        nightLandings: input.nightLandings ?? null,
        mission: input.mission ?? "",
        practiced: input.practiced ?? "",
        wentWell: input.wentWell ?? "",
        wasDifficult: input.wasDifficult ?? "",
        instructorFeedback: input.instructorFeedback ?? "",
        questionsForNextTime: input.questionsForNextTime ?? "",
        confidence: input.confidence ?? null,
        schoolName: validateSchoolName(input.schoolName),
        goalId: input.goalId ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
        materialIds: input.materialIds ?? [],
      };
      await db.execute(
        `INSERT INTO journal_entries (id, event_id, date, title, aircraft_type,
           aircraft_id, departure_airport, arrival_airport, instructor_name,
           total_time, dual_received, solo_time, pic_time, cross_country_time,
           night_time, actual_instrument_time, simulated_instrument_time,
           day_landings, night_landings, mission, practiced, went_well,
           was_difficult, instructor_feedback, questions_for_next_time,
           confidence, school_name, goal_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id, entry.eventId, entry.date, entry.title, entry.aircraftType,
          entry.aircraftId, entry.departureAirport, entry.arrivalAirport,
          entry.instructorName, entry.totalTime, entry.dualReceived, entry.soloTime,
          entry.picTime, entry.crossCountryTime, entry.nightTime,
          entry.actualInstrumentTime, entry.simulatedInstrumentTime,
          entry.dayLandings, entry.nightLandings, entry.mission, entry.practiced,
          entry.wentWell, entry.wasDifficult, entry.instructorFeedback,
          entry.questionsForNextTime, entry.confidence, entry.schoolName, entry.goalId, entry.createdAt,
          entry.updatedAt,
        ],
      );
      await this.setMaterials(entry.id, entry.materialIds);
      return entry;
    },

    async update(id: Id, changes: Partial<JournalEntry>): Promise<void> {
      const rows = await db.select<Row>("SELECT * FROM journal_entries WHERE id = ?", [id]);
      const existing = rows[0];
      if (!existing) throw new Error("That journal entry no longer exists.");
      const current = map(existing, []);
      const schoolName =
        changes.schoolName !== undefined
          ? validateSchoolName(changes.schoolName)
          : current.schoolName;
      const next = { ...current, ...changes, schoolName, updatedAt: nowIso() };
      await db.execute(
        `UPDATE journal_entries
            SET event_id = ?, date = ?, title = ?, aircraft_type = ?, aircraft_id = ?,
                departure_airport = ?, arrival_airport = ?, instructor_name = ?,
                total_time = ?, dual_received = ?, solo_time = ?, pic_time = ?,
                cross_country_time = ?, night_time = ?, actual_instrument_time = ?,
                simulated_instrument_time = ?, day_landings = ?, night_landings = ?,
                mission = ?, practiced = ?, went_well = ?, was_difficult = ?,
                instructor_feedback = ?, questions_for_next_time = ?, confidence = ?,
                school_name = ?, goal_id = ?, updated_at = ?
          WHERE id = ?`,
        [
          next.eventId, next.date, next.title, next.aircraftType, next.aircraftId,
          next.departureAirport, next.arrivalAirport, next.instructorName,
          next.totalTime, next.dualReceived, next.soloTime, next.picTime,
          next.crossCountryTime, next.nightTime, next.actualInstrumentTime,
          next.simulatedInstrumentTime, next.dayLandings, next.nightLandings,
          next.mission, next.practiced, next.wentWell, next.wasDifficult,
          next.instructorFeedback, next.questionsForNextTime, next.confidence,
          next.schoolName, next.goalId, next.updatedAt, id,
        ],
      );
      if (changes.materialIds) await this.setMaterials(id, changes.materialIds);
    },

    async setMaterials(journalId: Id, materialIds: Id[]): Promise<void> {
      await db.execute("DELETE FROM journal_materials WHERE journal_id = ?", [journalId]);
      for (const materialId of materialIds) {
        await db.execute(
          "INSERT INTO journal_materials (journal_id, material_id) VALUES (?, ?)",
          [journalId, materialId],
        );
      }
    },

    async saveAtomically(operation: import("../db").DebriefSaveOperation): Promise<void> {
      if (typeof db.saveDebriefAtomically !== "function") {
        throw new Error(
          "Atomic debrief saves require a database driver with atomic transaction support.",
        );
      }
      await db.saveDebriefAtomically(operation);
    },

    async remove(id: Id): Promise<void> {
      await db.execute("DELETE FROM journal_entries WHERE id = ?", [id]);
    },
  };
}
