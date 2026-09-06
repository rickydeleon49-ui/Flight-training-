import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import {
  MATERIAL_TYPE_LABELS,
  PRIORITY_LABELS,
  REVIEW_STATUS_LABELS,
  TOPIC_LABELS,
  type Id,
  type MaterialType,
  type Priority,
  type ReviewStatus,
  type StudyMaterial,
  type Topic,
} from "@/domain/types";
import { toEnum, toNullableNumber, toNullableText, toText, type SqlDatabase } from "../db";

interface Row {
  id: string; title: unknown; material_type: unknown; topic: unknown;
  review_status: unknown; priority: unknown; goal_id: unknown; event_id: unknown;
  notes: unknown; file_path: unknown; original_file_name: unknown; file_size: unknown;
  created_at: unknown; updated_at: unknown; last_reviewed_at: unknown;
}

const map = (row: Row, tags: string[]): StudyMaterial => ({
  id: row.id,
  title: toText(row.title),
  materialType: toEnum<MaterialType>(row.material_type, MATERIAL_TYPE_LABELS, "study_guide"),
  topic: toEnum<Topic>(row.topic, TOPIC_LABELS, "general"),
  reviewStatus: toEnum<ReviewStatus>(row.review_status, REVIEW_STATUS_LABELS, "needs_review"),
  priority: toEnum<Priority>(row.priority, PRIORITY_LABELS, "later"),
  goalId: toNullableText(row.goal_id),
  eventId: toNullableText(row.event_id),
  notes: toText(row.notes),
  filePath: toNullableText(row.file_path),
  originalFileName: toNullableText(row.original_file_name),
  fileSize: toNullableNumber(row.file_size),
  createdAt: toText(row.created_at),
  updatedAt: toText(row.updated_at),
  lastReviewedAt: toNullableText(row.last_reviewed_at),
  tags,
});

export type NewMaterial = Partial<Omit<StudyMaterial, "id" | "createdAt" | "updatedAt">> &
  Pick<StudyMaterial, "title">;

/**
 * Study Library persistence. Files themselves live in the private documents
 * directory; only metadata and a relative path are stored here.
 */
export function documentRepository(db: SqlDatabase) {
  /** Resolve tag names to ids, creating any that are new. */
  async function resolveTagIds(names: string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      const existing = await db.select<{ id: string }>("SELECT id FROM tags WHERE name = ?", [name]);
      const found = existing[0];
      if (found) {
        ids.push(found.id);
      } else {
        const id = newId();
        // Starter initialization can overlap in React's development strict mode.
        // Let the database settle that race, then use whichever id won.
        await db.execute("INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?, ?, ?)", [
          id, name, nowIso(),
        ]);
        const resolved = await db.select<{ id: string }>("SELECT id FROM tags WHERE name = ?", [name]);
        const winner = resolved[0];
        if (!winner) throw new Error(`Could not save the tag “${name}”.`);
        ids.push(winner.id);
      }
    }
    return ids;
  }

  async function replaceTags(materialId: Id, names: string[]): Promise<void> {
    await db.execute("DELETE FROM material_tags WHERE material_id = ?", [materialId]);
    for (const tagId of await resolveTagIds(names)) {
      await db.execute("INSERT INTO material_tags (material_id, tag_id) VALUES (?, ?)", [
        materialId, tagId,
      ]);
    }
  }

  async function tagsByMaterial(): Promise<Map<string, string[]>> {
    const rows = await db.select<{ material_id: string; name: string }>(
      `SELECT mt.material_id, t.name
         FROM material_tags mt
         JOIN tags t ON t.id = mt.tag_id
        ORDER BY t.name`,
    );
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const list = grouped.get(row.material_id) ?? [];
      list.push(row.name);
      grouped.set(row.material_id, list);
    }
    return grouped;
  }

  return {
    async list(): Promise<StudyMaterial[]> {
      const [rows, tags] = await Promise.all([
        db.select<Row>("SELECT * FROM study_materials ORDER BY created_at DESC"),
        tagsByMaterial(),
      ]);
      return rows.map((row) => map(row, tags.get(row.id) ?? []));
    },

    async listTags(): Promise<string[]> {
      const rows = await db.select<{ name: string }>("SELECT name FROM tags ORDER BY name");
      return rows.map((row) => row.name);
    },

    /**
     * Create a material. The id can be supplied so a file can be imported
     * under the material's own id before the row exists.
     */
    async create(input: NewMaterial & { id?: Id }): Promise<StudyMaterial> {
      const timestamp = nowIso();
      const material: StudyMaterial = {
        id: input.id ?? newId(),
        title: input.title,
        materialType: input.materialType ?? "study_guide",
        topic: input.topic ?? "general",
        reviewStatus: input.reviewStatus ?? "needs_review",
        priority: input.priority ?? "later",
        goalId: input.goalId ?? null,
        eventId: input.eventId ?? null,
        notes: input.notes ?? "",
        filePath: input.filePath ?? null,
        originalFileName: input.originalFileName ?? null,
        fileSize: input.fileSize ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastReviewedAt: input.lastReviewedAt ?? null,
        tags: input.tags ?? [],
      };
      await db.execute(
        `INSERT INTO study_materials (id, title, material_type, topic, review_status, priority,
           goal_id, event_id, notes, file_path, original_file_name, file_size,
           created_at, updated_at, last_reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          material.id, material.title, material.materialType, material.topic,
          material.reviewStatus, material.priority, material.goalId, material.eventId,
          material.notes, material.filePath, material.originalFileName, material.fileSize,
          material.createdAt, material.updatedAt, material.lastReviewedAt,
        ],
      );
      if (material.tags.length) await replaceTags(material.id, material.tags);
      return material;
    },

    async update(id: Id, changes: Partial<StudyMaterial>): Promise<void> {
      const rows = await db.select<Row>("SELECT * FROM study_materials WHERE id = ?", [id]);
      const existing = rows[0];
      if (!existing) throw new Error("That study material no longer exists.");
      const next = { ...map(existing, []), ...changes, updatedAt: nowIso() };
      await db.execute(
        `UPDATE study_materials
            SET title = ?, material_type = ?, topic = ?, review_status = ?, priority = ?,
                goal_id = ?, event_id = ?, notes = ?, file_path = ?, original_file_name = ?,
                file_size = ?, updated_at = ?, last_reviewed_at = ?
          WHERE id = ?`,
        [
          next.title, next.materialType, next.topic, next.reviewStatus, next.priority,
          next.goalId, next.eventId, next.notes, next.filePath, next.originalFileName,
          next.fileSize, next.updatedAt, next.lastReviewedAt, id,
        ],
      );
      if (changes.tags) await replaceTags(id, changes.tags);
    },

    async remove(id: Id): Promise<void> {
      await db.execute("DELETE FROM study_materials WHERE id = ?", [id]);
    },
  };
}
