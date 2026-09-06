import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import type { Id, Note } from "@/domain/types";
import { fromBool, toBool, toText, type SqlDatabase } from "../db";

interface Row {
  id: string; title: unknown; body: unknown; pinned: unknown;
  created_at: unknown; updated_at: unknown;
}

const map = (row: Row): Note => ({
  id: row.id,
  title: toText(row.title),
  body: toText(row.body),
  pinned: toBool(row.pinned),
  createdAt: toText(row.created_at),
  updatedAt: toText(row.updated_at),
});

export type NewNote = Partial<Omit<Note, "id" | "createdAt" | "updatedAt">> &
  Pick<Note, "body">;

export function noteRepository(db: SqlDatabase) {
  return {
    /** Pinned first, then whatever she touched most recently. */
    async list(): Promise<Note[]> {
      const rows = await db.select<Row>(
        "SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC",
      );
      return rows.map(map);
    },

    async create(input: NewNote): Promise<Note> {
      const timestamp = nowIso();
      const note: Note = {
        id: newId(),
        title: input.title ?? "",
        body: input.body,
        pinned: input.pinned ?? false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await db.execute(
        `INSERT INTO notes (id, title, body, pinned, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [note.id, note.title, note.body, fromBool(note.pinned), note.createdAt, note.updatedAt],
      );
      return note;
    },

    async update(id: Id, changes: Partial<Note>): Promise<void> {
      const rows = await db.select<Row>("SELECT * FROM notes WHERE id = ?", [id]);
      const existing = rows[0];
      if (!existing) throw new Error("That note no longer exists.");
      const next = { ...map(existing), ...changes, updatedAt: nowIso() };
      await db.execute(
        "UPDATE notes SET title = ?, body = ?, pinned = ?, updated_at = ? WHERE id = ?",
        [next.title, next.body, fromBool(next.pinned), next.updatedAt, id],
      );
    },

    async remove(id: Id): Promise<void> {
      await db.execute("DELETE FROM notes WHERE id = ?", [id]);
    },
  };
}
