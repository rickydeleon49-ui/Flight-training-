import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeHomeworkOperation } from "./homeworkTransaction";
import { executePracticeSessionAction } from "./practiceSessionTransaction";
import { executeCardReviewAction } from "./cardReviewTransaction";
import { actionRepository } from "./repositories/actionRepository";
import { applyMigrations } from "./migrations";
import { validateHomeworkState } from "./practiceStateValidation";
import { ENGINES, dumpTables, openEngine, openNodeEngine, openSqlJsEngine, schemaReference } from "./testing/skillEvidenceEngines";
import { cardVersion } from "@/logic/cardIdentity";
import type { HomeworkOperation, HomeworkTestRun } from "@/domain/homework";

const F = JSON.parse(readFileSync("src-tauri/fixtures/homework-validation/cases.json", "utf8"));
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const HASH = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const T0 = "2026-10-21T10:00:00.000Z";
const T1 = "2026-10-21T10:01:00.000Z";
const T2 = "2026-10-21T10:02:00.000Z";

describe.each(ENGINES)("homework test runs and actions: %s", (name) => {
  async function setup() {
    const e = await openEngine(name);
    await applyMigrations((s) => e.exec(s), new Set());
    for (const sql of F.baseline) e.exec(sql);

    // Setup active practice test version with 2 items for material id(5)
    e.run(
      "INSERT INTO practice_test_versions (id, source_material_id, source_material_title, history_key, version_number, content_hash, is_active, created_at) VALUES (?, ?, 'Synthetic source', ?, 1, ?, 1, ?)",
      [id(20), id(5), id(5), HASH, T0],
    );
    e.run(
      "INSERT INTO practice_test_items (id, version_id, ordinal, question_text, options_json, correct_index, explanation, source_page) VALUES (?, ?, 0, 'Q1', '[\"A\",\"B\"]', 0, '', null)",
      [id(21), id(20)],
    );
    e.run(
      "INSERT INTO practice_test_items (id, version_id, ordinal, question_text, options_json, correct_index, explanation, source_page) VALUES (?, ?, 1, 'Q2', '[\"C\",\"D\"]', 1, '', null)",
      [id(22), id(20)],
    );

    const act = (o: unknown) =>
      executeHomeworkOperation(
        (s) => e.exec(s),
        (s, p) => e.run(s, p),
        (s, p) => e.query(s, p),
        o,
      );

    const sess = (o: unknown) =>
      executePracticeSessionAction(
        (s) => e.exec(s),
        (s, p) => e.run(s, p),
        (s, p) => e.query(s, p),
        o,
        T2,
      );

    const actionRepo = actionRepository({
      select: async (s, p = []) => e.query(s, p) as any,
      execute: async (s, p = []) => {
        await e.run(s, p);
      },
    });

    const create: HomeworkOperation = {
      version: 1,
      operationId: id(100),
      assignmentId: id(1),
      baseRevision: 0,
      changeKind: "create",
      at: T0,
      next: {
        version: 1,
        assignment: {
          id: id(1),
          title: "Test Homework",
          instructions: "Complete quiz",
          school: null,
          instructor: null,
          lesson_id: null,
          source_lesson_id: null,
          due_date: "2026-10-25",
          state: "upcoming",
          revision: 1,
          action_id: id(50),
          archived: 0,
          created_at: T0,
          updated_at: T0,
          completed_at: null,
        },
        activities: [
          {
            record: {
              id: id(2),
              assignment_id: id(1),
              position: 0,
              kind: "test",
              title: "Quiz Activity",
              body: "",
              material_id: id(5),
              source_material_id: id(5),
              source_revision: HASH,
              card_set_id: null,
              test_version_id: id(20),
              source_test_version_id: id(20),
              page_start: null,
              page_end: null,
              state: "upcoming",
              cycle: 1,
              revision: 1,
              created_at: T0,
              updated_at: T0,
              completed_at: null,
              removed_at: null,
            },
            source: { title: "Synthetic source", total_pages: null },
            evidence: null,
          },
        ],
        runs: [],
      },
    };

    const testRun: HomeworkTestRun = {
      id: id(111),
      activity_id: id(2),
      cycle: 1,
      activity_revision: 1,
      kind: "test",
      started_at: T1,
      finished_at: null,
      invalidated_at: null,
      evidence: null,
      scope: {
        version: 1,
        material_id: id(5),
        source_revision: HASH,
        test_version_id: id(20),
        attempt_id: id(30),
      },
    };

    const startOp: HomeworkOperation = {
      version: 1,
      operationId: id(101),
      assignmentId: id(1),
      baseRevision: 1,
      changeKind: "start",
      at: T1,
      next: {
        version: 1,
        assignment: {
          ...create.next.assignment,
          revision: 2,
          state: "in_progress",
          updated_at: T1,
        },
        activities: [
          {
            ...create.next.activities[0]!,
            record: {
              ...create.next.activities[0]!.record,
              state: "in_progress",
              updated_at: T1,
            },
          },
        ],
        runs: [testRun],
      },
    };

    const validate = async () =>
      validateHomeworkState((s, p) => e.query(s, p), await schemaReference());

    return { e, act, sess, actionRepo, create, startOp, testRun, validate };
  }

  it("test_run_creates_new_attempt_atomically_never_adopts", async () => {
    const { e, act, create, startOp, testRun, validate } = await setup();
    try {
      await act(create);
      await act(startOp);

      // Verify homework run exists
      const runs = await e.query("SELECT * FROM homework_runs WHERE id=?", [id(111)]);
      expect(runs).toHaveLength(1);
      expect(runs[0]!.kind).toBe("test");
      expect(runs[0]!.attempt_id).toBe(id(30));
      expect(runs[0]!.source_attempt_id).toBe(id(30));

      // Verify practice attempt was created atomically
      const attempts = await e.query("SELECT * FROM practice_attempts WHERE id=?", [id(30)]);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.status).toBe("in_progress");
      expect(attempts[0]!.version_id).toBe(id(20));
      expect(attempts[0]!.total_questions).toBe(2);
      expect(attempts[0]!.started_at).toBe(T1);

      await validate();

      // If an attempt is already in progress, starting another is refused (never adopts)
      const secondStart = structuredClone(startOp);
      secondStart.operationId = id(102);
      secondStart.baseRevision = 2;
      secondStart.next.assignment.revision = 3;
      secondStart.next.runs.push({
        ...testRun,
        id: id(112),
        started_at: T2,
        scope: { ...testRun.scope, attempt_id: id(31) },
      });
      await expect(act(secondStart)).rejects.toThrow();
    } finally {
      e.close();
    }
  });

  it("new_attempt_and_projected_action_roll_back_atomically", async () => {
    const { e, act, create, startOp } = await setup();
    try {
      await act(create);
      const before = dumpTables(e);
      e.beforeStatement = sql => { if (sql.includes("INSERT INTO practice_attempts")) throw new Error("synthetic insert failure"); };
      await expect(act(startOp)).rejects.toThrow();
      expect(dumpTables(e)).toEqual(before);
      e.beforeStatement = undefined;
      await act(startOp);
      expect(e.query("SELECT id FROM practice_attempts")).toHaveLength(1);
    } finally { e.close(); }
  });

  it("an_existing_in_progress_attempt_is_not_adopted", async () => {
    const { e, act, create, startOp } = await setup();
    try {
      await act(create);
      e.run("INSERT INTO practice_attempts (id,version_id,source_material_id,source_material_title,started_at,status,revision,total_questions,answered_count,correct_count,incorrect_count,dont_know_count) VALUES (?,?,?,'Synthetic source',?,'in_progress',0,2,0,0,0,0)", [id(29), id(20), id(5), T1]);
      const before = dumpTables(e);
      await expect(act(startOp)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(dumpTables(e)).toEqual(before);
    } finally { e.close(); }
  });

  it("homework_context_is_strict_and_bound_to_its_exact_attempt", async () => {
    const { e, act, sess, create, startOp } = await setup();
    try {
      await act(create); await act(startOp);
      const context = { assignmentId: id(1), runId: id(111), expectedRevision: 2, activityRevision: 1, cycle: 1 };
      const before = dumpTables(e);
      for (const homework of [{}, { ...context, extra: true }, { ...context, cycle: 0 }]) {
        await expect(sess({ action: "complete_attempt", operationId: id(210), attemptId: id(30), expectedRevision: 0, homework })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
      }
      await expect(sess({ action: "complete_attempt", operationId: id(210), attemptId: id(30), expectedRevision: 0, homework: { ...context, activityRevision: 2 } })).rejects.toMatchObject({ code: "INVALID_STATE" });
      e.run("INSERT INTO practice_attempts (id,version_id,source_material_id,source_material_title,started_at,status,revision,total_questions,answered_count,correct_count,incorrect_count,dont_know_count) VALUES (?,?,NULL,'Synthetic source',?,'in_progress',0,2,0,0,0,0)", [id(31), id(20), T1]);
      const withOtherAttempt = dumpTables(e);
      await expect(sess({ action: "complete_attempt", operationId: id(211), attemptId: id(31), expectedRevision: 0, homework: context })).rejects.toMatchObject({ code: "INVALID_STATE" });
      expect(dumpTables(e)).toEqual(withOtherAttempt);
      e.run("DELETE FROM practice_attempts WHERE id=?", [id(31)]);
      expect(dumpTables(e)).toEqual(before);
    } finally { e.close(); }
  });

  it("zero_score_completes_and_detached_evidence_survives_later_edits", async () => {
    const { e, act, sess, create, startOp, validate } = await setup();
    try {
      await act(create); await act(startOp);
      await sess({ action: "complete_attempt", operationId: id(210), attemptId: id(30), expectedRevision: 0 });
      const snapshot = JSON.parse(String(e.query("SELECT snapshot_json FROM homework_history ORDER BY revision DESC LIMIT 1")[0]!.snapshot_json));
      expect(snapshot.assignment.state).toBe("completed");
      expect(snapshot.runs[0].evidence.score_percent).toBe(0);
      e.run("DELETE FROM practice_attempts WHERE id=?", [id(30)]);
      await validate();
      snapshot.assignment.archived = 1;
      snapshot.assignment.revision++;
      await act({ version: 1, operationId: id(211), assignmentId: id(1), baseRevision: 3, changeKind: "archive", at: T2, next: snapshot });
      expect(e.query("SELECT attempt_id,source_attempt_id FROM homework_runs")[0]).toEqual({ attempt_id: null, source_attempt_id: id(30) });
      await validate();
    } finally { e.close(); }
  });

  it("pre_existing_or_abandoned_attempt_never_counts", async () => {
    const { e, act, sess, create, startOp, validate } = await setup();
    try {
      await act(create);

      // Pre-existing attempt started before activity created
      e.run(
        "INSERT INTO practice_attempts (id, version_id, source_material_id, source_material_title, started_at, completed_at, status, revision, total_questions, answered_count, correct_count, incorrect_count, dont_know_count, score_percent) VALUES (?, ?, ?, 'Pre-existing', '2026-10-21T09:00:00.000Z', NULL, 'completed', 0, 2, 2, 2, 0, 0, 100)",
        [id(29), id(20), id(5)],
      );

      // Start homework run
      await act(startOp);

      // Attempt 30 completes
      await sess({
        action: "record_response",
        operationId: id(201),
        attemptId: id(30),
        itemId: id(21),
        expectedRevision: 0,
        selectedIndex: 0,
        isDontKnow: false,
      });

      // Abandon the attempt
      await sess({
        action: "abandon_attempt",
        operationId: id(202),
        attemptId: id(30),
        expectedRevision: 1,
      });

      // Abandoned attempt never completed the activity
      const acts = await e.query("SELECT state, completed_at FROM homework_activities WHERE id=?", [
        id(2),
      ]);
      expect(acts[0]!.state).toBe("in_progress");
      expect(acts[0]!.completed_at).toBeNull();
      const runs = await e.query("SELECT finished_at FROM homework_runs WHERE id=?", [id(111)]);
      expect(runs[0]!.finished_at).toBeNull();
      await validate();
    } finally {
      e.close();
    }
  });

  it("stale_callback_after_reopen_refused", async () => {
    const { e, act, sess, create, startOp, testRun } = await setup();
    try {
      await act(create);
      await act(startOp);

      // Reopen assignment / activity
      const reopenOp: HomeworkOperation = {
        version: 1,
        operationId: id(105),
        assignmentId: id(1),
        baseRevision: 2,
        changeKind: "reopen",
        at: T2,
        next: {
          ...startOp.next,
          assignment: {
            ...startOp.next.assignment,
            revision: 3,
            state: "reopened",
            updated_at: T2,
          },
          activities: [
            {
              ...startOp.next.activities[0]!,
              record: {
                ...startOp.next.activities[0]!.record,
                cycle: 2,
                state: "reopened",
                updated_at: T2,
              },
            },
          ],
          runs: [
            {
              ...testRun,
              invalidated_at: T2,
            },
          ],
        },
      };
      await act(reopenOp);

      // Completing the attempt with stale homework context (revision 2) is refused
      await expect(
        sess({
          action: "complete_attempt",
          operationId: id(205),
          attemptId: id(30),
          expectedRevision: 0,
          homework: {
            assignmentId: id(1),
            runId: id(111),
            expectedRevision: 2,
            activityRevision: 1,
            cycle: 1,
          },
        }),
      ).rejects.toThrow();
    } finally {
      e.close();
    }
  });

  it("one_action_per_assignment_projected_atomically", async () => {
    const { e, act, create, startOp, testRun, validate } = await setup();
    try {
      // 1. Create projects next action
      await act(create);
      let actions = await e.query("SELECT * FROM next_actions WHERE id=?", [id(50)]);
      expect(actions).toHaveLength(1);
      expect(actions[0]!.title).toBe("Quiz Activity");
      expect(actions[0]!.category).toBe("prepare");
      expect(actions[0]!.status).toBe("open");
      expect(actions[0]!.due_date).toBe("2026-10-25");

      await validate();

      // 2. Start keeps action open with same ID
      await act(startOp);
      actions = await e.query("SELECT * FROM next_actions WHERE id=?", [id(50)]);
      expect(actions).toHaveLength(1);
      expect(actions[0]!.status).toBe("open");

      // 3. Complete marks action completed
      const completeOp: HomeworkOperation = {
        version: 1,
        operationId: id(103),
        assignmentId: id(1),
        baseRevision: 2,
        changeKind: "record_evidence",
        at: T2,
        next: {
          version: 1,
          assignment: {
            ...startOp.next.assignment,
            revision: 3,
            state: "completed",
            completed_at: T2,
            updated_at: T2,
          },
          activities: [
            {
              ...startOp.next.activities[0]!,
              record: {
                ...startOp.next.activities[0]!.record,
                state: "completed",
                completed_at: T2,
                updated_at: T2,
              },
              evidence: {
                version: 1,
                activity_id: id(2),
                revision: 1,
                cycle: 1,
                kind: "test",
                completed_at: T2,
                body: "",
                source_material_id: id(5),
                source_revision: HASH,
                page_start: null,
                page_end: null,
              },
            },
          ],
          runs: [
            {
              ...testRun,
              finished_at: T2,
              evidence: {
                version: 1,
                attempt_id: id(30),
                version_id: id(20),
                started_at: T1,
                completed_at: T2,
                score_percent: 100,
                total_questions: 2,
                answered_count: 2,
                correct_count: 2,
                incorrect_count: 0,
                dont_know_count: 0,
              },
            },
          ],
        },
      };

      // Set practice_attempts row so evidence matches
      e.run(
        "UPDATE practice_attempts SET status='completed', completed_at=?, score_percent=100, answered_count=2, correct_count=2 WHERE id=?",
        [T2, id(30)],
      );

      await act(completeOp);
      actions = await e.query("SELECT * FROM next_actions WHERE id=?", [id(50)]);
      expect(actions).toHaveLength(1);
      expect(actions[0]!.status).toBe("completed");
      expect(actions[0]!.completed_at).toBe(T2);

      await validate();

      // 4. Archive marks action dismissed
      const archiveOp: HomeworkOperation = {
        version: 1,
        operationId: id(104),
        assignmentId: id(1),
        baseRevision: 3,
        changeKind: "archive",
        at: T2,
        next: {
          ...completeOp.next,
          assignment: {
            ...completeOp.next.assignment,
            revision: 4,
            archived: 1,
            updated_at: T2,
          },
        },
      };
      await act(archiveOp);
      actions = await e.query("SELECT * FROM next_actions WHERE id=?", [id(50)]);
      expect(actions[0]!.status).toBe("dismissed");

      await validate();
    } finally {
      e.close();
    }
  });

  it("bound_action_generic_complete_refused_both_drivers", async () => {
    const { e, act, actionRepo, create, validate } = await setup();
    try {
      await act(create);

      // Verify bound action cannot be completed generically
      await expect(actionRepo.complete(id(50))).rejects.toThrow(
        "Cannot complete bound homework action directly",
      );

      // Verify bound fields cannot be mutated directly
      await expect(actionRepo.update(id(50), { status: "completed" })).rejects.toThrow(
        "Cannot complete bound homework action directly",
      );
      await expect(actionRepo.update(id(50), { title: "Mutated Title" })).rejects.toThrow(
        "Cannot mutate bound field 'title' of homework action",
      );
      await expect(actionRepo.update(id(50), { dueDate: "2026-10-30" })).rejects.toThrow(
        "Cannot mutate bound field 'dueDate' of homework action",
      );

      // Updating estimatedMinutes is permitted
      await actionRepo.update(id(50), { estimatedMinutes: 45 });
      const actions = await e.query("SELECT estimated_minutes FROM next_actions WHERE id=?", [
        id(50),
      ]);
      expect(actions[0]!.estimated_minutes).toBe(45);

      await validate();
    } finally {
      e.close();
    }
  });
});

// A database holding both run kinds, their evidence and the bound next action must survive a
// backup round trip unchanged. Native has the same test against the real archive ladder; in TS
// the round-trip pattern is the copied-file reopen the shared contract already uses.
describe.each(ENGINES)("homework backup round trip: %s", (name) => {
  it("backup_round_trip_keeps_runs_evidence_and_action_links", async () => {
    const dir = mkdtempSync(join(tmpdir(), "homework-round-trip-"));
    const R = [
      "2026-10-21T10:00:00.000Z",
      "2026-10-21T10:01:00.000Z",
      "2026-10-21T10:02:00.000Z",
      "2026-10-21T10:03:00.000Z",
      "2026-10-21T10:04:00.000Z",
      "2026-10-21T10:05:00.000Z",
      "2026-10-21T10:06:00.000Z",
    ] as const;
    let e = await openEngine(name);
    let reopened: Awaited<ReturnType<typeof openNodeEngine>> | undefined;
    try {
      await applyMigrations((s) => e.exec(s), new Set());
      for (const sql of F.baseline) e.exec(sql);

      const cards = [
        { front: "One", back: "First", sourcePage: null },
        { front: "Two", back: "Second", sourcePage: null },
      ];
      e.run(
        "INSERT INTO ai_study_sets (source_material_id,provider,flashcards_json,generated_at,updated_at) VALUES (?,'import',?,?,?)",
        [id(5), JSON.stringify(cards), R[0], R[0]],
      );
      const version = await cardVersion(id(5), cards);
      e.run(
        "INSERT INTO practice_test_versions (id, source_material_id, source_material_title, history_key, version_number, content_hash, is_active, created_at) VALUES (?, ?, 'Synthetic source', ?, 1, ?, 1, ?)",
        [id(20), id(5), id(5), HASH, R[0]],
      );
      for (let i = 0; i < 2; i++) {
        e.run(
          "INSERT INTO practice_test_items (id, version_id, ordinal, question_text, options_json, correct_index, explanation, source_page) VALUES (?, ?, ?, 'Question', '[\"A\",\"B\"]', 0, '', NULL)",
          [id(21 + i), id(20), i],
        );
      }

      const act = (o: HomeworkOperation) =>
        executeHomeworkOperation((s) => e.exec(s), (s, p) => e.run(s, p), (s, p) => e.query(s, p), o);
      const rate = (o: Parameters<typeof executeCardReviewAction>[3], at: string) =>
        executeCardReviewAction((s) => e.exec(s), (s, p) => e.run(s, p), (s, p) => e.query(s, p), o, at);
      const sess = (o: Parameters<typeof executePracticeSessionAction>[3], at: string) =>
        executePracticeSessionAction((s) => e.exec(s), (s, p) => e.run(s, p), (s, p) => e.query(s, p), o, at);
      const latest = () =>
        JSON.parse(String(e.query("SELECT snapshot_json FROM homework_history WHERE assignment_id=? ORDER BY revision DESC LIMIT 1", [id(1)])[0]!.snapshot_json)) as any;

      // One assignment with a card activity and a quiz activity, and its next action bound.
      const create = structuredClone(F.operations.card_create) as HomeworkOperation;
      create.next.assignment.due_date = "2026-10-25";
      create.next.assignment.action_id = id(50);
      create.next.activities.push({
        record: {
          ...create.next.activities[0]!.record,
          id: id(3),
          position: 1,
          kind: "test",
          title: "Quiz Activity",
          material_id: id(5),
          source_material_id: id(5),
          source_revision: HASH,
          card_set_id: null,
          test_version_id: id(20),
          source_test_version_id: id(20),
          page_start: null,
          page_end: null,
        },
        source: { title: "Synthetic source", total_pages: null },
        evidence: null,
      });
      await act(create);

      const started = latest();
      started.assignment.revision = 2;
      started.assignment.state = "in_progress";
      started.assignment.updated_at = R[1];
      started.activities[0].record.state = "in_progress";
      started.activities[0].record.updated_at = R[1];
      started.runs = [
        {
          id: id(111),
          activity_id: id(2),
          cycle: 1,
          activity_revision: 1,
          kind: "cards",
          started_at: R[1],
          finished_at: null,
          invalidated_at: null,
          ratings: [],
          scope: {
            version: 1,
            material_id: id(5),
            source_revision: version.contentHash,
            card_set_id: version.versionId,
            generation: 0,
            next_local_midnight: "2026-10-22T00:00:00.000Z",
            item_ids: version.items.map((x) => x.itemId),
          },
        },
      ];
      await act({ ...create, operationId: id(101), baseRevision: 1, changeKind: "start", at: R[1], next: started });
      const rating = (index: number, revision: number) => ({
        action: "rate" as const,
        operationId: id(300 + index),
        materialId: id(5),
        versionContentHash: version.contentHash,
        itemId: version.items[index]!.itemId,
        expectedGeneration: 0,
        expectedRevision: 0,
        rating: "again" as const,
        homework: { assignmentId: id(1), runId: id(111), expectedRevision: revision, activityRevision: 1, cycle: 1 },
      });
      await rate(rating(0, 2), R[2]);
      await rate(rating(1, 3), R[3]);

      const prev = latest();
      const withQuiz = structuredClone(prev);
      withQuiz.assignment.revision = prev.assignment.revision + 1;
      withQuiz.assignment.updated_at = R[4];
      withQuiz.activities[1].record.state = "in_progress";
      withQuiz.activities[1].record.updated_at = R[4];
      withQuiz.runs.push({
        id: id(112),
        activity_id: id(3),
        cycle: 1,
        activity_revision: 1,
        kind: "test",
        started_at: R[4],
        finished_at: null,
        invalidated_at: null,
        evidence: null,
        scope: { version: 1, material_id: id(5), source_revision: HASH, test_version_id: id(20), attempt_id: id(30) },
      });
      await act({
        version: 1,
        operationId: id(102),
        assignmentId: id(1),
        baseRevision: prev.assignment.revision,
        changeKind: "start",
        at: R[4],
        next: withQuiz,
      });

      for (let i = 0; i < 2; i++) {
        await sess(
          { action: "record_response", operationId: id(400 + i), attemptId: id(30), itemId: id(21 + i), expectedRevision: i, selectedIndex: 0, isDontKnow: false },
          R[5],
        );
      }
      await sess(
        {
          action: "complete_attempt",
          operationId: id(410),
          attemptId: id(30),
          expectedRevision: 2,
          homework: { assignmentId: id(1), runId: id(112), expectedRevision: 5, activityRevision: 1, cycle: 1 },
        },
        R[6],
      );

      expect(e.query("SELECT kind FROM homework_runs ORDER BY id").map((r) => r.kind)).toEqual(["cards", "test"]);
      expect(e.query("SELECT evidence_json FROM homework_runs ORDER BY id").every((r) => r.evidence_json !== null)).toBe(true);
      expect(latest().activities.filter((a: any) => a.evidence !== null)).toHaveLength(2);
      expect(e.query("SELECT state FROM homework_assignments")[0]!.state).toBe("completed");
      expect(e.query("SELECT status, title, due_date FROM next_actions WHERE id=?", [id(50)])[0]).toEqual({
        status: "completed",
        title: "Quiz Activity",
        due_date: "2026-10-25",
      });
      await validateHomeworkState((s, p) => e.query(s, p), await schemaReference());

      const before = dumpTables(e);
      const bytes = e.snapshot();
      e.close();
      e = undefined!;
      if (name !== "sql.js") writeFileSync(join(dir, "case.db"), bytes);
      reopened = name === "sql.js" ? await openSqlJsEngine(bytes) : await openNodeEngine(join(dir, "case.db"));
      const restored = reopened!;
      expect(dumpTables(restored)).toEqual(before);
      await validateHomeworkState((s, p) => restored.query(s, p), await schemaReference());
      expect(restored.query("SELECT kind FROM homework_runs ORDER BY id").map((r) => r.kind)).toEqual(["cards", "test"]);
      expect(restored.query("SELECT evidence_json FROM homework_runs ORDER BY id").every((r) => r.evidence_json !== null)).toBe(true);
      expect(restored.query("SELECT status FROM next_actions WHERE id=?", [id(50)])[0]!.status).toBe("completed");
      expect(restored.query("SELECT action_id FROM homework_assignments")[0]!.action_id).toBe(id(50));
      expect(restored.query("SELECT COUNT(*) AS n FROM practice_attempts WHERE status='completed'")[0]!.n).toBe(1);
    } finally {
      reopened?.close();
      e?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
