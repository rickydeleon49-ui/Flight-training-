/** Card attribution inside the caller's owned transaction; never opens a nested transaction. */
import type { CardItemAction } from "@/domain/types";
import { HomeworkError, homeworkAssert, parseHomeworkJson, type HomeworkSnapshot, type HomeworkCardRun, type HomeworkRun, type HomeworkOperation } from "@/domain/homework";
import { canonicalJson, deriveCurrentCards, sha256Hex } from "@/logic/cardIdentity";
import { cardReviewRepository } from "./repositories/cardReviewRepository";
import type { SqlValue } from "./db";
import type { ValidationQuery } from "./practiceStateValidation";
import { applyHomeworkOperation } from "./homeworkTransaction";
type Run = (sql: string, params: SqlValue[]) => void | Promise<void>;

export const homeworkRunRow = (r: HomeworkRun) => {
    if (r.kind === "cards") {
        return {
            id: r.id, activity_id: r.activity_id, cycle: r.cycle, activity_revision: r.activity_revision, kind: r.kind,
            scope_json: canonicalJson(r.scope), evidence_json: r.finished_at ? canonicalJson(r.ratings) : null,
            attempt_id: null, source_attempt_id: null,
            started_at: r.started_at, finished_at: r.finished_at, invalidated_at: r.invalidated_at
        };
    }
    return {
        id: r.id, activity_id: r.activity_id, cycle: r.cycle, activity_revision: r.activity_revision, kind: r.kind,
        scope_json: canonicalJson(r.scope), evidence_json: r.finished_at ? canonicalJson(r.evidence) : null,
        attempt_id: r.scope.attempt_id, source_attempt_id: r.scope.attempt_id,
        started_at: r.started_at, finished_at: r.finished_at, invalidated_at: r.invalidated_at
    };
};

export async function homeworkCardQueue(query: ValidationQuery, materialId: string, at: string, midnight: string) {
    const repo = cardReviewRepository({ select: async <T>(s: string, p: SqlValue[] = []) => await query(s, p) as T[], execute: async () => { } });
    const snapshot = await repo.getCardReviewSnapshot(materialId);
    if (snapshot.current.status !== "ok")
        throw new HomeworkError("SOURCE");
    const queue = await repo.getDueQueue({ materialId, currentVersionId: snapshot.current.versionId, currentItemIds: snapshot.current.items.map(x => x.itemId), nowUtc: at, nextLocalMidnightUtc: midnight });
    return { snapshot, queue };
}

export async function validateHomeworkRunWrites(query: ValidationQuery, previous: HomeworkSnapshot | null, op: HomeworkOperation) {
    for (const r of op.next.runs) {
        const prior = previous?.runs.find(p => p.id === r.id);
        if (!prior) {
            homeworkAssert(!op.next.assignment.archived);
            if (r.kind === "cards") {
                const { snapshot, queue } = await homeworkCardQueue(query, r.scope.material_id, op.at, r.scope.next_local_midnight);
                homeworkAssert(snapshot.current.status === "ok" && snapshot.current.versionId === r.scope.card_set_id && snapshot.current.contentHash === r.scope.source_revision && snapshot.generation === r.scope.generation);
                homeworkAssert(canonicalJson(queue.map(x => x.itemId)) === canonicalJson(r.scope.item_ids));
            } else if (r.kind === "test") {
                const [v] = await query("SELECT source_material_id, history_key, content_hash FROM practice_test_versions WHERE id=?", [r.scope.test_version_id]);
                homeworkAssert(v && (v.source_material_id === r.scope.material_id || v.source_material_id === null) && v.history_key === r.scope.material_id && v.content_hash === r.scope.source_revision);
            }
        }
        if (r.kind === "cards") {
            const cardPrior = prior as HomeworkCardRun | undefined;
            if (r.ratings.length > (cardPrior?.ratings.length ?? 0))
                await checkCardEvents(query, op.next, r, true);
        } else if (r.kind === "test") {
            if (r.finished_at && (!prior || !prior.finished_at)) {
                await checkRunEvents(query, op.next, r, true);
            }
        }
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

export async function checkRunEvents(query: ValidationQuery, s: HomeworkSnapshot, r: HomeworkRun, writing = false) {
    if (r.kind === "cards") {
        return checkCardEvents(query, s, r, writing);
    }
    const [v] = await query("SELECT source_material_id, history_key, content_hash FROM practice_test_versions WHERE id=?", [r.scope.test_version_id]);
    if (v) {
        homeworkAssert((v.source_material_id === r.scope.material_id || v.source_material_id === null) && v.history_key === r.scope.material_id && v.content_hash === r.scope.source_revision);
    }
    const [attempt] = await query("SELECT * FROM practice_attempts WHERE id=?", [r.scope.attempt_id]);
    if (attempt) {
        homeworkAssert(attempt.version_id === r.scope.test_version_id && (attempt.source_material_id === r.scope.material_id || attempt.source_material_id === null) && attempt.started_at === r.started_at);
        if (r.finished_at) {
            homeworkAssert(attempt.status === "completed" && attempt.completed_at === r.finished_at);
            homeworkAssert(r.evidence && r.evidence.version === 1 && r.evidence.attempt_id === attempt.id && r.evidence.version_id === attempt.version_id);
            if (r.evidence.score_percent !== null && attempt.score_percent !== null) {
                homeworkAssert(Number(attempt.score_percent) === r.evidence.score_percent);
            }
            homeworkAssert(Number(attempt.total_questions) === r.evidence.total_questions);
            homeworkAssert(Number(attempt.answered_count) === r.evidence.answered_count);
            homeworkAssert(Number(attempt.correct_count) === r.evidence.correct_count);
            homeworkAssert(Number(attempt.incorrect_count) === r.evidence.incorrect_count);
            homeworkAssert(Number(attempt.dont_know_count) === r.evidence.dont_know_count);
        }
    } else if (writing) {
        homeworkAssert(false);
    }
}

export async function validateHomeworkRunRows(query: ValidationQuery, s: HomeworkSnapshot) {
    const rows = await query("SELECT r.* FROM homework_runs r JOIN homework_activities a ON a.id=r.activity_id WHERE a.assignment_id=? ORDER BY r.id", [s.assignment.id]);
    const expected = [];
    for (const r of s.runs) {
        const row = homeworkRunRow(r);
        if (r.kind === "test" && !(await query("SELECT id FROM practice_attempts WHERE id=?", [r.scope.attempt_id])).length) row.attempt_id = null;
        expected.push(row);
    }
    homeworkAssert(canonicalJson(rows) === canonicalJson(expected));
    for (const r of s.runs)
        await checkRunEvents(query, s, r);
}
export const validateHomeworkCardRows = validateHomeworkRunRows;

export async function projectHomeworkAction(
    run: Run,
    query: ValidationQuery,
    assignment: HomeworkSnapshot["assignment"],
    activities: HomeworkSnapshot["activities"],
    at: string
): Promise<string | null> {
    if (!assignment.action_id) return null;
    const active = activities.filter(a => !a.record.removed_at).sort((a,b) => a.record.position - b.record.position);
    const dismissed = active.length === 0 || assignment.archived === 1;
    const nextIncomplete = active.find(a => a.record.state !== "completed");
    const status = dismissed ? "dismissed" : nextIncomplete ? "open" : "completed";
    const title = nextIncomplete?.record.title ?? active.at(-1)?.record.title ?? assignment.title;
    const completedAt = status === "completed" ? (assignment.completed_at ?? at) : null;

    const [existing] = await query("SELECT id FROM next_actions WHERE id=?", [assignment.action_id]);
    if (existing) {
        const [owner] = await query("SELECT id FROM homework_assignments WHERE action_id=?", [assignment.action_id]);
        homeworkAssert(owner?.id === assignment.id, "action_already_owned");
        await run(
            "UPDATE next_actions SET title=?, category='prepare', status=?, due_date=?, updated_at=?, completed_at=? WHERE id=?",
            [title, status, assignment.due_date, at, completedAt, assignment.action_id]
        );
    } else {
        await run(
            "INSERT INTO next_actions (id, title, description, category, priority, status, due_date, estimated_minutes, related_type, related_id, material_id, source_material_id, created_at, updated_at, completed_at) VALUES (?, ?, '', 'prepare', 'important', ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)",
            [assignment.action_id, title, status, assignment.due_date, at, at, completedAt]
        );
    }
    return assignment.action_id;
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
    const next = structuredClone(previous), r = next.runs.find(r => r.id === c.runId && r.kind === "cards") as HomeworkCardRun | undefined;
    homeworkAssert(r && r.cycle === c.cycle && r.activity_revision === c.activityRevision && !r.finished_at && !r.invalidated_at, "run_not_open");
    const entry = next.activities.find(e => e.record.id === r.activity_id)!;
    homeworkAssert(entry.record.cycle === c.cycle && entry.record.revision === c.activityRevision && !entry.record.removed_at && entry.record.material_id === action.materialId, "activity_not_in_run");
    homeworkAssert(r.scope.material_id === action.materialId && r.scope.source_revision === action.versionContentHash && r.scope.generation === action.expectedGeneration && r.scope.item_ids.includes(action.itemId) && !r.ratings.some(x => x.item_id === action.itemId) && at > r.started_at && at >= previous.assignment.updated_at, "outside_frozen_scope");
    r.ratings.push({ event_id: action.operationId, operation_id: action.operationId, item_id: action.itemId, generation: action.expectedGeneration, reviewed_at: at, rating: action.rating, item_revision: action.expectedRevision, assignment_revision: c.expectedRevision });
    entry.record.updated_at = at;
    if (r.ratings.length === r.scope.item_ids.length) {
        r.finished_at = at;
        entry.record.state = "completed";
        entry.record.completed_at = at;
        const a = entry.record;
        entry.evidence = { version: 2, answer: a.answer ?? "", activity_id: a.id, revision: a.revision, cycle: a.cycle, kind: a.kind, completed_at: at, body: a.body, source_material_id: a.source_material_id, source_revision: a.source_revision, page_start: a.page_start, page_end: a.page_end };
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
        for (const r of next.runs.filter((r): r is HomeworkCardRun => r.kind === "cards" && !r.finished_at && !r.invalidated_at && r.scope.material_id === materialId)) {
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
