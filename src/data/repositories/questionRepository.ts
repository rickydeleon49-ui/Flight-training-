import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import {
  QUESTION_STATUS_LABELS,
  TOPIC_LABELS,
  type Id,
  type Question,
  type QuestionStatus,
  type Topic,
} from "@/domain/types";
import { toEnum, toNullableText, toText, type SqlDatabase } from "../db";

interface Row {
  id: string; text: unknown; topic: unknown; event_id: unknown; material_id: unknown;
  journal_id: unknown; status: unknown; answer: unknown;
  source_journal_id?: unknown; source_material_id?: unknown; source_event_id?: unknown;
  created_at: unknown; updated_at: unknown; answered_at: unknown;
}

const map = (row: Row): Question => ({
  id: row.id,
  text: toText(row.text),
  topic: toEnum<Topic>(row.topic, TOPIC_LABELS, "general"),
  eventId: toNullableText(row.event_id),
  materialId: toNullableText(row.material_id),
  journalId: toNullableText(row.journal_id),
  sourceJournalId: toNullableText(row.source_journal_id),
  sourceMaterialId: toNullableText(row.source_material_id),
  sourceEventId: toNullableText(row.source_event_id),
  status: toEnum<QuestionStatus>(row.status, QUESTION_STATUS_LABELS, "to_ask"),
  answer: toText(row.answer),
  createdAt: toText(row.created_at),
  updatedAt: toText(row.updated_at),
  answeredAt: toNullableText(row.answered_at),
});

export type NewQuestion = Partial<Omit<Question, "createdAt" | "updatedAt">> &
  Pick<Question, "text">;

export function questionRepository(db: SqlDatabase) {
  return {
    async list(): Promise<Question[]> {
      const rows = await db.select<Row>("SELECT * FROM questions ORDER BY created_at DESC");
      return rows.map(map);
    },

    async get(id: Id): Promise<Question | null> {
      const rows = await db.select<Row>("SELECT * FROM questions WHERE id = ?", [id]);
      return rows[0] ? map(rows[0]) : null;
    },

    async create(input: NewQuestion): Promise<Question> {
      const timestamp = nowIso();
      const question: Question = {
        id: input.id ?? newId(),
        text: input.text,
        topic: input.topic ?? "general",
        eventId: input.eventId ?? null,
        materialId: input.materialId ?? null,
        journalId: input.journalId ?? null,
        status: input.status ?? "to_ask",
        answer: input.answer ?? "",
        createdAt: timestamp,
        updatedAt: timestamp,
        answeredAt: input.answeredAt ?? null,
      };
      await db.execute(
        `INSERT INTO questions (id, text, topic, event_id, material_id, journal_id,
           status, answer, created_at, updated_at, answered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          question.id, question.text, question.topic, question.eventId, question.materialId,
          question.journalId, question.status, question.answer, question.createdAt,
          question.updatedAt, question.answeredAt,
        ],
      );
      return question;
    },

    async update(id: Id, changes: Partial<Question>): Promise<void> {
      const rows = await db.select<Row>("SELECT * FROM questions WHERE id = ?", [id]);
      const existing = rows[0];
      if (!existing) throw new Error("That question no longer exists.");
      const previous = map(existing);
      const next = { ...previous, ...changes, updatedAt: nowIso() };
      // Answering stamps the date; moving back to unanswered clears it.
      if (changes.status && changes.status !== previous.status) {
        next.answeredAt = changes.status === "answered" ? nowIso() : null;
      }
      // A deliberate relink replaces the old provenance: once she chooses a
      // different (or no) record, "the previous source was deleted" no longer applies.
      const relinked = (key: "eventId" | "materialId" | "journalId") =>
        changes[key] !== undefined && changes[key] !== previous[key] ? 1 : 0;
      await db.execute(
        `UPDATE questions SET text = ?, topic = ?, event_id = ?, material_id = ?,
                journal_id = ?, status = ?, answer = ?, updated_at = ?, answered_at = ?,
                source_event_id = CASE WHEN ? = 1 THEN NULL ELSE source_event_id END,
                source_material_id = CASE WHEN ? = 1 THEN NULL ELSE source_material_id END,
                source_journal_id = CASE WHEN ? = 1 THEN NULL ELSE source_journal_id END
          WHERE id = ?`,
        [
          next.text, next.topic, next.eventId, next.materialId, next.journalId,
          next.status, next.answer, next.updatedAt, next.answeredAt,
          relinked("eventId"), relinked("materialId"), relinked("journalId"), id,
        ],
      );
    },

    async remove(id: Id): Promise<void> {
      await db.execute("DELETE FROM questions WHERE id = ?", [id]);
    },
  };
}
