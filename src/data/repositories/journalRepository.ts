import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import type { Id, JournalEntry } from "@/domain/types";
import { toNullableNumber, toNullableText, toText, type SqlDatabase } from "../db";

interface Row {
  id: string; event_id: unknown; date: unknown; title: unknown; mission: unknown;
  practiced: unknown; went_well: unknown; was_difficult: unknown;
  instructor_feedback: unknown; questions_for_next_time: unknown; confidence: unknown;
  goal_id: unknown; created_at: unknown; updated_at: unknown;
}

const map = (row: Row, materialIds: Id[]): JournalEntry => ({
  id: row.id,
  eventId: toNullableText(row.event_id),
  date: toText(row.date),
  title: toText(row.title),
  mission: toText(row.mission),
  practiced: toText(row.practiced),
  wentWell: toText(row.went_well),
  wasDifficult: toText(row.was_difficult),
  instructorFeedback: toText(row.instructor_feedback),
  questionsForNextTime: toText(row.questions_for_next_time),
  confidence: toNullableNumber(row.confidence),
  goalId: toNullableText(row.goal_id),
  createdAt: toText(row.created_at),
  updatedAt: toText(row.updated_at),
  materialIds,
});

export type NewJournalEntry = Partial<Omit<JournalEntry, "id" | "createdAt" | "updatedAt">> &
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

    async create(input: NewJournalEntry): Promise<JournalEntry> {
      const timestamp = nowIso();
      const entry: JournalEntry = {
        id: newId(),
        eventId: input.eventId ?? null,
        date: input.date,
        title: input.title ?? "",
        mission: input.mission ?? "",
        practiced: input.practiced ?? "",
        wentWell: input.wentWell ?? "",
        wasDifficult: input.wasDifficult ?? "",
        instructorFeedback: input.instructorFeedback ?? "",
        questionsForNextTime: input.questionsForNextTime ?? "",
        confidence: input.confidence ?? null,
        goalId: input.goalId ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
        materialIds: input.materialIds ?? [],
      };
      await db.execute(
        `INSERT INTO journal_entries (id, event_id, date, title, mission, practiced,
           went_well, was_difficult, instructor_feedback, questions_for_next_time,
           confidence, goal_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id, entry.eventId, entry.date, entry.title, entry.mission, entry.practiced,
          entry.wentWell, entry.wasDifficult, entry.instructorFeedback,
          entry.questionsForNextTime, entry.confidence, entry.goalId,
          entry.createdAt, entry.updatedAt,
        ],
      );
      await this.setMaterials(entry.id, entry.materialIds);
      return entry;
    },

    async update(id: Id, changes: Partial<JournalEntry>): Promise<void> {
      const rows = await db.select<Row>("SELECT * FROM journal_entries WHERE id = ?", [id]);
      const existing = rows[0];
      if (!existing) throw new Error("That journal entry no longer exists.");
      const next = { ...map(existing, []), ...changes, updatedAt: nowIso() };
      await db.execute(
        `UPDATE journal_entries
            SET event_id = ?, date = ?, title = ?, mission = ?, practiced = ?,
                went_well = ?, was_difficult = ?, instructor_feedback = ?,
                questions_for_next_time = ?, confidence = ?, goal_id = ?, updated_at = ?
          WHERE id = ?`,
        [
          next.eventId, next.date, next.title, next.mission, next.practiced,
          next.wentWell, next.wasDifficult, next.instructorFeedback,
          next.questionsForNextTime, next.confidence, next.goalId, next.updatedAt, id,
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

    async remove(id: Id): Promise<void> {
      await db.execute("DELETE FROM journal_entries WHERE id = ?", [id]);
    },
  };
}
