import type { SqlDatabase } from "../db";
import { decodeHomeworkOperation, HomeworkError, homeworkLiveMatches, homeworkAssert, parseHomeworkJson, validateHomeworkSnapshot,
  type HomeworkOperation } from "@/domain/homework";
/** Persistence only. Every mutation is one atomic after-state request guarded by revision/cycle history. */
export function homeworkRepository(db: SqlDatabase) {
  return {
    async save(operation: HomeworkOperation) {
      const decoded = decodeHomeworkOperation(operation);
      if (!db.saveHomeworkAtomically) throw new HomeworkError("UNSUPPORTED");
      return db.saveHomeworkAtomically(decoded);
    },
    async get(id: string) {
      const [a] = await db.select("SELECT * FROM homework_assignments WHERE id=?", [id]);
      if (!a) return null;
      const [row] = await db.select("SELECT snapshot_json FROM homework_history WHERE assignment_id=? ORDER BY revision DESC LIMIT 1", [id]);
      homeworkAssert(row);
      const s = validateHomeworkSnapshot(parseHomeworkJson(String(row.snapshot_json)));
      const records = await db.select("SELECT * FROM homework_activities WHERE assignment_id=? ORDER BY id", [id]);
      homeworkAssert(homeworkLiveMatches(s,a,records));
      // Resolve the availability-only pointers without changing historical snapshots.
      s.assignment = a as typeof s.assignment;
      for (const e of s.activities) e.record = records.find((r) => r.id === e.record.id) as typeof e.record;
      return s;
    },
    async list(includeArchived = false) {
      return db.select("SELECT * FROM homework_assignments WHERE (?=1 OR archived=0) ORDER BY due_date IS NULL,due_date,id", [includeArchived ? 1 : 0]);
    },
    async history(id: string) { return db.select("SELECT * FROM homework_history WHERE assignment_id=? ORDER BY revision", [id]); },
  };
}
