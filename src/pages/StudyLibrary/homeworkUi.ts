/** UI requests only. The HW-01b repository validates and persists every transition. */
import { canonicalJson } from "@/logic/cardIdentity";
import type { HomeworkActivity, HomeworkOperation, HomeworkSnapshot } from "@/domain/homework";
export type Entry = HomeworkSnapshot["activities"][number];
export const ACTIVITY_KINDS = { read: "Reading", cards: "Cards", test: "Quiz", reflection: "Reflection", questions: "Questions", checklist: "Checklist" } as const;
export function newHomework(): HomeworkSnapshot {
    const at = new Date().toISOString();
    return { version: 1, runs: [], activities: [], assignment: { id: crypto.randomUUID(), title: "", instructions: "", school: null, instructor: null, lesson_id: null, source_lesson_id: null, due_date: null, state: "upcoming", revision: 0, action_id: null, archived: 0, created_at: at, updated_at: at, completed_at: null } };
}
export function newHomeworkActivity(assignmentId: string, position: number, kind: HomeworkActivity["kind"], at: string): Entry {
    return { source: null, evidence: null, record: { id: crypto.randomUUID(), assignment_id: assignmentId, position, kind, title: ACTIVITY_KINDS[kind], body: "", material_id: null, source_material_id: null, source_revision: null, card_set_id: null, test_version_id: null, source_test_version_id: null, page_start: null, page_end: null, state: "upcoming", cycle: 1, revision: 1, created_at: at, updated_at: at, completed_at: null, removed_at: null } };
}
export const activeHomework = (s: HomeworkSnapshot) => s.activities.filter(e => !e.record.removed_at).sort((a, b) => a.record.position - b.record.position);
export function homeworkOperation(previous: HomeworkSnapshot, draft: HomeworkSnapshot, changeKind: HomeworkOperation["changeKind"], creating = false): HomeworkOperation {
    const next = structuredClone(draft);
    // Completion must be later than creation even for a very fast click.
    const at = new Date(Math.max(Date.now(), Date.parse(previous.assignment.updated_at) + 1)).toISOString();
    next.assignment.revision = creating ? 1 : previous.assignment.revision + 1;
    next.assignment.updated_at = at;
    if (creating)
        next.assignment.created_at = at;
    let reopened = false;
    for (const e of next.activities) {
        const p = previous.activities.find(p => p.record.id === e.record.id);
        const r = e.record;
        if (creating || !p) {
            r.created_at = at;
            r.updated_at = at;
            reopened ||= !creating && previous.assignment.state === "completed";
            continue;
        }
        if (canonicalJson(p) === canonicalJson(e))
            continue;
        r.updated_at = at;
        if (changeKind === "edit" || changeKind === "relink") {
            const fields = (r: HomeworkActivity) => [r.kind, r.body, r.material_id, r.source_material_id, r.source_revision, r.card_set_id, r.test_version_id, r.source_test_version_id, r.page_start, r.page_end];
            if (canonicalJson(fields(p.record)) !== canonicalJson(fields(r))) {
                r.revision = p.record.revision + 1;
                r.cycle = p.record.cycle + 1;
                r.state = "reopened";
                r.completed_at = null;
                e.evidence = null;
                reopened = true;
            }
        }
        else if (changeKind === "complete") {
            r.state = "completed";
            r.completed_at = at;
            e.evidence = { version: 1, activity_id: r.id, revision: r.revision, cycle: r.cycle, kind: r.kind, completed_at: at, body: r.body, source_material_id: r.source_material_id, source_revision: r.source_revision, page_start: r.page_start, page_end: r.page_end };
        }
        else if (changeKind === "reopen") {
            r.cycle = p.record.cycle + 1;
            r.state = "reopened";
            r.completed_at = null;
            e.evidence = null;
            reopened = true;
        }
        else if (changeKind === "remove_activity" && r.removed_at)
            r.removed_at = at;
    }
    const active = activeHomework(next);
    const all = active.length > 0 && active.every(e => e.record.state === "completed");
    next.assignment.state = reopened ? "reopened" : all ? "completed" : active.some(e => ["in_progress", "completed"].includes(e.record.state)) ? "in_progress" : active.some(e => e.record.state === "reopened") && changeKind !== "complete" ? "reopened" : "upcoming";
    next.assignment.completed_at = next.assignment.state === "completed" ? previous.assignment.completed_at ?? at : null;
    next.activities.sort((a, b) => a.record.id.localeCompare(b.record.id));
    return { version: 1, operationId: crypto.randomUUID(), assignmentId: next.assignment.id, baseRevision: creating ? 0 : previous.assignment.revision, changeKind: creating ? "create" : changeKind, at, next };
}
export function homeworkSaveMessage(error: unknown): {
    text: string;
    stale: boolean;
} {
    const raw = error instanceof Error ? error.message : String(error);
    const stale = (error as {
        code?: string;
    })?.code === "STALE" || raw.includes("changed after you opened");
    return { stale, text: stale ? "This changed elsewhere. Reload to see the latest" : "This homework couldn't be saved. Your draft is still here to retry." };
}

export interface HomeworkHistoryEntry { change_kind: string; created_at: string; revision: number; snapshot_json?: unknown }
const HISTORY_LABELS: Record<string,string> = {create:"Homework added",edit:"Homework edited",complete:"Work completed",reopen:"Work reopened",reorder:"Activities reordered",remove_activity:"Activity removed",relink:"Source replaced",archive:"Archive changed"};
export function homeworkHistoryLabel(row: HomeworkHistoryEntry, previous?: HomeworkHistoryEntry): string {
  const label=HISTORY_LABELS[row.change_kind]??"Homework changed";
  if(typeof row.snapshot_json!=="string") return label;
  try {
    const next=JSON.parse(row.snapshot_json) as HomeworkSnapshot;
    if(row.change_kind==="archive")return next.assignment.archived?"Homework archived":"Homework unarchived";
    if(!previous||typeof previous.snapshot_json!=="string")return label;
    const before=JSON.parse(previous.snapshot_json) as HomeworkSnapshot;
    const affected=next.activities.filter(e=>{
      const p=before.activities.find(p=>p.record.id===e.record.id);
      return row.change_kind === "remove_activity" ? !!p && !p.record.removed_at && !!e.record.removed_at : !p||canonicalJson(p)!==canonicalJson(e);
    });
    const titles=affected.slice(0,3).map(e=>e.record.title).join(", ");
    return titles?`${label}: ${titles}${affected.length>3?` and ${affected.length-3} more`:""}`:label;
  }catch{return label;}
}
