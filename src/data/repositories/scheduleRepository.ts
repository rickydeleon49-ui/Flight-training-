import { nowIso } from "@/lib/dates";
import { newId } from "@/lib/id";
import {
  EVENT_STATUS_LABELS,
  EVENT_TYPE_LABELS,
  type EventStatus,
  type EventType,
  type Id,
  type PrepItem,
  type ScheduleEvent,
} from "@/domain/types";
import {
  fromBool, toBool, toEnum, toNullableNumber, toNullableText, toText, type SqlDatabase,
} from "../db";

interface Row {
  id: string; title: unknown; event_type: unknown; date: unknown;
  start_time: unknown; end_time: unknown; location: unknown; instructor: unknown;
  notes: unknown; goal_id: unknown; estimated_cost: unknown; actual_cost: unknown;
  status: unknown; created_at: unknown; updated_at: unknown;
}

const map = (row: Row, materialIds: Id[]): ScheduleEvent => ({
  id: row.id,
  title: toText(row.title),
  eventType: toEnum<EventType>(row.event_type, EVENT_TYPE_LABELS, "flight_lesson"),
  date: toText(row.date),
  startTime: toNullableText(row.start_time),
  endTime: toNullableText(row.end_time),
  location: toText(row.location),
  instructor: toText(row.instructor),
  notes: toText(row.notes),
  goalId: toNullableText(row.goal_id),
  estimatedCost: toNullableNumber(row.estimated_cost),
  actualCost: toNullableNumber(row.actual_cost),
  status: toEnum<EventStatus>(row.status, EVENT_STATUS_LABELS, "scheduled"),
  createdAt: toText(row.created_at),
  updatedAt: toText(row.updated_at),
  materialIds,
});

interface PrepRow {
  id: string; event_id: string; title: unknown; done: unknown;
  position: unknown; created_at: unknown;
}

const mapPrep = (row: PrepRow): PrepItem => ({
  id: row.id,
  eventId: row.event_id,
  title: toText(row.title),
  done: toBool(row.done),
  position: Number(row.position ?? 0),
  createdAt: toText(row.created_at),
});

export type NewEvent = Partial<Omit<ScheduleEvent, "id" | "createdAt" | "updatedAt">> &
  Pick<ScheduleEvent, "title" | "date">;

export function scheduleRepository(db: SqlDatabase) {
  async function materialsByEvent(): Promise<Map<string, string[]>> {
    const rows = await db.select<{ event_id: string; material_id: string }>(
      "SELECT event_id, material_id FROM event_materials",
    );
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const list = grouped.get(row.event_id) ?? [];
      list.push(row.material_id);
      grouped.set(row.event_id, list);
    }
    return grouped;
  }

  return {
    async list(): Promise<ScheduleEvent[]> {
      const [rows, materials] = await Promise.all([
        db.select<Row>("SELECT * FROM schedule_events ORDER BY date, start_time"),
        materialsByEvent(),
      ]);
      return rows.map((row) => map(row, materials.get(row.id) ?? []));
    },

    async listPrepItems(): Promise<PrepItem[]> {
      const rows = await db.select<PrepRow>(
        "SELECT * FROM event_prep_items ORDER BY position, created_at",
      );
      return rows.map(mapPrep);
    },

    async create(input: NewEvent): Promise<ScheduleEvent> {
      const timestamp = nowIso();
      const event: ScheduleEvent = {
        id: newId(),
        title: input.title,
        eventType: input.eventType ?? "flight_lesson",
        date: input.date,
        startTime: input.startTime ?? null,
        endTime: input.endTime ?? null,
        location: input.location ?? "",
        instructor: input.instructor ?? "",
        notes: input.notes ?? "",
        goalId: input.goalId ?? null,
        estimatedCost: input.estimatedCost ?? null,
        actualCost: input.actualCost ?? null,
        status: input.status ?? "scheduled",
        createdAt: timestamp,
        updatedAt: timestamp,
        materialIds: input.materialIds ?? [],
      };
      await db.execute(
        `INSERT INTO schedule_events (id, title, event_type, date, start_time, end_time,
           location, instructor, notes, goal_id, estimated_cost, actual_cost, status,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.id, event.title, event.eventType, event.date, event.startTime, event.endTime,
          event.location, event.instructor, event.notes, event.goalId, event.estimatedCost,
          event.actualCost, event.status, event.createdAt, event.updatedAt,
        ],
      );
      await this.setMaterials(event.id, event.materialIds);
      return event;
    },

    async update(id: Id, changes: Partial<ScheduleEvent>): Promise<void> {
      const rows = await db.select<Row>("SELECT * FROM schedule_events WHERE id = ?", [id]);
      const existing = rows[0];
      if (!existing) throw new Error("That event no longer exists.");
      const next = { ...map(existing, []), ...changes, updatedAt: nowIso() };
      await db.execute(
        `UPDATE schedule_events
            SET title = ?, event_type = ?, date = ?, start_time = ?, end_time = ?,
                location = ?, instructor = ?, notes = ?, goal_id = ?, estimated_cost = ?,
                actual_cost = ?, status = ?, updated_at = ?
          WHERE id = ?`,
        [
          next.title, next.eventType, next.date, next.startTime, next.endTime,
          next.location, next.instructor, next.notes, next.goalId, next.estimatedCost,
          next.actualCost, next.status, next.updatedAt, id,
        ],
      );
      if (changes.materialIds) await this.setMaterials(id, changes.materialIds);
    },

    async setMaterials(eventId: Id, materialIds: Id[]): Promise<void> {
      await db.execute("DELETE FROM event_materials WHERE event_id = ?", [eventId]);
      for (const materialId of materialIds) {
        await db.execute(
          "INSERT INTO event_materials (event_id, material_id) VALUES (?, ?)",
          [eventId, materialId],
        );
      }
    },

    async remove(id: Id): Promise<void> {
      await db.execute("DELETE FROM schedule_events WHERE id = ?", [id]);
    },

    async addPrepItem(eventId: Id, title: string, position: number): Promise<PrepItem> {
      const item: PrepItem = {
        id: newId(), eventId, title, done: false, position, createdAt: nowIso(),
      };
      await db.execute(
        `INSERT INTO event_prep_items (id, event_id, title, done, position, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [item.id, item.eventId, item.title, fromBool(item.done), item.position, item.createdAt],
      );
      return item;
    },

    async setPrepItemDone(id: Id, done: boolean): Promise<void> {
      await db.execute("UPDATE event_prep_items SET done = ? WHERE id = ?", [fromBool(done), id]);
    },

    async removePrepItem(id: Id): Promise<void> {
      await db.execute("DELETE FROM event_prep_items WHERE id = ?", [id]);
    },
  };
}
