/** HW-01b codec. Receipts carry the exact intended after-state, never arbitrary SQL.
 * Both validators independently check the state and every permitted transition.
 * Runs and action links are reserved until HW-01d and must be empty in this codec.
 */
import { z } from "zod";
import { canonicalJson } from "@/logic/cardIdentity";

export const HOMEWORK_LIMIT = 1024 * 1024;
const scalar = (s: string) => !/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s);
const text = (max: number, required = false) => z.string().refine((s) => scalar(s) && [...s].length <= max && new TextEncoder().encode(s).length <= max * 4 && (!required || s.trim().length > 0));
export const homeworkUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const integer = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const instant = z.string().refine((s) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s);
const date = z.string().refine((s) => /^\d{4}-\d\d-\d\d$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00.000Z`)) && new Date(`${s}T00:00:00.000Z`).toISOString().slice(0, 10) === s);
const state = z.enum(["upcoming", "in_progress", "completed", "reopened"]);
const kind = z.enum(["read", "cards", "test", "reflection", "questions", "checklist"]);
const assignmentCodec = z.strictObject({
  id: homeworkUuid, title: text(200, true), instructions: text(20000), school: text(200).nullable(), instructor: text(200).nullable(),
  lesson_id: homeworkUuid.nullable(), source_lesson_id: homeworkUuid.nullable(), due_date: date.nullable(), state,
  revision: integer, action_id: z.null(), archived: z.union([z.literal(0), z.literal(1)]),
  created_at: instant, updated_at: instant, completed_at: instant.nullable(),
});
const activityCodec = z.strictObject({
  id: homeworkUuid, assignment_id: homeworkUuid, position: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), kind,
  title: text(200, true), body: text(20000), material_id: homeworkUuid.nullable(), source_material_id: homeworkUuid.nullable(),
  source_revision: hash.nullable(), card_set_id: hash.nullable(), test_version_id: homeworkUuid.nullable(), source_test_version_id: homeworkUuid.nullable(),
  page_start: integer.nullable(), page_end: integer.nullable(), state, cycle: integer, revision: integer,
  created_at: instant, updated_at: instant, completed_at: instant.nullable(), removed_at: instant.nullable(),
});
const evidenceCodec = z.strictObject({
  version: z.literal(1), activity_id: homeworkUuid, revision: integer, cycle: integer, kind,
  completed_at: instant, body: text(20000), source_material_id: homeworkUuid.nullable(), source_revision: hash.nullable(),
  page_start: integer.nullable(), page_end: integer.nullable(),
});
const entryCodec = z.strictObject({ record: activityCodec,
  source: z.strictObject({ title: text(200, true), total_pages: integer.nullable() }).nullable(),
  evidence: evidenceCodec.nullable(),
});
const snapshotCodec = z.strictObject({ version: z.literal(1), assignment: assignmentCodec, activities: z.array(entryCodec), runs: z.array(z.never()).length(0) });
export const HOMEWORK_CHANGES = ["create", "edit", "complete", "reopen", "reorder", "remove_activity", "relink", "archive"] as const;
const operationCodec = z.strictObject({ version: z.literal(1), operationId: homeworkUuid, assignmentId: homeworkUuid,
  baseRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1), changeKind: z.enum(HOMEWORK_CHANGES), at: instant, next: snapshotCodec,
});
export type HomeworkSnapshot = z.infer<typeof snapshotCodec>;
export type HomeworkActivity = z.infer<typeof activityCodec>;
export type HomeworkOperation = z.infer<typeof operationCodec>;
export interface HomeworkResult { version: 1; assignmentId: string; revision: number }
export const HOMEWORK_TABLES = ["homework_assignments", "homework_activities", "homework_runs", "homework_operations", "homework_history"] as const;
export const HOMEWORK_MESSAGES = {
  INVALID: "Part of this homework isn't valid. Your changes haven't been saved.",
  STALE: "This homework changed after you opened it. Your changes haven't been saved; reload it to continue.",
  CONFLICT: "This save request was already used for different homework. Your changes haven't been saved.",
  SOURCE: "Source missing or changed — choose a source to continue.",
  STORAGE: "A storage problem stopped this homework from saving. Your changes haven't been saved.",
  UNSUPPORTED: "Homework can't be saved with this database.",
} as const;
export class HomeworkError extends Error {
  constructor(public code: keyof typeof HOMEWORK_MESSAGES) { super(HOMEWORK_MESSAGES[code]); }
}
export function homeworkAssert(value: unknown): asserts value { if (!value) throw new HomeworkError("INVALID"); }
export function parseHomeworkJson(raw: string): unknown {
  homeworkAssert(new TextEncoder().encode(raw).length <= HOMEWORK_LIMIT);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new HomeworkError("INVALID"); }
  homeworkAssert(canonicalJson(value) === raw);
  return value;
}
export function decodeHomeworkOperation(value: unknown): HomeworkOperation {
  const parsed = operationCodec.safeParse(value);
  homeworkAssert(parsed.success);
  homeworkAssert(new TextEncoder().encode(canonicalJson(value)).length <= HOMEWORK_LIMIT);
  return parsed.data;
}
const eq = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const sameExcept = (a: object, b: object, except: string[]) => {
  const omit = (o: object) => Object.fromEntries(Object.entries(o).filter(([k]) => !except.includes(k)));
  return eq(omit(a), omit(b));
};
const targetKeys = ["material_id", "source_material_id", "source_revision", "card_set_id", "test_version_id", "source_test_version_id", "page_start", "page_end"];
const nullablePointer = (live: string | null, source: string | null) => live === null || live === source;

export function validateHomeworkSnapshot(value: unknown): HomeworkSnapshot {
  const parsed = snapshotCodec.safeParse(value); homeworkAssert(parsed.success);
  const s = parsed.data, a = s.assignment;
  homeworkAssert(new TextEncoder().encode(canonicalJson(s)).length <= HOMEWORK_LIMIT);
  homeworkAssert(nullablePointer(a.lesson_id, a.source_lesson_id) && a.updated_at >= a.created_at);
  homeworkAssert((a.state === "completed") === (a.completed_at !== null));
  if (a.completed_at) homeworkAssert(a.completed_at > a.created_at && a.completed_at <= a.updated_at);
  const ids = s.activities.map((e) => e.record.id);
  homeworkAssert(new Set(ids).size === ids.length && eq(ids, [...ids].sort()));
  const active = s.activities.filter((e) => e.record.removed_at === null);
  homeworkAssert(active.length <= 100);
  homeworkAssert(eq(active.map((e) => e.record.position).sort((x, y) => x - y), active.map((_, i) => i)));
  for (const e of s.activities) {
    const r = e.record;
    homeworkAssert(r.assignment_id === a.id && r.created_at >= a.created_at && r.updated_at >= r.created_at && r.updated_at <= a.updated_at);
    homeworkAssert(nullablePointer(r.material_id, r.source_material_id) && nullablePointer(r.test_version_id, r.source_test_version_id));
    homeworkAssert((r.state === "completed") === (r.completed_at !== null) && (r.completed_at !== null) === (e.evidence !== null));
    homeworkAssert((r.page_start === null) === (r.page_end === null));
    homeworkAssert(r.page_start === null || (r.kind === "read" && r.page_end! >= r.page_start));
    homeworkAssert(r.card_set_id === null || r.kind === "cards");
    homeworkAssert(r.source_test_version_id === null || r.kind === "test");
    homeworkAssert(r.source_revision === null || r.source_material_id !== null);
    homeworkAssert((e.source !== null) === (r.source_material_id !== null));
    if (r.kind !== "read") homeworkAssert(e.source?.total_pages == null);
    if (r.kind === "read" && r.page_end !== null) homeworkAssert(r.source_revision && e.source?.total_pages && r.page_end <= e.source.total_pages);
    homeworkAssert((r.card_set_id === null) === (r.kind !== "cards" || r.source_revision === null));
    homeworkAssert((r.source_test_version_id === null) === (r.kind !== "test" || r.source_revision === null));
    if (!["read", "cards", "test"].includes(r.kind)) homeworkAssert(r.source_revision === null);
    if (r.removed_at) homeworkAssert(r.removed_at >= r.created_at && r.removed_at <= a.updated_at);
    if (e.evidence) {
      homeworkAssert(!["cards", "test"].includes(r.kind)); // HW-01d owns session evidence.
      homeworkAssert(r.completed_at! > r.created_at && r.completed_at! <= r.updated_at);
      homeworkAssert(eq(e.evidence, { version: 1, activity_id: r.id, revision: r.revision, cycle: r.cycle, kind: r.kind,
        completed_at: r.completed_at, body: r.body, source_material_id: r.source_material_id, source_revision: r.source_revision,
        page_start: r.page_start, page_end: r.page_end }));
      if (r.kind === "read") homeworkAssert(r.source_revision && r.page_end);
      if (["reflection", "questions"].includes(r.kind)) homeworkAssert(r.body.trim().length > 0);
    }
    // Starting cards/tests and reads requires the future bound session/verified source flow.
    if (r.state === "in_progress") homeworkAssert(!["cards", "test"].includes(r.kind) && (r.kind !== "read" || (r.source_revision && r.page_end)));
  }
  const all = active.length > 0 && active.every((e) => e.record.state === "completed");
  const summary = all ? "completed" : active.some((e) => ["in_progress", "completed"].includes(e.record.state)) ? "in_progress" : "upcoming";
  homeworkAssert(a.state === summary || (a.state === "reopened" && active.some((e) => e.record.state === "reopened")));
  return s;
}

/** Availability-only FK nullification is allowed without an authored revision. */
export function homeworkLiveMatches(snapshot: HomeworkSnapshot, assignment: object, activities: object[]): boolean {
  const expected = structuredClone(snapshot);
  const live = assignment as HomeworkSnapshot["assignment"];
  if (live.lesson_id === null) expected.assignment.lesson_id = null;
  if (live.action_id === null) expected.assignment.action_id = null;
  for (const e of expected.activities) {
    const r = activities.find((a) => (a as HomeworkActivity).id === e.record.id) as HomeworkActivity | undefined;
    if (r?.material_id === null) e.record.material_id = null;
    if (r?.test_version_id === null) e.record.test_version_id = null;
  }
  return eq(expected.assignment, assignment) && eq(expected.activities.map((e) => e.record), activities);
}

/** Guard each authored revision rather than trusting a fixture's state label. */
export function validateHomeworkTransition(previous: HomeworkSnapshot | null, operation: HomeworkOperation): HomeworkSnapshot {
  const next = validateHomeworkSnapshot(operation.next), a = next.assignment;
  const { changeKind: change, at } = operation;
  homeworkAssert(a.id === operation.assignmentId && a.revision === operation.baseRevision + 1 && a.updated_at === at);
  if (!previous) {
    homeworkAssert(change === "create" && operation.baseRevision === 0 && a.state === "upcoming" && a.archived === 0 && a.created_at === at);
    for (const e of next.activities) homeworkAssert(e.record.cycle === 1 && e.record.revision === 1 && e.record.state === "upcoming" && e.record.created_at === at && e.record.updated_at === at && e.record.removed_at === null);
    return next;
  }
  previous = structuredClone(previous);
  if (next.assignment.lesson_id === null && next.assignment.source_lesson_id === previous.assignment.source_lesson_id) previous.assignment.lesson_id = null;
  for (const e of previous.activities) {
    const live = next.activities.find((p) => p.record.id === e.record.id)?.record;
    if (live?.material_id === null && live.source_material_id === e.record.source_material_id) e.record.material_id = null;
    if (live?.test_version_id === null && live.source_test_version_id === e.record.source_test_version_id) e.record.test_version_id = null;
  }
  const old = previous.assignment;
  homeworkAssert(old.revision === operation.baseRevision && at >= old.updated_at && change !== "create");
  homeworkAssert(sameExcept(old, a, ["revision", "updated_at", "state", "completed_at", ...(change === "edit" ? ["title", "instructions", "school", "instructor", "lesson_id", "source_lesson_id", "due_date"] : []), ...(change === "archive" ? ["archived"] : [])]));
  const oldIds = previous.activities.map((e) => e.record.id);
  homeworkAssert(oldIds.every((id) => next.activities.some((e) => e.record.id === id)));
  let affected = 0, reopened = false;
  for (const e of next.activities) {
    const r = e.record, prior = previous.activities.find((p) => p.record.id === r.id);
    if (!prior) {
      homeworkAssert(change === "edit" && r.cycle === 1 && r.revision === 1 && r.state === "upcoming" && r.created_at === at && r.updated_at === at && r.removed_at === null);
      affected++; reopened ||= old.state === "completed"; continue;
    }
    if (eq(prior, e)) continue;
    affected++;
    const p = prior.record;
    homeworkAssert(p.removed_at === null && r.updated_at === at && r.created_at === p.created_at);
    const spec = !sameExcept(p, r, ["kind", "body", ...targetKeys, "title", "position", "updated_at", "state", "completed_at", "revision", "cycle"])
      ? false : !eq([p.kind, p.body, ...targetKeys.map((k) => p[k as keyof HomeworkActivity])], [r.kind, r.body, ...targetKeys.map((k) => r[k as keyof HomeworkActivity])]);
    if (change === "edit" || change === "relink") {
      homeworkAssert(sameExcept(p, r, ["title", "kind", "body", ...targetKeys, "updated_at", "state", "completed_at", "revision", "cycle"]));
      if (change === "relink") homeworkAssert(sameExcept(p, r, [...targetKeys, "updated_at", "state", "completed_at", "revision", "cycle"]));
      homeworkAssert(r.revision === p.revision + (spec ? 1 : 0) && r.cycle === p.cycle + (spec ? 1 : 0));
      if (spec) { homeworkAssert(r.state === "reopened" && r.completed_at === null && e.evidence === null); reopened = true; }
      else homeworkAssert(r.state === p.state && r.completed_at === p.completed_at && eq(e.evidence, prior.evidence) && eq(e.source, prior.source));
    } else if (change === "complete") {
      homeworkAssert(sameExcept(p, r, ["state", "completed_at", "updated_at"]) && eq(e.source, prior.source));
      homeworkAssert(p.state !== "completed" && r.state === "completed" && r.completed_at === at && at > p.created_at);
    } else if (change === "reopen") {
      homeworkAssert(sameExcept(p, r, ["cycle", "state", "completed_at", "updated_at"]) && eq(e.source, prior.source));
      homeworkAssert(r.cycle === p.cycle + 1 && r.state === "reopened" && r.completed_at === null && e.evidence === null); reopened = true;
    } else if (change === "reorder" || change === "remove_activity") {
      homeworkAssert(sameExcept(p, r, ["position", "updated_at", ...(change === "remove_activity" ? ["removed_at"] : [])]) && eq(e.source, prior.source) && eq(e.evidence, prior.evidence));
      if (r.removed_at !== null) homeworkAssert(change === "remove_activity" && r.removed_at === at);
    } else homeworkAssert(false);
  }
  if (change === "reopen" || change === "complete" || change === "relink") homeworkAssert(affected > 0);
  if (change === "archive") homeworkAssert(affected === 0 && old.archived !== a.archived);
  if (reopened) homeworkAssert(a.state === "reopened");
  else if (change === "complete") homeworkAssert(a.state !== "reopened");
  else if (a.state === "reopened") homeworkAssert(old.state === "reopened");
  if (a.state === "completed") homeworkAssert(a.completed_at === (old.state === "completed" ? old.completed_at : at));
  return next;
}
