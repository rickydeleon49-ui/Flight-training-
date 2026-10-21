import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { homeworkOperation } from "@/pages/StudyLibrary/homeworkUi";
import { executeStudySetSave, SET_COLUMNS } from "./studySetTransaction";
import { executeHomeworkOperation } from "./homeworkTransaction";
import { executeCardReviewAction } from "./cardReviewTransaction";
import { applyMigrations } from "./migrations";
import { validateHomeworkState } from "./practiceStateValidation";
import { ENGINES, openEngine, schemaReference, dumpTables } from "./testing/skillEvidenceEngines";
import { cardVersion } from "@/logic/cardIdentity";
import type { HomeworkOperation } from "@/domain/homework";
const F = JSON.parse(readFileSync("src-tauri/fixtures/homework-validation/cases.json", "utf8"));
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const cards = [{ front: "One", back: "First", sourcePage: null }, { front: "Two", back: "Second", sourcePage: null }];
const T = "2026-10-21T10:01:00.000Z", T2 = "2026-10-21T10:02:00.000Z";
describe.each(ENGINES)("homework cards: %s", name => {
    async function setup(customCards = cards) {
        const e = await openEngine(name);
        await applyMigrations(s => e.exec(s), new Set());
        for (const sql of F.baseline)
            e.exec(sql);
        e.run("INSERT INTO ai_study_sets (source_material_id,provider,flashcards_json,generated_at,updated_at) VALUES (?,'import',?,?,?)", [id(5), JSON.stringify(customCards), T, T]);
        const version = await cardVersion(id(5), customCards);
        const create = structuredClone(F.operations.create) as HomeworkOperation;
        create.next.activities = [create.next.activities[0]!];
        Object.assign(create.next.activities[0]!.record, { kind: "cards", material_id: id(5), source_material_id: id(5), source_revision: version.contentHash, card_set_id: version.versionId });
        create.next.activities[0]!.source = { title: "Synthetic source", total_pages: null };
        const act = (o: unknown) => executeHomeworkOperation(s => e.exec(s), (s, p) => e.run(s, p), (s, p) => e.query(s, p), o);
        const rate = (o: unknown) => executeCardReviewAction(s => e.exec(s), (s, p) => e.run(s, p), (s, p) => e.query(s, p), o, T2);
        await act(create);
        const start = structuredClone(create) as unknown as Record<string, any>;
        start.operationId = id(110);
        start.baseRevision = 1;
        start.at = T;
        start.changeKind = "start";
        Object.assign(start.next.assignment, { revision: 2, updated_at: T, state: "in_progress" });
        Object.assign(start.next.activities[0].record, { state: "in_progress", updated_at: T });
        start.next.runs = [{ id: id(111), activity_id: id(2), cycle: 1, activity_revision: 1, kind: "cards", started_at: T, finished_at: null, invalidated_at: null,
                scope: { version: 1, material_id: id(5), source_revision: version.contentHash, card_set_id: version.versionId, generation: 0, item_ids: version.items.map(x => x.itemId), next_local_midnight: "2026-10-22T00:00:00.000Z" }, ratings: [] }];
        const rating = (i: number, rev = 2) => ({ action: "rate", operationId: id(120 + i), materialId: id(5), versionContentHash: version.contentHash, itemId: version.items[i]!.itemId, expectedGeneration: 0, expectedRevision: 0, rating: "again", homework: { assignmentId: id(1), runId: id(111), expectedRevision: rev, activityRevision: 1, cycle: 1 } });
        const validate = async () => validateHomeworkState((s, p) => e.query(s, p), await schemaReference());
        return { e, act, rate, start, rating, validate };
    }
    it("rating_outside_frozen_queue_is_refused_and_never_counts", async () => {
        const elevenCards = Array.from({ length: 11 }, (_, i) => ({ front: `Front ${i}`, back: `Back ${i}`, sourcePage: null }));
        const { e, act, rate, start, rating, validate } = await setup(elevenCards);
        try {
            start.next.runs[0].scope.item_ids = start.next.runs[0].scope.item_ids.slice(0, 10);
            await act(start);
            const before = dumpTables(e);
            let thrown: any;
            try {
                await rate(rating(10));
            } catch (err: any) {
                thrown = err;
            }
            expect(thrown).toBeDefined();
            expect(String(thrown?.cause?.stack || thrown?.stack)).toContain("homeworkCards.ts:91");
            expect(dumpTables(e)).toEqual(before);
            expect(e.query("SELECT state FROM homework_activities")[0]!.state).toBe("in_progress");
            expect(e.query("SELECT evidence_json FROM homework_runs")[0]!.evidence_json).toBeNull();
            expect(JSON.parse(String(e.query("SELECT snapshot_json FROM homework_history ORDER BY revision DESC LIMIT 1")[0]!.snapshot_json)).runs[0].ratings).toEqual([]);
            await validate();

            for (let i = 0; i < 9; i++) {
                await rate(rating(i, 2 + i));
                expect(e.query("SELECT state FROM homework_activities")[0]!.state).toBe("in_progress");
                await expect(rate({ ...rating(10, 3 + i), operationId: id(200 + i) })).rejects.toThrow();
                expect(e.query("SELECT state FROM homework_activities")[0]!.state).toBe("in_progress");
            }
            await rate(rating(9, 11));
            expect(e.query("SELECT state FROM homework_activities")[0]!.state).toBe("completed");
            expect(JSON.parse(String(e.query("SELECT evidence_json FROM homework_runs")[0]!.evidence_json))).toHaveLength(10);
            await validate();
        }
        finally {
            e.close();
        }
    });
    it("card_run_completes_only_with_all_frozen_items_rated_in_run", async () => {
        const { e, act, rate, start, rating, validate } = await setup();
        try {
            await act(start);
            await rate(rating(0));
            expect(e.query("SELECT state FROM homework_activities")[0]!.state).toBe("in_progress");
            expect(e.query("SELECT evidence_json FROM homework_runs")[0]!.evidence_json).toBeNull();
            expect(e.query("SELECT change_kind FROM homework_history ORDER BY revision").map(x => x.change_kind)).toEqual(["create", "start", "record_evidence"]);
            await validate();
            await rate(rating(1, 3));
            await validate();
            expect(e.query("SELECT state FROM homework_activities")[0]!.state).toBe("completed");
            expect(JSON.parse(String(e.query("SELECT evidence_json FROM homework_runs")[0]!.evidence_json))).toHaveLength(2);
            const before = dumpTables(e);
            await rate(rating(1, 3));
            expect(dumpTables(e)).toEqual(before);
        }
        finally {
            e.close();
        }
    });
    it("ratings_elsewhere_never_complete_homework", async () => {
        const { e, act, rate, start, rating, validate } = await setup();
        try {
            await act(start);
            for (let i = 0; i < 2; i++) {
                const { homework, ...ordinary } = rating(i);
                await rate(ordinary);
            }
            expect(e.query("SELECT state FROM homework_activities")[0]!.state).toBe("in_progress");
            expect(e.query("SELECT COUNT(*) AS n FROM homework_history")[0]!.n).toBe(2);
            await validate();
        }
        finally {
            e.close();
        }
    });
    it("card_run_restart_resumes_frozen_queue", async () => {
        const { e, act, rate, start, rating, validate } = await setup();
        try {
            await act(start);
            await rate(rating(0));
            const s = JSON.parse(String(e.query("SELECT snapshot_json FROM homework_history ORDER BY revision DESC LIMIT 1")[0]!.snapshot_json));
            expect(s.runs[0].scope.item_ids).toEqual(start.next.runs[0].scope.item_ids);
            expect(s.runs[0].ratings.map((x: any) => x.item_id)).toEqual([rating(0).itemId]);
            await validate();
        }
        finally {
            e.close();
        }
    });
    it("homework_rating_and_evidence_roll_back_together", async () => {
        const { e, act, rate, start, rating } = await setup();
        try {
            await act(start);
            e.exec("CREATE TRIGGER reject_evidence BEFORE INSERT ON homework_history WHEN NEW.change_kind='record_evidence' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
            const before = dumpTables(e);
            await expect(rate(rating(0))).rejects.toThrow();
            expect(dumpTables(e)).toEqual(before);
        }
        finally {
            e.close();
        }
    });
    it("stale_callback_after_reopen_refused", async () => {
        const { e, act, rate, start, rating, validate } = await setup();
        try {
            await act(start);
            const next = structuredClone(start.next);
            next.activities[0].record.cycle++;
            await act(homeworkOperation(start.next, next, "reopen"));
            const before = dumpTables(e);
            await expect(rate(rating(0))).rejects.toThrow();
            expect(dumpTables(e)).toEqual(before);
            await validate();
        }
        finally {
            e.close();
        }
    });
    it("card_run_reset_or_drift_invalidates", async () => {
        const { e, act, rate, start, validate } = await setup();
        try {
            await act(start);
            await rate({ action: "reset", operationId: id(130), materialId: id(5), expectedGeneration: 0 });
            expect(e.query("SELECT invalidated_at FROM homework_runs")[0]!.invalidated_at).toBe(T2);
            expect(e.query("SELECT state,cycle FROM homework_activities")[0]).toEqual({ state: "reopened", cycle: 2 });
            await validate();
        }
        finally {
            e.close();
        }
    });
    it("card_source_drift_invalidates_in_the_source_transaction", async () => {
        const { e, act, start, validate } = await setup();
        try {
            await act(start);
            const row = e.query("SELECT * FROM ai_study_sets")[0]!;
            await executeStudySetSave(s => e.exec(s), (s, p) => e.run(s, p), (s, p) => e.query(s, p), { operationId: id(131), materialId: id(5), reason: "edit", expected: Object.fromEntries(SET_COLUMNS.map(k => [k, row[k]])), next: { title: "Changed", summary: "", summaryOrigin: null, sections: [], flashcards: [{ front: "New", back: "Changed", sourcePage: null }], sourceNotes: "", provider: "import", model: "", retired: [] } }, T2);
            expect(e.query("SELECT invalidated_at FROM homework_runs")[0]!.invalidated_at).toBe(T2);
            await validate();
        }
        finally {
            e.close();
        }
    });
    it("rating_on_invalidated_run_is_refused", async () => {
        const { e, act, rate, start, rating, validate } = await setup();
        try {
            await act(start);
            const row = e.query("SELECT * FROM ai_study_sets")[0]!;
            await executeStudySetSave(s => e.exec(s), (s, p) => e.run(s, p), (s, p) => e.query(s, p), { operationId: id(131), materialId: id(5), reason: "edit", expected: Object.fromEntries(SET_COLUMNS.map(k => [k, row[k]])), next: { title: "Changed", summary: "", summaryOrigin: null, sections: [], flashcards: [{ front: "New", back: "Changed", sourcePage: null }], sourceNotes: "", provider: "import", model: "", retired: [] } }, T2);
            expect(e.query("SELECT invalidated_at FROM homework_runs")[0]!.invalidated_at).toBe(T2);
            await expect(rate(rating(0))).rejects.toThrow();
            const run = e.query("SELECT * FROM homework_runs")[0]!;
            expect(run.finished_at).toBeNull();
            expect(run.evidence_json).toBeNull();
            expect(JSON.parse(String(e.query("SELECT snapshot_json FROM homework_history ORDER BY revision DESC LIMIT 1")[0]!.snapshot_json)).runs[0].ratings).toEqual([]);
            expect(e.query("SELECT state FROM homework_activities")[0]!.state).toBe("reopened");
            await validate();

            const row2 = e.query("SELECT * FROM ai_study_sets")[0]!;
            await executeStudySetSave(s => e.exec(s), (s, p) => e.run(s, p), (s, p) => e.query(s, p), { operationId: id(132), materialId: id(5), reason: "edit", expected: Object.fromEntries(SET_COLUMNS.map(k => [k, row2[k]])), next: { title: "Restored", summary: "", summaryOrigin: null, sections: [], flashcards: cards, sourceNotes: "", provider: "import", model: "", retired: [] } }, T2);
            let thrown: any;
            try {
                await rate(rating(0, 3));
            } catch (err) {
                thrown = err;
            }
            expect(thrown).toBeDefined();
            expect(String(thrown?.cause?.stack || thrown?.stack)).toContain("homeworkCards.ts:88");
        }
        finally {
            e.close();
        }
    });
});
