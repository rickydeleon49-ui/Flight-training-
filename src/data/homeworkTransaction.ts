import { canonicalJson, sha256Hex } from "@/logic/cardIdentity";
import { decodeHomeworkOperation, HomeworkError, homeworkAssert, homeworkLiveMatches, parseHomeworkJson, validateHomeworkTransition,
  type HomeworkSnapshot, type HomeworkResult } from "@/domain/homework";
import type { SqlValue } from "./db";
import { validateHomeworkSources, type ValidationQuery } from "./practiceStateValidation";

// Source availability may be nullified by FK deletion without changing the captured target.
// Keep comparison order independent of stored canonical JSON and request object key order.
const SOURCE_FIELDS = ["kind", "source_material_id", "source_revision", "card_set_id",
  "source_test_version_id", "page_start", "page_end"] as const;
const sourceTarget = (e: HomeworkSnapshot["activities"][number]) =>
  canonicalJson([e.source, ...SOURCE_FIELDS.map((k) => e.record[k])]);

type Run = (sql: string, params: SqlValue[]) => void | Promise<void>;
/** ConnectionOwner supplies exclusion; sql.js supplies its existing byte-restoring persistence boundary. */
export async function executeHomeworkOperation(exec: (sql: string) => void, run: Run, query: ValidationQuery, value: unknown): Promise<HomeworkResult> {
  let op: ReturnType<typeof decodeHomeworkOperation>;
  try { op = decodeHomeworkOperation(value); } catch { throw new HomeworkError("INVALID"); }
  const raw = canonicalJson(op), hash = await sha256Hex(raw);
  exec("BEGIN IMMEDIATE");
  try {
    const [receipt] = await query("SELECT * FROM homework_operations WHERE operation_id=?", [op.operationId]);
    if (receipt) {
      if (receipt.request_json !== raw || receipt.request_hash !== hash) throw new HomeworkError("CONFLICT");
      const result = parseHomeworkJson(String(receipt.result_json)) as HomeworkResult;
      homeworkAssert(result.version === 1 && result.assignmentId === op.assignmentId && result.revision === op.baseRevision + 1);
      exec("COMMIT"); return result;
    }
    const [assignment] = await query("SELECT * FROM homework_assignments WHERE id=?", [op.assignmentId]);
    if ((assignment?.revision ?? 0) !== op.baseRevision) throw new HomeworkError("STALE");
    let previous: HomeworkSnapshot | null = null;
    if (assignment) {
      const [history] = await query("SELECT snapshot_json FROM homework_history WHERE assignment_id=? ORDER BY revision DESC LIMIT 1", [op.assignmentId]);
      homeworkAssert(history);
      previous = parseHomeworkJson(String(history.snapshot_json)) as HomeworkSnapshot;
      const activities = await query("SELECT * FROM homework_activities WHERE assignment_id=? ORDER BY id", [op.assignmentId]);
      homeworkAssert(homeworkLiveMatches(previous, assignment, activities));
    }
    const next = validateHomeworkTransition(previous, op);
    // Only new/changed targets and fresh completions need a currently available source.
    const checked = { ...next, activities: next.activities.filter((e) => {
      const p = previous?.activities.find((p) => p.record.id === e.record.id);
      return !p || sourceTarget(p) !== sourceTarget(e) ||
        (e.record.state === "completed" && p.record.state !== "completed");
    }) };
    await validateHomeworkSources(query, checked, true);
    // A high transaction-local offset avoids transient UNIQUE conflicts during reorder/removal.
    const [max] = await query("SELECT COALESCE(MAX(position),0) AS n FROM homework_activities WHERE assignment_id=?", [op.assignmentId]);
    const offset = Number(max?.n ?? 0) + next.activities.length + 1;
    homeworkAssert(Number.isSafeInteger(offset * 2));
    await run("UPDATE homework_activities SET position=position+? WHERE assignment_id=? AND removed_at IS NULL", [offset, op.assignmentId]);
    const write = async (table: string, row: object) => {
      const fields = Object.keys(row);
      await run(`INSERT INTO ${table} (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${fields.filter((k) => k !== "id").map((k) => `${k}=excluded.${k}`).join(",")}`, Object.values(row) as SqlValue[]);
    };
    await write("homework_assignments", next.assignment);
    for (const e of next.activities) {
      const [owner] = await query("SELECT assignment_id FROM homework_activities WHERE id=?", [e.record.id]);
      homeworkAssert(!owner || owner.assignment_id === op.assignmentId);
      await write("homework_activities", e.record);
    }
    const result: HomeworkResult = { version: 1, assignmentId: op.assignmentId, revision: next.assignment.revision };
    await run("INSERT INTO homework_operations VALUES (?,?,?,?,?,?)", [op.operationId,op.assignmentId,raw,hash,canonicalJson(result),op.at]);
    await run("INSERT INTO homework_history VALUES (?,?,?,?,?,?)", [op.assignmentId,next.assignment.revision,op.operationId,op.changeKind,canonicalJson(next),op.at]);
    exec("COMMIT"); return result;
  } catch (error) {
    try { exec("ROLLBACK"); } catch { /* preserve original failure */ }
    if (error instanceof HomeworkError) throw error;
    throw new HomeworkError("STORAGE");
  }
}
