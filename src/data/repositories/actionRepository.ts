import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import {
  ACTION_CATEGORY_LABELS,
  PRIORITY_LABELS,
  RELATED_TYPE_LABELS,
  type ActionCategory,
  type ActionStatus,
  type Id,
  type NextAction,
  type Priority,
  type RelatedType,
} from "@/domain/types";
import { toEnum, toNullableNumber, toNullableText, toText, type SqlDatabase } from "../db";

interface Row {
  id: string;
  title: unknown;
  description: unknown;
  category: unknown;
  priority: unknown;
  status: unknown;
  due_date: unknown;
  estimated_minutes: unknown;
  related_type: unknown;
  related_id: unknown;
  material_id: unknown;
  source_material_id?: unknown;
  created_at: unknown;
  updated_at: unknown;
  completed_at: unknown;
}

const STATUSES: Record<ActionStatus, true> = { open: true, completed: true, dismissed: true };

const map = (row: Row): NextAction => ({
  id: row.id,
  title: toText(row.title),
  description: toText(row.description),
  category: toEnum<ActionCategory>(row.category, ACTION_CATEGORY_LABELS, "prepare"),
  priority: toEnum<Priority>(row.priority, PRIORITY_LABELS, "important"),
  status: toEnum<ActionStatus>(row.status, STATUSES, "open"),
  dueDate: toNullableText(row.due_date),
  estimatedMinutes: toNullableNumber(row.estimated_minutes),
  relatedType: row.related_type
    ? toEnum<RelatedType>(row.related_type, RELATED_TYPE_LABELS, "goal")
    : null,
  relatedId: toNullableText(row.related_id),
  materialId: toNullableText(row.material_id),
  sourceMaterialId: toNullableText(row.source_material_id),
  createdAt: toText(row.created_at),
  updatedAt: toText(row.updated_at),
  completedAt: toNullableText(row.completed_at),
});

export type NewAction = Partial<Omit<NextAction, "createdAt" | "updatedAt">> &
  Pick<NextAction, "title">;

/** Next Actions are the shared task concept; nothing else defines its own. */
export function actionRepository(db: SqlDatabase) {
  return {
    async list(): Promise<NextAction[]> {
      const rows = await db.select<Row>(
        "SELECT * FROM next_actions ORDER BY due_date IS NULL, due_date, created_at",
      );
      return rows.map(map);
    },

    async get(id: Id): Promise<NextAction | null> {
      const rows = await db.select<Row>("SELECT * FROM next_actions WHERE id = ?", [id]);
      return rows[0] ? map(rows[0]) : null;
    },

    async create(input: NewAction): Promise<NextAction> {
      const timestamp = nowIso();
      const action: NextAction = {
        id: input.id ?? newId(),
        title: input.title,
        description: input.description ?? "",
        category: input.category ?? "prepare",
        priority: input.priority ?? "important",
        status: input.status ?? "open",
        dueDate: input.dueDate ?? null,
        estimatedMinutes: input.estimatedMinutes ?? null,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
        materialId: input.materialId ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: input.completedAt ?? null,
      };
      await db.execute(
        `INSERT INTO next_actions (id, title, description, category, priority, status,
           due_date, estimated_minutes, related_type, related_id, material_id, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          action.id, action.title, action.description, action.category, action.priority,
          action.status, action.dueDate, action.estimatedMinutes, action.relatedType,
          action.relatedId, action.materialId, action.createdAt, action.updatedAt, action.completedAt,
        ],
      );
      return action;
    },

    async complete(id: Id): Promise<void> {
      const bound = await db.select<{ count: number }>(
        "SELECT COUNT(*) AS count FROM homework_assignments WHERE action_id = ?",
        [id],
      );
      if (bound[0] && Number(bound[0].count) > 0) {
        throw new Error("This comes from your homework. Open the homework to change it.");
      }
      const now = nowIso();
      await db.execute(
        "UPDATE next_actions SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?",
        [now, now, id],
      );
    },

    async update(id: Id, changes: Partial<NextAction>): Promise<void> {
      const rows = await db.select<Row>("SELECT * FROM next_actions WHERE id = ?", [id]);
      const existing = rows[0];
      if (!existing) throw new Error("That action no longer exists.");
      const bound = await db.select<{ count: number }>(
        "SELECT COUNT(*) AS count FROM homework_assignments WHERE action_id = ?",
        [id],
      );
      if (bound[0] && Number(bound[0].count) > 0) {
        if (changes.status === "completed") {
          throw new Error("This comes from your homework. Open the homework to change it.");
        }
        const boundKeys = ["title", "category", "status", "dueDate", "completedAt"] as const;
        for (const k of boundKeys) {
          if (k in changes && changes[k] !== undefined) {
            throw new Error("This comes from your homework. Open the homework to change it.");
          }
        }
        // Update only unowned fields; a concurrent homework projection must not be overwritten.
        const allowed = { description: "description", priority: "priority", estimatedMinutes: "estimated_minutes",
          relatedType: "related_type", relatedId: "related_id", materialId: "material_id" } as const;
        const keys = (Object.keys(allowed) as (keyof typeof allowed)[]).filter(k => changes[k] !== undefined);
        if (keys.length) await db.execute(`UPDATE next_actions SET ${keys.map(k => `${allowed[k]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`,
          [...keys.map(k => changes[k]!), nowIso(), id]);
        return;
      }
      const previous = map(existing);
      const next = { ...previous, ...changes, updatedAt: nowIso() };
      // Choosing a different (or no) material replaces the deleted-source provenance.
      const relinked =
        changes.materialId !== undefined && changes.materialId !== previous.materialId ? 1 : 0;
      await db.execute(
        `UPDATE next_actions
            SET title = ?, description = ?, category = ?, priority = ?, status = ?,
                due_date = ?, estimated_minutes = ?, related_type = ?, related_id = ?,
                material_id = ?, updated_at = ?, completed_at = ?,
                source_material_id = CASE WHEN ? = 1 THEN NULL ELSE source_material_id END
          WHERE id = ?`,
        [
          next.title, next.description, next.category, next.priority, next.status,
          next.dueDate, next.estimatedMinutes, next.relatedType, next.relatedId,
          next.materialId, next.updatedAt, next.completedAt, relinked, id,
        ],
      );
    },

    async remove(id: Id): Promise<void> {
      const bound = await db.select<{ id: string }>("SELECT id FROM homework_assignments WHERE action_id = ?", [id]);
      if (bound.length) throw new Error("This comes from your homework. Open the homework to change it.");
      await db.execute("DELETE FROM next_actions WHERE id = ?", [id]);
    },
  };
}
