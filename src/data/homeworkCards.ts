/** Card attribution inside the caller's owned transaction; never opens a nested transaction. */
import type { CardItemAction } from "@/domain/types";
import { HomeworkError, homeworkAssert, parseHomeworkJson, type HomeworkSnapshot, type HomeworkCardRun, type HomeworkOperation } from "@/domain/homework";
import { canonicalJson, deriveCurrentCards, sha256Hex } from "@/logic/cardIdentity";
import { cardReviewRepository } from "./repositories/cardReviewRepository";
import type { SqlValue } from "./db";
import type { ValidationQuery } from "./practiceStateValidation";
import { applyHomeworkOperation } from "./homeworkTransaction";
type Run = (sql: string, params: SqlValue[]) => void | Promise<void>;
export const cardRunRow = (r: HomeworkCardRun) => ({ id: r.id, activity_id: r.activity_id, cycle: r.cycle, activity_revision: r.activity_revision, kind: r.kind,
    scope_json: canonicalJson(r.scope), evidence_json: r.finished_at ? canonicalJson(r.ratings) : null, attempt_id: null, source_attempt_id: null,
    started_at: r.started_at, finished_at: r.finished_at, invalidated_at: r.invalidated_at });
export async function homeworkCardQueue(query: ValidationQuery, materialId: string, at: string, midnight: string) {
    const repo = cardReviewRepository({ select: async <T>(s: string, p: SqlValue[] = []) => await query(s, p) as T[], execute: async () => { } });
    const snapshot = await repo.getCardReviewSnapshot(materialId);
    if (snapshot.current.status !== "ok")
        throw new HomeworkError("SOURCE");
    const queue = await repo.getDueQueue({ materialId, currentVersionId: snapshot.current.versionId, currentItemIds: snapshot.current.items.map(x => x.itemId), nowUtc: at, nextLocalMidnightUtc: midnight });
    return { snapshot, queue };
}
export async function validateHomeworkCardWrites(query: ValidationQuery, previous: HomeworkSnapshot | null, op: HomeworkOperation) {
    for (const r of op.next.runs) {
        const prior = previous?.runs.find(p => p.id === r.id);
        if (!prior) {
            homeworkAssert(!op.next.assignment.archived);
            const { snapshot, queue } = await homeworkCardQueue(query, r.scope.material_id, op.at, r.scope.next_local_midnight);
            homeworkAssert(snapshot.current.status === "ok" && snapshot.current.versionId === r.scope.card_set_id && snapshot.current.contentHash === r.scope.source_revision && snapshot.generation === r.scope.generation);
            homeworkAssert(canonicalJson(queue.map(x => x.itemId)) === canonicalJson(r.scope.item_ids));
        }
        if (r.ratings.length > (prior?.ratings.length ?? 0))
            await checkCardEvents(query, op.next, r, true);
    }
}
function ratingAction(s: HomeworkSnapshot, r: HomeworkCardRun, x: HomeworkCardRun["ratings"][number]): Extract<CardItemAction, {
    action: "rate";
}> {
    return { action: "rate", operationId: x.operation_id, materialId: r.scope.material_id, versionContentHash: r.scope.source_revision, itemId: x.item_id, expectedGeneration: x.generation, expectedRevision: x.item_revision, rating: x.rating,
        homework: { assignmentId: s.assignment.id, runId: r.id, expectedRevision: x.assignment_revision, activityRevision: r.activity_revision, cycle: r.cycle } };
}
/** Missing events/erased receipts retain their previously accepted historical associations. */
export async function checkCardEvents(query: ValidationQuery, s: HomeworkSnapshot, r: HomeworkCardRun, writing = false) {
    homeworkAssert(r.scope.card_set_id === await sha256Hex(`${r.scope.material_id}\0${r.scope.source_revision}`));
    const [set] = await query("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id=?", [r.scope.material_id]);
    const current = await deriveCurrentCards(r.scope.material_id, typeof set?.flashcards_json === "string" ? set.flashcards_json : null);
    if (current.status === "ok" && current.versionId === r.scope.card_set_id)
        homeworkAssert(r.scope.item_ids.every(id => current.items.some(item => item.itemId === id)));
    for (const id of r.scope.item_ids) {
        const [stored] = await query("SELECT i.version_id,v.source_material_id FROM card_items i JOIN card_versions v ON v.id=i.version_id WHERE i.id=?", [id]);
        if (stored)
            homeworkAssert(stored.version_id === r.scope.card_set_id && stored.source_material_id === r.scope.material_id);
    }
    for (const x of r.ratings) {
        const [event] = await query("SELECT * FROM card_review_events WHERE id=?", [x.event_id]);
        const [receipt] = await query("SELECT * FROM card_review_operations WHERE operation_id=?", [x.operation_id]);
        if (event)
            homeworkAssert(event.item_id === x.item_id && event.generation === x.generation && event.reviewed_at === x.reviewed_at && event.rating === x.rating);
        if (receipt) {
            homeworkAssert(receipt.action === "rate" && receipt.source_material_id === r.scope.material_id && receipt.generation === x.generation && receipt.applied_at === x.reviewed_at && receipt.request_hash === await sha256Hex(canonicalJson(ratingAction(s, r, x))));
            if (Number(receipt.is_erased) === 0) {
                const result = parseHomeworkJson(String(receipt.result_json)) as Record<string, unknown>;
                homeworkAssert(result.itemId === x.item_id && result.reviewedAt === x.reviewed_at && result.revision === x.item_revision + 1);
            }
        }
        if (writing)
            homeworkAssert(event && receipt && Number(receipt.is_erased) === 0);
    }
}
export async function validateHomeworkCardRows(query: ValidationQuery, s: HomeworkSnapshot) {
    const rows = await query("SELECT r.* FROM homework_runs r JOIN homework_activities a ON a.id=r.activity_id WHERE a.assignment_id=? ORDER BY r.id", [s.assignment.id]);
    homeworkAssert(canonicalJson(rows) === canonicalJson(s.runs.map(cardRunRow)));
    for (const r of s.runs)
        await checkCardEvents(query, s, r);
}
async function latest(query: ValidationQuery, id: string): Promise<HomeworkSnapshot> {
    const [h] = await query("SELECT snapshot_json FROM homework_history WHERE assignment_id=? ORDER BY revision DESC LIMIT 1", [id]);
    homeworkAssert(h);
    return parseHomeworkJson(String(h.snapshot_json)) as HomeworkSnapshot;
}
export async function recordHomeworkCardRating(run: Run, query: ValidationQuery, action: Extract<CardItemAction, {
    action: "rate";
}>, at: string) {
    const c = action.homework!;
    const previous = await latest(query, c.assignmentId);
    if (previous.assignment.revision !== c.expectedRevision)
        throw new HomeworkError("STALE");
    homeworkAssert(!previous.assignment.archived);
    const next = structuredClone(previous), r = next.runs.find(r => r.id === c.runId);
    homeworkAssert(r && r.cycle === c.cycle && r.activity_revision === c.activityRevision && !r.finished_at && !r.invalidated_at);
    const entry = next.activities.find(e => e.record.id === r.activity_id)!;
    homeworkAssert(entry.record.cycle === c.cycle && entry.record.revision === c.activityRevision && !entry.record.removed_at && entry.record.material_id === action.materialId);
    homeworkAssert(r.scope.material_id === action.materialId && r.scope.source_revision === action.versionContentHash && r.scope.generation === action.expectedGeneration && r.scope.item_ids.includes(action.itemId) && !r.ratings.some(x => x.item_id === action.itemId) && at > r.started_at && at >= previous.assignment.updated_at);
    r.ratings.push({ event_id: action.operationId, operation_id: action.operationId, item_id: action.itemId, generation: action.expectedGeneration, reviewed_at: at, rating: action.rating, item_revision: action.expectedRevision, assignment_revision: c.expectedRevision });
    entry.record.updated_at = at;
    if (r.ratings.length === r.scope.item_ids.length) {
        r.finished_at = at;
        entry.record.state = "completed";
        entry.record.completed_at = at;
        const a = entry.record;
        entry.evidence = { version: 1, activity_id: a.id, revision: a.revision, cycle: a.cycle, kind: a.kind, completed_at: at, body: a.body, source_material_id: a.source_material_id, source_revision: a.source_revision, page_start: a.page_start, page_end: a.page_end };
    }
    next.assignment.revision++;
    next.assignment.updated_at = at;
    const active = next.activities.filter(e => !e.record.removed_at);
    next.assignment.state = active.every(e => e.record.state === "completed") ? "completed" : "in_progress";
    next.assignment.completed_at = next.assignment.state === "completed" ? at : null;
    await applyHomeworkOperation(run, query, { version: 1, operationId: action.operationId, assignmentId: c.assignmentId, baseRevision: c.expectedRevision, changeKind: "record_evidence", at, next });
}
/** Reset invalidation is part of the reset transaction, retaining partial associations. */
export async function invalidateHomeworkCardRuns(run: Run, query: ValidationQuery, materialId: string, at: string, driftOnly = false) {
    // Card review is available to schema-12 clients too.
    if (!(await query("SELECT name FROM sqlite_master WHERE type='table' AND name='homework_runs'", [])).length)
        return;
    const [set] = await query("SELECT flashcards_json FROM ai_study_sets WHERE source_material_id=?", [materialId]);
    const current = driftOnly ? await deriveCurrentCards(materialId, typeof set?.flashcards_json === "string" ? set.flashcards_json : null) : null;
    const assignments = await query("SELECT DISTINCT a.assignment_id FROM homework_runs r JOIN homework_activities a ON a.id=r.activity_id WHERE r.kind='cards' AND r.finished_at IS NULL AND r.invalidated_at IS NULL", []);
    for (const a of assignments) {
        const previous = await latest(query, String(a.assignment_id)), next = structuredClone(previous);
        let changed = false;
        for (const r of next.runs.filter(r => !r.finished_at && !r.invalidated_at && r.scope.material_id === materialId)) {
            if (driftOnly && current?.status === "ok" && current.versionId === r.scope.card_set_id)
                continue;
            homeworkAssert(at >= previous.assignment.updated_at);
            r.invalidated_at = at;
            const e = next.activities.find(e => e.record.id === r.activity_id)!;
            e.record.cycle++;
            e.record.state = "reopened";
            e.record.updated_at = at;
            e.record.completed_at = null;
            e.evidence = null;
            changed = true;
        }
        if (!changed)
            continue;
        next.assignment.revision++;
        next.assignment.updated_at = at;
        next.assignment.state = "reopened";
        next.assignment.completed_at = null;
        await applyHomeworkOperation(run, query, { version: 1, operationId: crypto.randomUUID(), assignmentId: next.assignment.id, baseRevision: previous.assignment.revision, changeKind: "reopen", at, next });
    }
}
