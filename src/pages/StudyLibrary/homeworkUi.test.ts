import { describe, expect, it } from "vitest";
import { applyMigrations } from "@/data/migrations";
import { executeHomeworkOperation } from "@/data/homeworkTransaction";
import { homeworkRepository } from "@/data/repositories/homeworkRepository";
import { validateHomeworkState } from "@/data/practiceStateValidation";
import { ENGINES, openEngine, schemaReference } from "@/data/testing/skillEvidenceEngines";
import { validateHomeworkTransition, type HomeworkSnapshot } from "@/domain/homework";
import { newHomework, newHomeworkActivity, homeworkOperation, activeHomework, homeworkHistoryLabel, activityStateLabel } from "./homeworkUi";
import type { SqlValue } from "@/data/db";
describe.each(ENGINES)("Homework UI requests through HW-01b: %s", name => {
    it("manual kinds persist, complete, reorder, reopen, remove and retain history", async () => {
        const engine = await openEngine(name);
        try {
            await applyMigrations(sql => engine.exec(sql), new Set());
            const repo = homeworkRepository({ select: async <T>(sql: string, p: SqlValue[] = []) => engine.query(sql, p) as T[], execute: async () => { }, saveHomeworkAtomically: op => executeHomeworkOperation(sql => engine.exec(sql), (sql, p) => engine.run(sql, p), (sql, p) => engine.query(sql, p), op) });
            const empty = newHomework(), draft = structuredClone(empty);
            draft.assignment.title = "Synthetic preparation";
            draft.activities = ["checklist", "reflection", "questions"].map((kind, i) => { const e = newHomeworkActivity(draft.assignment.id, i, kind as "checklist", draft.assignment.created_at); e.record.body = "Prompt"; e.record.answer = ["reflection", "questions"].includes(kind) ? "Saved response" : ""; return e; });
            await repo.save(homeworkOperation(empty, draft, "create", true));
            let current = (await repo.get(draft.assignment.id))!;
            for (const e of activeHomework(current)) {
                const next = structuredClone(current);
                next.activities.find(x => x.record.id === e.record.id)!.record.state = "completed";
                await repo.save(homeworkOperation(current, next, "complete"));
                current = (await repo.get(draft.assignment.id))!;
            }
            expect(current.assignment.state).toBe("completed");
            expect((await repo.history(current.assignment.id)).length).toBe(4);
            const completed = structuredClone(current);
            const reopened = structuredClone(current);
            reopened.activities[0]!.record.cycle++;
            await repo.save(homeworkOperation(current, reopened, "reopen"));
            current = (await repo.get(draft.assignment.id))!;
            const evidenceBefore = current.activities.map(e => e.evidence);
            const next = structuredClone(current);
            activeHomework(next).reverse().forEach((e, i) => { e.record.position = i; });
            await repo.save(homeworkOperation(current, next, "reorder"));
            current = (await repo.get(draft.assignment.id))!;
            expect(current.activities.map(e => e.evidence)).toEqual(evidenceBefore);
            const removed = structuredClone(current);
            removed.activities[1]!.record.removed_at = new Date().toISOString();
            activeHomework(removed).forEach((e, i) => { e.record.position = i; });
            await repo.save(homeworkOperation(current, removed, "remove_activity"));
            const archived = (await repo.get(draft.assignment.id))!;
            archived.assignment.archived = 1;
            await repo.save(homeworkOperation((await repo.get(draft.assignment.id))!, archived, "archive"));
            expect((await repo.history(draft.assignment.id)).length).toBe(8);
            const prior = JSON.parse(String((await repo.history(draft.assignment.id))[3]!.snapshot_json)) as HomeworkSnapshot;
            expect(prior.activities).toEqual(completed.activities);
            await validateHomeworkState((sql, p) => engine.query(sql, p), await schemaReference());
        }
        finally {
            engine.close();
        }
    });
});
it("adding_activity_to_completed_assignment_reopens_it", () => {
    const base = newHomework();
    base.assignment.title = "Synthetic";
    base.activities = [newHomeworkActivity(base.assignment.id, 0, "checklist", base.assignment.created_at)];
    const created = homeworkOperation(base, base, "create", true);
    const previous = validateHomeworkTransition(null, created);
    const draft = structuredClone(previous);
    draft.activities[0]!.record.state = "completed";
    const complete = homeworkOperation(previous, draft, "complete");
    const completed = validateHomeworkTransition(previous, complete);
    const adding = structuredClone(completed);
    adding.activities.push(newHomeworkActivity(completed.assignment.id, 1, "checklist", completed.assignment.created_at));
    const next = validateHomeworkTransition(completed, homeworkOperation(completed, adding, "edit"));
    expect(next.assignment.state).toBe("in_progress");
    expect(next.assignment.completed_at).toBeNull();
    expect(next.activities.find(e => e.record.id === completed.activities[0]!.record.id)).toEqual(completed.activities[0]);
});

it("history_labels_answer_saved", () => {
    const base = newHomework();
    base.assignment.title = "Debrief notes";
    const act = newHomeworkActivity(base.assignment.id, 0, "reflection", base.assignment.created_at);
    act.record.title = "Solo flight debrief";
    act.record.body = "";
    base.activities = [act];
    const prev = validateHomeworkTransition(null, homeworkOperation(base, base, "create", true));

    const draft = structuredClone(prev);
    draft.activities[0]!.record.answer = "Felt comfortable in the traffic pattern.";
    const edited = validateHomeworkTransition(prev, homeworkOperation(prev, draft, "edit"));

    const prevRow = {
        change_kind: "create",
        revision: prev.assignment.revision,
        snapshot_json: JSON.stringify(prev),
    };
    const row = {
        change_kind: "edit",
        revision: edited.assignment.revision,
        snapshot_json: JSON.stringify(edited),
    };

    expect(homeworkHistoryLabel(row, prevRow)).toBe("Answer saved: Solo flight debrief");

    // Ordinary edit on an activity title still says "Homework edited"
    const titleEditDraft = structuredClone(edited);
    titleEditDraft.activities[0]!.record.title = "Updated title";
    const titleEdited = validateHomeworkTransition(edited, homeworkOperation(edited, titleEditDraft, "edit"));
    const titleRow = {
        change_kind: "edit",
        revision: titleEdited.assignment.revision,
        snapshot_json: JSON.stringify(titleEdited),
    };
    expect(homeworkHistoryLabel(titleRow, row)).toBe("Homework edited: Updated title");
});

it("saving_answer_on_unstarted_activity_does_not_reopen", () => {
    const base = newHomework();
    base.assignment.title = "Debrief notes";
    const act = newHomeworkActivity(base.assignment.id, 0, "reflection", base.assignment.created_at);
    act.record.title = "Solo flight debrief";
    base.activities = [act];
    const created = validateHomeworkTransition(null, homeworkOperation(base, base, "create", true));
    const draft = structuredClone(created);
    draft.activities[0]!.record.answer = "Felt comfortable in the traffic pattern.";
    const saved = validateHomeworkTransition(created, homeworkOperation(created, draft, "edit"));
    const id = saved.activities[0]!.record.id;
    const history = [created, saved].map((s, i) => ({ change_kind: i ? "edit" : "create", revision: s.assignment.revision, snapshot_json: JSON.stringify(s) }));
    // Storage marks any text change "reopened"; never completed, so she sees "In progress".
    expect(saved.activities[0]!.record.state).toBe("reopened");
    expect(activityStateLabel(saved.activities[0]!.record.state, id, history)).toBe("In progress");

    const done = structuredClone(saved);
    done.activities[0]!.record.state = "completed";
    const completed = validateHomeworkTransition(saved, homeworkOperation(saved, done, "complete"));
    const again = structuredClone(completed);
    again.activities[0]!.record.answer = "Also practised go-arounds.";
    const changed = validateHomeworkTransition(completed, homeworkOperation(completed, again, "edit"));
    const fullHistory = [...history, ...[completed, changed].map((s, i) => ({ change_kind: i ? "edit" : "complete", revision: s.assignment.revision, snapshot_json: JSON.stringify(s) }))];
    expect(activityStateLabel(changed.activities[0]!.record.state, id, fullHistory)).toBe("Reopened");
    expect(activityStateLabel("upcoming", id, [])).toBe("To do");
});
