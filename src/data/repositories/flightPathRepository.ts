import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import {
  GOAL_STATUS_LABELS,
  MILESTONE_STATUS_LABELS,
  PRIORITY_LABELS,
  type ChecklistItem,
  type Goal,
  type GoalStatus,
  type Id,
  type Milestone,
  type MilestoneStatus,
  type Priority,
} from "@/domain/types";
import {
  fromBool, toBool, toEnum, toNullableNumber, toNullableText, toText, type SqlDatabase,
} from "../db";

/* ------------------------------- milestones ------------------------------ */

interface MilestoneRow {
  id: string; title: unknown; description: unknown; position: unknown;
  status: unknown; target_date: unknown; created_at: unknown; updated_at: unknown;
}

const mapMilestone = (row: MilestoneRow): Milestone => ({
  id: row.id,
  title: toText(row.title),
  description: toText(row.description),
  position: Number(row.position ?? 0),
  status: toEnum<MilestoneStatus>(row.status, MILESTONE_STATUS_LABELS, "not_started"),
  targetDate: toNullableText(row.target_date),
  createdAt: toText(row.created_at),
  updatedAt: toText(row.updated_at),
});

export function milestoneRepository(db: SqlDatabase) {
  return {
    async list(): Promise<Milestone[]> {
      const rows = await db.select<MilestoneRow>(
        "SELECT * FROM milestones ORDER BY position, created_at",
      );
      return rows.map(mapMilestone);
    },

    async create(
      input: Partial<Omit<Milestone, "id" | "createdAt" | "updatedAt">> & Pick<Milestone, "title">,
    ): Promise<Milestone> {
      const timestamp = nowIso();
      const milestone: Milestone = {
        id: newId(),
        title: input.title,
        description: input.description ?? "",
        position: input.position ?? 0,
        status: input.status ?? "not_started",
        targetDate: input.targetDate ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await db.execute(
        `INSERT INTO milestones (id, title, description, position, status, target_date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          milestone.id, milestone.title, milestone.description, milestone.position,
          milestone.status, milestone.targetDate, milestone.createdAt, milestone.updatedAt,
        ],
      );
      return milestone;
    },

    async update(id: Id, changes: Partial<Milestone>): Promise<void> {
      const rows = await db.select<MilestoneRow>("SELECT * FROM milestones WHERE id = ?", [id]);
      const existing = rows[0];
      if (!existing) throw new Error("That milestone no longer exists.");
      const next = { ...mapMilestone(existing), ...changes, updatedAt: nowIso() };
      await db.execute(
        `UPDATE milestones SET title = ?, description = ?, position = ?, status = ?,
                target_date = ?, updated_at = ? WHERE id = ?`,
        [next.title, next.description, next.position, next.status, next.targetDate, next.updatedAt, id],
      );
    },

    /**
     * Move several milestones at once. One statement, so SQLite applies every
     * position or none: a failure leaves the order she had.
     */
    async reorder(positions: Array<{ id: Id; position: number }>): Promise<void> {
      if (positions.length === 0) return;
      const ids = positions.map((entry) => entry.id);
      if (new Set(ids).size !== ids.length) throw new Error("A milestone was listed twice in one move.");
      const marks = ids.map(() => "?").join(", ");
      const found = await db.select<{ id: string }>(`SELECT id FROM milestones WHERE id IN (${marks})`, ids);
      if (found.length !== ids.length) throw new Error("That milestone no longer exists.");
      const cases = positions.map(() => "WHEN ? THEN ?").join(" ");
      await db.execute(
        `UPDATE milestones SET position = CASE id ${cases} END, updated_at = ? WHERE id IN (${marks})`,
        [...positions.flatMap((entry) => [entry.id, entry.position]), nowIso(), ...ids],
      );
    },

    async remove(id: Id): Promise<void> {
      await db.execute("DELETE FROM milestones WHERE id = ?", [id]);
    },
  };
}

/* ---------------------------------- goals -------------------------------- */

interface GoalRow {
  id: string; milestone_id: unknown; title: unknown; description: unknown;
  status: unknown; priority: unknown; target_date: unknown; notes: unknown;
  confidence: unknown; created_at: unknown; updated_at: unknown; completed_at: unknown;
}

const mapGoal = (row: GoalRow): Goal => ({
  id: row.id,
  milestoneId: toNullableText(row.milestone_id),
  title: toText(row.title),
  description: toText(row.description),
  status: toEnum<GoalStatus>(row.status, GOAL_STATUS_LABELS, "not_started"),
  priority: toEnum<Priority>(row.priority, PRIORITY_LABELS, "important"),
  targetDate: toNullableText(row.target_date),
  notes: toText(row.notes),
  confidence: toNullableNumber(row.confidence),
  createdAt: toText(row.created_at),
  updatedAt: toText(row.updated_at),
  completedAt: toNullableText(row.completed_at),
});

interface ChecklistRow {
  id: string; goal_id: string; title: unknown; done: unknown;
  position: unknown; created_at: unknown;
}

const mapChecklistItem = (row: ChecklistRow): ChecklistItem => ({
  id: row.id,
  goalId: row.goal_id,
  title: toText(row.title),
  done: toBool(row.done),
  position: Number(row.position ?? 0),
  createdAt: toText(row.created_at),
});

export function goalRepository(db: SqlDatabase) {
  return {
    async list(): Promise<Goal[]> {
      const rows = await db.select<GoalRow>("SELECT * FROM goals ORDER BY created_at");
      return rows.map(mapGoal);
    },

    async listChecklistItems(): Promise<ChecklistItem[]> {
      const rows = await db.select<ChecklistRow>(
        "SELECT * FROM goal_checklist_items ORDER BY position, created_at",
      );
      return rows.map(mapChecklistItem);
    },

    async create(
      input: Partial<Omit<Goal, "id" | "createdAt" | "updatedAt">> & Pick<Goal, "title">,
    ): Promise<Goal> {
      const timestamp = nowIso();
      const goal: Goal = {
        id: newId(),
        milestoneId: input.milestoneId ?? null,
        title: input.title,
        description: input.description ?? "",
        status: input.status ?? "not_started",
        priority: input.priority ?? "important",
        targetDate: input.targetDate ?? null,
        notes: input.notes ?? "",
        confidence: input.confidence ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: input.completedAt ?? null,
      };
      await db.execute(
        `INSERT INTO goals (id, milestone_id, title, description, status, priority,
           target_date, notes, confidence, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          goal.id, goal.milestoneId, goal.title, goal.description, goal.status,
          goal.priority, goal.targetDate, goal.notes, goal.confidence,
          goal.createdAt, goal.updatedAt, goal.completedAt,
        ],
      );
      return goal;
    },

    async update(id: Id, changes: Partial<Goal>): Promise<void> {
      const rows = await db.select<GoalRow>("SELECT * FROM goals WHERE id = ?", [id]);
      const existing = rows[0];
      if (!existing) throw new Error("That goal no longer exists.");
      const next = { ...mapGoal(existing), ...changes, updatedAt: nowIso() };
      // Completing a goal stamps the date; reopening it clears the stamp.
      if (changes.status && changes.status !== mapGoal(existing).status) {
        next.completedAt = changes.status === "completed" ? nowIso() : null;
      }
      await db.execute(
        `UPDATE goals SET milestone_id = ?, title = ?, description = ?, status = ?,
                priority = ?, target_date = ?, notes = ?, confidence = ?,
                updated_at = ?, completed_at = ? WHERE id = ?`,
        [
          next.milestoneId, next.title, next.description, next.status, next.priority,
          next.targetDate, next.notes, next.confidence, next.updatedAt, next.completedAt, id,
        ],
      );
    },

    async remove(id: Id): Promise<void> {
      await db.execute("DELETE FROM goals WHERE id = ?", [id]);
    },

    async addChecklistItem(goalId: Id, title: string, position: number): Promise<ChecklistItem> {
      const item: ChecklistItem = {
        id: newId(), goalId, title, done: false, position, createdAt: nowIso(),
      };
      await db.execute(
        `INSERT INTO goal_checklist_items (id, goal_id, title, done, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [item.id, item.goalId, item.title, fromBool(item.done), item.position, item.createdAt],
      );
      return item;
    },

    async setChecklistItemDone(id: Id, done: boolean): Promise<void> {
      await db.execute("UPDATE goal_checklist_items SET done = ? WHERE id = ?", [fromBool(done), id]);
    },

    async removeChecklistItem(id: Id): Promise<void> {
      await db.execute("DELETE FROM goal_checklist_items WHERE id = ?", [id]);
    },
  };
}
