import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

import { createRepositories } from "./repositories";
import { practiceSessionRepository } from "./repositories/practiceSessionRepository";
import { documentRepository } from "./repositories/documentRepository";
import { applyMigrations } from "./migrations";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";
import { PracticeSessionError } from "./persistenceErrors";
import type {
  PracticeCompletedResult,
  PracticeQuestion,
  PracticeSessionActionResult,
  PracticeSessionState,
} from "@/domain/types";

function assertSessionState(result: PracticeSessionActionResult): asserts result is PracticeSessionState {
  expect("status" in result && result.status === "in_progress").toBe(true);
  if (!("status" in result) || result.status !== "in_progress") {
    throw new Error("Expected PracticeSessionState");
  }
}

function assertCompletedResult(result: PracticeSessionActionResult): asserts result is PracticeCompletedResult {
  expect("status" in result && result.status === "completed").toBe(true);
  if (!("status" in result) || result.status !== "completed") {
    throw new Error("Expected PracticeCompletedResult");
  }
}

describe("Practice Session Persistence Contract (M2 PR 1)", () => {
  let db: TestDatabase;
  const now = "2026-10-04T20:00:00.000Z";

  beforeEach(async () => {
    db = await createNodeSqliteDatabase();
  });

  afterEach(() => {
    db.close();
  });

  async function seedMaterial(id: string, title: string): Promise<void> {
    await db.execute(
      `INSERT INTO study_materials (
         id, title, material_type, topic, review_status, priority,
         goal_id, event_id, notes, file_path, original_file_name, file_size,
         created_at, updated_at, last_reviewed_at
       ) VALUES (?, ?, 'study_guide', 'general', 'needs_review', 'later',
         NULL, NULL, '', NULL, NULL, NULL, ?, ?, NULL)`,
      [id, title, now, now],
    );
  }

  async function seedPracticeTest(
    materialId: string,
    title: string,
    questions: PracticeQuestion[],
  ): Promise<void> {
    await db.savePracticeTestAtomically!({
      sourceMaterialId: materialId,
      title,
      questions,
      model: "test-model",
    });
  }

  it("REQ-01: starts or resumes practice attempt and enforces single unfinished attempt", async () => {
    const matId = "mat-1";
    await seedMaterial(matId, "Private Pilot Air Law");
    const questions: PracticeQuestion[] = [
      { question: "Q1", options: ["A", "B", "C"], correctIndex: 0, explanation: "E1", sourcePage: 1 },
      { question: "Q2", options: ["A", "B"], correctIndex: 1, explanation: "E2", sourcePage: 2 },
    ];
    await seedPracticeTest(matId, "Air Law Test", questions);

    const repo = practiceSessionRepository(db);
    const active = await repo.getActiveVersion(matId);
    expect(active).not.toBeNull();
    const versionId = active!.version.id;

    // Start session
    const op1 = crypto.randomUUID();
    const startResult = await repo.saveSessionAction({
      action: "start_or_resume",
      operationId: op1,
      materialId: matId,
      versionId,
    });
    assertSessionState(startResult);

    expect(startResult.totalQuestions).toBe(2);
    expect(startResult.answeredCount).toBe(0);
    expect(startResult.revision).toBe(0);
    expect(startResult.nextUnansweredOrdinal).toBe(0);
    const attemptId = startResult.attemptId;

    // Resume session: must return the exact same attemptId without creating a new attempt
    const op2 = crypto.randomUUID();
    const resumeResult = await repo.saveSessionAction({
      action: "start_or_resume",
      operationId: op2,
      materialId: matId,
      versionId,
    });
    assertSessionState(resumeResult);
    expect(resumeResult.attemptId).toBe(attemptId);

    // Repository getCurrentAttempt confirms state
    const current = await repo.getCurrentAttempt(matId);
    expect(current).not.toBeNull();
    expect(current!.attemptId).toBe(attemptId);
    expect(current!.totalQuestions).toBe(2);
  });

  it("REQ-02 & REQ-03: records response, updates revisions, keeps I don't know separate, computes correctness", async () => {
    const matId = "mat-2";
    await seedMaterial(matId, "Weather Meteorology");
    const questions: PracticeQuestion[] = [
      { question: "Q1", options: ["A", "B", "C"], correctIndex: 1, explanation: "E1", sourcePage: null },
      { question: "Q2", options: ["True", "False"], correctIndex: 0, explanation: "E2", sourcePage: null },
    ];
    await seedPracticeTest(matId, "Weather Test", questions);

    const repo = practiceSessionRepository(db);
    const active = (await repo.getActiveVersion(matId))!;
    const start = await repo.saveSessionAction({
      action: "start_or_resume",
      operationId: crypto.randomUUID(),
      materialId: matId,
      versionId: active.version.id,
    });
    assertSessionState(start);

    const item1 = active.items[0]!;
    const item2 = active.items[1]!;

    // Answer Q1 correctly
    const resp1 = await repo.saveSessionAction({
      action: "record_response",
      operationId: crypto.randomUUID(),
      attemptId: start.attemptId,
      itemId: item1.id,
      expectedRevision: 0,
      selectedIndex: 1, // matches correctIndex 1
      isDontKnow: false,
    });
    expect(resp1).toMatchObject({
      attemptId: start.attemptId,
      itemId: item1.id,
      answeredCount: 1,
      revision: 1,
      isCorrect: true,
    });

    // Answer Q2 with "I don't know"
    const resp2 = await repo.saveSessionAction({
      action: "record_response",
      operationId: crypto.randomUUID(),
      attemptId: start.attemptId,
      itemId: item2.id,
      expectedRevision: 1,
      selectedIndex: null,
      isDontKnow: true,
    });
    expect(resp2).toMatchObject({
      attemptId: start.attemptId,
      itemId: item2.id,
      answeredCount: 2,
      revision: 2,
      isCorrect: false,
    });

    // Verify current attempt state
    const current = await repo.getCurrentAttempt(matId);
    expect(current!.answeredCount).toBe(2);
    expect(current!.revision).toBe(2);
    expect(current!.nextUnansweredOrdinal).toBeNull();
    expect(current!.responses).toHaveLength(2);
    const r1 = current!.responses.find((r) => r.itemId === item1.id);
    const r2 = current!.responses.find((r) => r.itemId === item2.id);
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();
    expect(r1!.isCorrect).toBe(true);
    expect(r1!.isDontKnow).toBe(false);
    expect(r2!.isCorrect).toBe(false);
    expect(r2!.isDontKnow).toBe(true);
  });

  it("REQ-04 & REQ-05: enforces strict validation and rejects invalid choice bounds", async () => {
    const matId = "mat-val";
    await seedMaterial(matId, "Navigation");
    await seedPracticeTest(matId, "Nav Test", [
      { question: "Q1", options: ["A", "B", "C"], correctIndex: 0, explanation: "", sourcePage: null },
    ]);

    const repo = practiceSessionRepository(db);
    const active = (await repo.getActiveVersion(matId))!;
    const start = await repo.saveSessionAction({
      action: "start_or_resume",
      operationId: crypto.randomUUID(),
      materialId: matId,
      versionId: active.version.id,
    });
    assertSessionState(start);

    // Negative selected index
    await expect(
      repo.saveSessionAction({
        action: "record_response",
        operationId: crypto.randomUUID(),
        attemptId: start.attemptId,
        itemId: active.items[0]!.id,
        expectedRevision: 0,
        selectedIndex: -1,
        isDontKnow: false,
      }),
    ).rejects.toThrow(PracticeSessionError);

    // Out-of-bounds selected index
    await expect(
      repo.saveSessionAction({
        action: "record_response",
        operationId: crypto.randomUUID(),
        attemptId: start.attemptId,
        itemId: active.items[0]!.id,
        expectedRevision: 0,
        selectedIndex: 5, // options has length 3
        isDontKnow: false,
      }),
    ).rejects.toThrow(PracticeSessionError);

    // Selected index provided when isDontKnow is true
    await expect(
      repo.saveSessionAction({
        action: "record_response",
        operationId: crypto.randomUUID(),
        attemptId: start.attemptId,
        itemId: active.items[0]!.id,
        expectedRevision: 0,
        selectedIndex: 0,
        isDontKnow: true,
      }),
    ).rejects.toThrow(PracticeSessionError);
  });

  it("REQ-06: prevents stale revisions on responses and completion", async () => {
    const matId = "mat-rev";
    await seedMaterial(matId, "Engines");
    await seedPracticeTest(matId, "Engines Test", [
      { question: "Q1", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null },
    ]);

    const repo = practiceSessionRepository(db);
    const active = (await repo.getActiveVersion(matId))!;
    const start = await repo.saveSessionAction({
      action: "start_or_resume",
      operationId: crypto.randomUUID(),
      materialId: matId,
      versionId: active.version.id,
    });
    assertSessionState(start);

    // Advance revision to 1
    await repo.saveSessionAction({
      action: "record_response",
      operationId: crypto.randomUUID(),
      attemptId: start.attemptId,
      itemId: active.items[0]!.id,
      expectedRevision: 0,
      selectedIndex: 0,
      isDontKnow: false,
    });

    // Submitting with expectedRevision = 0 must fail with INVALID_STATE
    await expect(
      repo.saveSessionAction({
        action: "record_response",
        operationId: crypto.randomUUID(),
        attemptId: start.attemptId,
        itemId: active.items[0]!.id,
        expectedRevision: 0, // stale!
        selectedIndex: 1,
        isDontKnow: false,
      }),
    ).rejects.toThrow(PracticeSessionError);

    // Completing with stale expectedRevision must fail
    await expect(
      repo.saveSessionAction({
        action: "complete_attempt",
        operationId: crypto.randomUUID(),
        attemptId: start.attemptId,
        expectedRevision: 0, // stale!
      }),
    ).rejects.toThrow(PracticeSessionError);
  });

  it("REQ-07: completes attempt, computes score and tallies, and makes completed attempts immutable", async () => {
    const matId = "mat-comp";
    await seedMaterial(matId, "Radiotelephony");
    await seedPracticeTest(matId, "RT Test", [
      { question: "Q1", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null },
      { question: "Q2", options: ["C", "D"], correctIndex: 1, explanation: "", sourcePage: null },
      { question: "Q3", options: ["E", "F"], correctIndex: 0, explanation: "", sourcePage: null },
    ]);

    const repo = practiceSessionRepository(db);
    const active = (await repo.getActiveVersion(matId))!;
    const start = await repo.saveSessionAction({
      action: "start_or_resume",
      operationId: crypto.randomUUID(),
      materialId: matId,
      versionId: active.version.id,
    });
    assertSessionState(start);

    // Answer Q1 correctly
    await repo.saveSessionAction({
      action: "record_response",
      operationId: crypto.randomUUID(),
      attemptId: start.attemptId,
      itemId: active.items[0]!.id,
      expectedRevision: 0,
      selectedIndex: 0,
      isDontKnow: false,
    });

    // Answer Q2 incorrectly
    await repo.saveSessionAction({
      action: "record_response",
      operationId: crypto.randomUUID(),
      attemptId: start.attemptId,
      itemId: active.items[1]!.id,
      expectedRevision: 1,
      selectedIndex: 0, // wrong, correct is 1
      isDontKnow: false,
    });

    // Leave Q3 unanswered, and complete attempt
    const completed = await repo.saveSessionAction({
      action: "complete_attempt",
      operationId: crypto.randomUUID(),
      attemptId: start.attemptId,
      expectedRevision: 2,
    });
    assertCompletedResult(completed);

    expect(completed.totalQuestions).toBe(3);
    expect(completed.answeredCount).toBe(2);
    expect(completed.correctCount).toBe(1);
    expect(completed.incorrectCount).toBe(1);
    expect(completed.dontKnowCount).toBe(0);
    expect(completed.unansweredCount).toBe(1);
    // 1 correct out of 3 total = 33.3%
    expect(completed.scorePercent).toBe(33.3);

    // Completed attempts cannot receive responses
    await expect(
      repo.saveSessionAction({
        action: "record_response",
        operationId: crypto.randomUUID(),
        attemptId: start.attemptId,
        itemId: active.items[2]!.id,
        expectedRevision: 3,
        selectedIndex: 0,
        isDontKnow: false,
      }),
    ).rejects.toThrow(PracticeSessionError);

    // Completed attempts cannot be completed again
    await expect(
      repo.saveSessionAction({
        action: "complete_attempt",
        operationId: crypto.randomUUID(),
        attemptId: start.attemptId,
        expectedRevision: 3,
      }),
    ).rejects.toThrow(PracticeSessionError);

    // Verify completed history retrieval
    const history = await repo.getCompletedHistory(active.version.historyKey);
    expect(history).toHaveLength(1);
    expect(history[0]!.attemptId).toBe(start.attemptId);
    expect(history[0]!.scorePercent).toBe(33.3);
  });

  it("REQ-08: retake attempt abandons current attempt with expectedAttemptId and creates fresh attempt", async () => {
    const matId = "mat-retake";
    await seedMaterial(matId, "Airframes");
    await seedPracticeTest(matId, "Airframes Test", [
      { question: "Q1", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null },
    ]);

    const repo = practiceSessionRepository(db);
    const active = (await repo.getActiveVersion(matId))!;
    const start = await repo.saveSessionAction({
      action: "start_or_resume",
      operationId: crypto.randomUUID(),
      materialId: matId,
      versionId: active.version.id,
    });
    assertSessionState(start);

    // Mismatched expectedAttemptId must fail
    await expect(
      repo.saveSessionAction({
        action: "retake_attempt",
        operationId: crypto.randomUUID(),
        expectedAttemptId: "wrong-id",
        materialId: matId,
        versionId: active.version.id,
      }),
    ).rejects.toThrow(PracticeSessionError);

    // Valid retake
    const retake = await repo.saveSessionAction({
      action: "retake_attempt",
      operationId: crypto.randomUUID(),
      expectedAttemptId: start.attemptId,
      materialId: matId,
      versionId: active.version.id,
    });
    assertSessionState(retake);
    expect(retake.attemptId).not.toBe(start.attemptId);

    // Old attempt is marked abandoned
    const oldAttempt = await repo.getAttempt(start.attemptId);
    expect(oldAttempt!.status).toBe("abandoned");

    // Current attempt is the new attempt
    const current = await repo.getCurrentAttempt(matId);
    expect(current!.attemptId).toBe(retake.attemptId);
  });

  it("REQ-09: operation receipt idempotency: identical retry returns original result, changed reuse conflicts", async () => {
    const matId = "mat-idemp";
    await seedMaterial(matId, "Principles of Flight");
    await seedPracticeTest(matId, "POF Test", [
      { question: "Q1", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null },
    ]);

    const repo = practiceSessionRepository(db);
    const active = (await repo.getActiveVersion(matId))!;
    const opId = crypto.randomUUID();

    const action = {
      action: "start_or_resume" as const,
      operationId: opId,
      materialId: matId,
      versionId: active.version.id,
    };

    const res1 = await repo.saveSessionAction(action);

    // Identical replay returns exact same object
    const res2 = await repo.saveSessionAction(action);
    expect(res2).toEqual(res1);

    // Different payload with same operationId must conflict
    await expect(
      repo.saveSessionAction({
        action: "start_or_resume" as const,
        operationId: opId,
        materialId: "different-material",
        versionId: active.version.id,
      }),
    ).rejects.toThrow(PracticeSessionError);
  });

  it("REQ-10: legacy conversion converts up to 200 questions without truncation, quarantines corrupt rows, and avoids duplicate conversion", async () => {
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { DatabaseSync } = await import("node:sqlite");
    const { applyMigrations } = await import("./migrations");

    const tmpDir = mkdtempSync(join(tmpdir(), "practice-conv-"));
    const dbPath = join(tmpDir, "test.db");

    // 1. Create a pre-migration-11 database with legacy practice_tests
    const rawDb = new DatabaseSync(dbPath);
    // Apply migrations 1..10
    const applied10 = new Set<number>([11]); // skip 11
    await applyMigrations((sql) => rawDb.exec(sql), applied10);

    const cleanMatId = "mat-clean-legacy";
    const corruptMatId = "mat-corrupt-legacy";
    rawDb.exec(`INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('${cleanMatId}', 'Clean Legacy Subject', '${now}', '${now}')`);
    rawDb.exec(`INSERT INTO study_materials (id, title, created_at, updated_at) VALUES ('${corruptMatId}', 'Corrupt Legacy Subject', '${now}', '${now}')`);

    const valid200: PracticeQuestion[] = [];
    for (let i = 0; i < 200; i++) {
      valid200.push({
        question: `Question ${i + 1} test text`,
        options: ["Option 1", "Option 2", "Option 3", "Option 4"],
        correctIndex: i % 4,
        explanation: `Explanation for ${i + 1}`,
        sourcePage: (i % 50) + 1,
      });
    }

    rawDb.prepare(`INSERT INTO practice_tests (source_material_id, title, questions_json, provider, model, generated_at, updated_at) VALUES (?, 'Clean Legacy 200', ?, 'gemini', 'legacy-model', ?, ?)`).run(cleanMatId, JSON.stringify(valid200), now, now);
    rawDb.prepare(`INSERT INTO practice_tests (source_material_id, title, questions_json, provider, model, generated_at, updated_at) VALUES (?, 'Corrupt Legacy', '{"invalid": true}', 'gemini', 'legacy-model', ?, ?)`).run(corruptMatId, now, now);
    rawDb.close();

    // 2. Open via createNodeSqliteDatabase: automatically applies migration 11 and runs legacy conversion on startup!
    const upgradedDb = await createNodeSqliteDatabase(dbPath);
    const repo = practiceSessionRepository(upgradedDb);

    // Verify clean row was converted with 200 items without truncation
    const cleanStatus = await repo.getConversionStatus(cleanMatId);
    expect(cleanStatus!.legacyMigratedAt).not.toBeNull();
    expect(cleanStatus!.legacyError).toBeNull();

    const cleanActive = await repo.getActiveVersion(cleanMatId);
    expect(cleanActive).not.toBeNull();
    expect(cleanActive!.items).toHaveLength(200);
    expect(cleanActive!.items[199]!.ordinal).toBe(199);

    // Verify corrupt row was quarantined
    const corruptStatus = await repo.getConversionStatus(corruptMatId);
    expect(corruptStatus!.legacyMigratedAt).toBeNull();
    expect(corruptStatus!.legacyError).toBe("MALFORMED_QUESTION");

    const corruptActive = await repo.getActiveVersion(corruptMatId);
    expect(corruptActive).toBeNull();

    upgradedDb.close();

    // 3. Reopening must reuse persisted identities and avoid duplicate conversion
    const reopenedDb = await createNodeSqliteDatabase(dbPath);
    const reopenedRepo = practiceSessionRepository(reopenedDb);
    const cleanActiveReopened = await reopenedRepo.getActiveVersion(cleanMatId);
    expect(cleanActiveReopened!.version.id).toBe(cleanActive!.version.id);
    expect(cleanActiveReopened!.items).toHaveLength(200);
    reopenedDb.close();

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("REQ-11: practice test removal prunes unfinished attempts and receipts, preserving completed review history", async () => {
    const matId = "mat-del";
    await seedMaterial(matId, "Aviation Physiology");
    await seedPracticeTest(matId, "Physiology Test", [
      { question: "Q1", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null },
    ]);

    const repo = practiceSessionRepository(db);
    const active = (await repo.getActiveVersion(matId))!;
    const historyKey = active.version.historyKey;

    // Run attempt 1 and complete it
    const start1 = await repo.saveSessionAction({
      action: "start_or_resume",
      operationId: crypto.randomUUID(),
      materialId: matId,
      versionId: active.version.id,
    });
    assertSessionState(start1);
    await repo.saveSessionAction({
      action: "complete_attempt",
      operationId: crypto.randomUUID(),
      attemptId: start1.attemptId,
      expectedRevision: 0,
    });

    // Run attempt 2 and leave in_progress
    const start2 = await repo.saveSessionAction({
      action: "retake_attempt",
      operationId: crypto.randomUUID(),
      expectedAttemptId: null,
      materialId: matId,
      versionId: active.version.id,
    });
    assertSessionState(start2);

    // Remove the practice test
    const allRepos = createRepositories(db);
    await allRepos.documents.removePracticeTest(matId);

    // Active version is gone
    const activeAfter = await repo.getActiveVersion(matId);
    expect(activeAfter).toBeNull();

    // In-progress attempt was pruned
    const currentAfter = await repo.getCurrentAttempt(matId);
    expect(currentAfter).toBeNull();

    // Completed history remains intact and addressable by historyKey
    const history = await repo.getCompletedHistory(historyKey);
    expect(history).toHaveLength(1);
    expect(history[0]!.attemptId).toBe(start1.attemptId);
  });

  it("REQ-12: material deletion cascades: completed history remains addressable, unfinished records pruned", async () => {
    const matId = "mat-mat-del";
    await seedMaterial(matId, "Communication Procedures");
    await seedPracticeTest(matId, "Comm Test", [
      { question: "Q1", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null },
    ]);

    const repo = practiceSessionRepository(db);
    const active = (await repo.getActiveVersion(matId))!;
    const historyKey = active.version.historyKey;

    // Complete attempt 1
    const start1 = await repo.saveSessionAction({
      action: "start_or_resume",
      operationId: crypto.randomUUID(),
      materialId: matId,
      versionId: active.version.id,
    });
    assertSessionState(start1);
    await repo.saveSessionAction({
      action: "complete_attempt",
      operationId: crypto.randomUUID(),
      attemptId: start1.attemptId,
      expectedRevision: 0,
    });

    // Start attempt 2 (in_progress)
    await repo.saveSessionAction({
      action: "retake_attempt",
      operationId: crypto.randomUUID(),
      expectedAttemptId: null,
      materialId: matId,
      versionId: active.version.id,
    });

    // Delete the study material
    const allRepos = createRepositories(db);
    await allRepos.documents.remove(matId);

    // In-progress attempt pruned
    const currentAfter = await repo.getCurrentAttempt(matId);
    expect(currentAfter).toBeNull();

    // Completed attempt remains addressable by historyKey even after material row is gone
    const history = await repo.getCompletedHistory(historyKey);
    expect(history).toHaveLength(1);
    expect(history[0]!.attemptId).toBe(start1.attemptId);
    expect(history[0]!.sourceMaterialTitle).toBe("Communication Procedures");
  });

  it("REQ-13: sqlJsDb browser storage refusal rolls back live state and preserves last stored bytes", async () => {
    const { createSqlJsDatabase } = await import("./sqlJsDb");
    const stored = new Map<string, string>();
    let storageFails = false;

    const originalLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (storageFails) throw new Error("quota exceeded");
          stored.set(key, value);
        },
      },
      configurable: true,
      writable: true,
    });

    try {
      const browserDb = await createSqlJsDatabase();
      const matId = "mat-browser-durability";
      // Seed material and test
      await browserDb.execute(
        `INSERT INTO study_materials (id, title, material_type, topic, review_status, priority, created_at, updated_at)
         VALUES ('${matId}', 'Browser Material', 'study_guide', 'general', 'needs_review', 'later', '${now}', '${now}')`,
      );
      await browserDb.savePracticeTestAtomically!({
        sourceMaterialId: matId,
        title: "Browser Test",
        questions: [{ question: "Q1", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null }],
        model: "test-model",
      });

      const repo = practiceSessionRepository(browserDb);
      const active = (await repo.getActiveVersion(matId))!;
      const attemptsBefore = await browserDb.select("SELECT id FROM practice_attempts");
      expect(attemptsBefore).toHaveLength(0);

      // Trigger storage failure
      storageFails = true;
      await expect(
        repo.saveSessionAction({
          action: "start_or_resume",
          operationId: crypto.randomUUID(),
          materialId: matId,
          versionId: active.version.id,
        }),
      ).rejects.toThrow("Browser storage refused");
      storageFails = false;

      // Attempt was rolled back from live in-memory database
      const attemptsAfter = await browserDb.select("SELECT id FROM practice_attempts");
      expect(attemptsAfter).toHaveLength(0);

      // Reopening from stored bytes matches
      const reopenedDb = await createSqlJsDatabase();
      const reopenedAttempts = await reopenedDb.select("SELECT id FROM practice_attempts");
      expect(reopenedAttempts).toHaveLength(0);
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        value: originalLocalStorage,
        configurable: true,
        writable: true,
      });
    }
  });

  describe("Codex review permanent regressions (M2P1-R1–R4)", () => {
    const qs = [
      {
        question: "Synthetic question",
        options: ["A", "B"],
        correctIndex: 0,
        explanation: "",
        sourcePage: null,
      },
    ];
    let regDb: TestDatabase | undefined;
    let regFolder: string | undefined;

    afterEach(() => {
      regDb?.close();
      regDb = undefined;
      if (regFolder) rmSync(regFolder, { recursive: true, force: true });
      regFolder = undefined;
      vi.useRealTimers();
    });

    async function seedDiag() {
      regDb = await createNodeSqliteDatabase();
      await regDb.execute(
        "INSERT INTO study_materials(id,title,created_at,updated_at) VALUES ('mat','Synthetic','2026-10-04','2026-10-04')",
      );
      await regDb.savePracticeTestAtomically!({
        sourceMaterialId: "mat",
        title: "Synthetic",
        questions: qs,
        model: "synthetic",
      });
      const repo = practiceSessionRepository(regDb);
      const active = (await repo.getActiveVersion("mat"))!;
      const start = (await repo.saveSessionAction({
        action: "start_or_resume",
        operationId: crypto.randomUUID(),
        materialId: "mat",
        versionId: active.version.id,
      })) as PracticeSessionState;
      return { repo, active, start };
    }

    async function recordDiag(start: PracticeSessionState, itemId: string) {
      return practiceSessionRepository(regDb!).saveSessionAction({
        action: "record_response",
        operationId: crypto.randomUUID(),
        attemptId: start.attemptId,
        itemId,
        expectedRevision: 0,
        selectedIndex: 1,
        isDontKnow: false,
      });
    }

    it("conversion failure must prevent adapter exposure (M2P1-R1)", async () => {
      regFolder = mkdtempSync(join(tmpdir(), "m2-codex-"));
      const path = join(regFolder, "db.sqlite");
      const native = "node:sqlite";
      const { DatabaseSync } = await import(/* @vite-ignore */ native);
      const raw = new DatabaseSync(path);
      await applyMigrations((sql) => raw.exec(sql), new Set());
      raw.exec(
        "INSERT INTO study_materials(id,title,created_at,updated_at) VALUES ('mat','Synthetic','2026-10-04','2026-10-04')",
      );
      raw
        .prepare(
          "INSERT INTO practice_tests(source_material_id,title,questions_json,provider,model,generated_at,updated_at) VALUES ('mat','Synthetic',?,'gemini','synthetic','2026-10-04','2026-10-04')",
        )
        .run(JSON.stringify(qs));
      raw.exec(
        "CREATE TRIGGER diagnostic_conversion_fault BEFORE INSERT ON practice_test_versions BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
      );
      raw.close();
      let rejected = false;
      try {
        regDb = await createNodeSqliteDatabase(path);
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    });

    it("unset marker with conflicting version must refuse startup (M2P1-R1)", async () => {
      await seedDiag();
      regFolder = mkdtempSync(join(tmpdir(), "m2-codex-"));
      const path = join(regFolder, "db.sqlite");
      regDb!.close();
      regDb = await createNodeSqliteDatabase(path);
      await regDb.execute(
        "INSERT INTO study_materials(id,title,created_at,updated_at) VALUES ('mat','Synthetic','2026-10-04','2026-10-04')",
      );
      await regDb.savePracticeTestAtomically!({
        sourceMaterialId: "mat",
        title: "Synthetic",
        questions: qs,
        model: "synthetic",
      });
      await regDb.execute(
        "UPDATE practice_tests SET legacy_migrated_at=NULL,questions_json=? WHERE source_material_id='mat'",
        [JSON.stringify([{ ...qs[0], correctIndex: 1 }])],
      );
      regDb.close();
      regDb = undefined;
      let rejected = false;
      try {
        regDb = await createNodeSqliteDatabase(path);
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    });

    it("matching version must repair unset marker without duplicating (M2P1-R1)", async () => {
      regFolder = mkdtempSync(join(tmpdir(), "m2-codex-"));
      const path = join(regFolder, "db.sqlite");
      regDb = await createNodeSqliteDatabase(path);
      await regDb.execute(
        "INSERT INTO study_materials(id,title,created_at,updated_at) VALUES ('mat','Synthetic','2026-10-04','2026-10-04')",
      );
      await regDb.savePracticeTestAtomically!({
        sourceMaterialId: "mat",
        title: "Synthetic",
        questions: qs,
        model: "synthetic",
      });
      await regDb.execute("UPDATE practice_tests SET legacy_migrated_at=NULL WHERE source_material_id='mat'");
      regDb.close();
      regDb = await createNodeSqliteDatabase(path);
      const rows = await regDb.select<{ legacy_migrated_at: string | null }>(
        "SELECT legacy_migrated_at FROM practice_tests",
      );
      expect(rows[0]!.legacy_migrated_at).not.toBeNull();
      const countRows = await regDb.select<{ n: number }>("SELECT COUNT(*) AS n FROM practice_test_versions");
      expect(countRows[0]!.n).toBe(1);
    });

    it("completion derives score from frozen key, not stored correctness (M2P1-R2)", async () => {
      const { repo, active, start } = await seedDiag();
      await recordDiag(start, active.items[0]!.id);
      await regDb!.execute("UPDATE practice_responses SET is_correct=1");
      const result = (await repo.saveSessionAction({
        action: "complete_attempt",
        operationId: crypto.randomUUID(),
        attemptId: start.attemptId,
        expectedRevision: 1,
      })) as PracticeCompletedResult;
      expect(result.correctCount).toBe(0);
      expect(result.scorePercent).toBe(0);
    });

    it("same-choice no-op returns original answered timestamp (M2P1-R2)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime("2026-10-04T12:00:00Z");
      const { repo, active, start } = await seedDiag();
      const first = (await recordDiag(start, active.items[0]!.id)) as { answeredAt: string };
      vi.setSystemTime("2026-10-04T12:01:00Z");
      const second = (await repo.saveSessionAction({
        action: "record_response",
        operationId: crypto.randomUUID(),
        attemptId: start.attemptId,
        itemId: active.items[0]!.id,
        expectedRevision: 1,
        selectedIndex: 1,
        isDontKnow: false,
      })) as { answeredAt: string };
      expect(second.answeredAt).toBe(first.answeredAt);
    });

    it("unsupported regeneration driver refuses before any write (M2P1-R4)", async () => {
      await seedDiag();
      let writes = 0;
      const unsupported = {
        select: regDb!.select.bind(regDb),
        execute: async (sql: string, p: any[] = []) => {
          writes++;
          await regDb!.execute(sql, p);
        },
      };
      await expect(
        documentRepository(unsupported).savePracticeTest({
          sourceMaterialId: "mat",
          title: "Changed",
          questions: [{ ...qs[0]!, correctIndex: 1 }],
          model: "synthetic",
        }),
      ).rejects.toThrow();
      expect(writes).toBe(0);
    });

    it("unsupported removal driver refuses before any write (M2P1-R4)", async () => {
      await seedDiag();
      let writes = 0;
      const unsupported = {
        select: regDb!.select.bind(regDb),
        execute: async (sql: string, p: any[] = []) => {
          writes++;
          await regDb!.execute(sql, p);
        },
      };
      await expect(documentRepository(unsupported).removePracticeTest("mat")).rejects.toThrow();
      expect(writes).toBe(0);
    });

    it("canonical content hashing produces identical hash regardless of key order (shared hash parity)", async () => {
      const { computeCanonicalHash } = await import("./practiceSessionTransaction");
      const q1 = [{ question: "Test?", options: ["A", "B"], correctIndex: 0, explanation: "Exp", sourcePage: 1 }];
      const q2 = [{ explanation: "Exp", sourcePage: 1, correctIndex: 0, question: "Test?", options: ["A", "B"] }];
      const hash1 = await computeCanonicalHash(q1);
      const hash2 = await computeCanonicalHash(q2);
      expect(hash1).toBe(hash2);
    });

    it("string attemptId alone is insufficient and rejects incomplete wire results (M2P1-R3)", async () => {
      const { invokePracticeSessionSave } = await import("./tauriDb");
      const incompleteMockInvoke = async () => ({ attemptId: "attempt-1" });
      await expect(
        invokePracticeSessionSave(
          {
            action: "start_or_resume",
            operationId: "00000000-0000-4000-8000-000000000001",
            materialId: "mat",
            versionId: "ver-1",
          },
          incompleteMockInvoke as any,
        ),
      ).rejects.toThrowError(new PracticeSessionError("IPC_TRANSPORT_ERROR"));
    });

    it("validates action-specific wire shapes across all action types (M2P1-R3)", async () => {
      const { invokePracticeSessionSave } = await import("./tauriDb");

      // 1. Valid start_or_resume passes
      const validStart = {
        attemptId: "att-1",
        versionId: "ver-1",
        status: "in_progress",
        totalQuestions: 5,
        answeredCount: 0,
        revision: 0,
        nextUnansweredOrdinal: 0,
      };
      const resStart = await invokePracticeSessionSave(
        {
          action: "start_or_resume",
          operationId: "00000000-0000-4000-8000-000000000001",
          materialId: "mat",
          versionId: "ver-1",
        },
        (async () => validStart) as any,
      );
      expect(resStart).toEqual(validStart);

      // 2. start_or_resume with missing versionId rejected
      await expect(
        invokePracticeSessionSave(
          {
            action: "start_or_resume",
            operationId: "00000000-0000-4000-8000-000000000001",
            materialId: "mat",
            versionId: "ver-1",
          },
          (async () => ({ ...validStart, versionId: "" })) as any,
        ),
      ).rejects.toThrowError(new PracticeSessionError("IPC_TRANSPORT_ERROR"));

      // 3. Valid record_response passes
      const validRecord = {
        attemptId: "att-1",
        itemId: "item-1",
        answeredCount: 1,
        revision: 1,
        isCorrect: true,
        answeredAt: "2026-10-04T12:00:00Z",
      };
      const resRecord = await invokePracticeSessionSave(
        {
          action: "record_response",
          operationId: "00000000-0000-4000-8000-000000000002",
          attemptId: "att-1",
          itemId: "item-1",
          expectedRevision: 0,
          selectedIndex: 0,
          isDontKnow: false,
        },
        (async () => validRecord) as any,
      );
      expect(resRecord).toEqual(validRecord);

      // 4. record_response missing isCorrect rejected
      await expect(
        invokePracticeSessionSave(
          {
            action: "record_response",
            operationId: "00000000-0000-4000-8000-000000000002",
            attemptId: "att-1",
            itemId: "item-1",
            expectedRevision: 0,
            selectedIndex: 0,
            isDontKnow: false,
          },
          (async () => {
            const copy = { ...validRecord };
            delete (copy as any).isCorrect;
            return copy;
          }) as any,
        ),
      ).rejects.toThrowError(new PracticeSessionError("IPC_TRANSPORT_ERROR"));

      // 5. Valid complete_attempt passes
      const validComplete = {
        attemptId: "att-1",
        status: "completed",
        startedAt: "2026-10-04T12:00:00Z",
        completedAt: "2026-10-04T12:10:00Z",
        totalQuestions: 2,
        answeredCount: 2,
        revision: 2,
        correctCount: 2,
        incorrectCount: 0,
        dontKnowCount: 0,
        unansweredCount: 0,
        scorePercent: 100.0,
      };
      const resComplete = await invokePracticeSessionSave(
        {
          action: "complete_attempt",
          operationId: "00000000-0000-4000-8000-000000000003",
          attemptId: "att-1",
          expectedRevision: 1,
        },
        (async () => validComplete) as any,
      );
      expect(resComplete).toEqual(validComplete);

      // 6. complete_attempt with missing scorePercent rejected
      await expect(
        invokePracticeSessionSave(
          {
            action: "complete_attempt",
            operationId: "00000000-0000-4000-8000-000000000003",
            attemptId: "att-1",
            expectedRevision: 1,
          },
          (async () => {
            const copy = { ...validComplete };
            delete (copy as any).scorePercent;
            return copy;
          }) as any,
        ),
      ).rejects.toThrowError(new PracticeSessionError("IPC_TRANSPORT_ERROR"));

      // 7. Valid abandon_attempt passes
      const validAbandon = {
        attemptId: "att-1",
        status: "abandoned",
        revision: 2,
        completedAt: "2026-10-04T12:10:00Z",
      };
      const resAbandon = await invokePracticeSessionSave(
        {
          action: "abandon_attempt",
          operationId: "00000000-0000-4000-8000-000000000004",
          attemptId: "att-1",
          expectedRevision: 1,
        },
        (async () => validAbandon) as any,
      );
      expect(resAbandon).toEqual(validAbandon);
    });

    it("invokePracticeTestSave and invokeRemovePracticeTest adhere to unit-return contract (M2P1-R3)", async () => {
      const { invokePracticeTestSave, invokeRemovePracticeTest } = await import("./tauriDb");

      let saveCalledWith: any = null;
      const mockSaveInvoke = async (_cmd: string, args: any) => {
        saveCalledWith = args;
        return; // void return
      };

      await expect(
        invokePracticeTestSave(
          {
            sourceMaterialId: "mat",
            title: "Test",
            questions: [{ question: "Q", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null }],
            model: "synthetic",
          },
          mockSaveInvoke as any,
        ),
      ).resolves.toBeUndefined();
      expect(saveCalledWith).toBeDefined();

      let removeCalledWith: any = null;
      const mockRemoveInvoke = async (_cmd: string, args: any) => {
        removeCalledWith = args;
        return; // void return
      };

      await expect(
        invokeRemovePracticeTest("mat", mockRemoveInvoke as any),
      ).resolves.toBeUndefined();
      expect(removeCalledWith).toEqual({ sourceMaterialId: "mat" });
    });

    it("PR2: atomic history erasure prunes attempts, responses, inactive versions, and tombstones receipts", async () => {
      const repo = practiceSessionRepository(db);
      const matId = "mat-erase-pr2";
      await seedMaterial(matId, "Erase Test");

      // Save v1 test
      await db.savePracticeTestAtomically!({
        sourceMaterialId: matId,
        title: "Erase Test V1",
        questions: [{ question: "Q1", options: ["A", "B"], correctIndex: 0, explanation: "E1", sourcePage: 1 }],
        model: "m1",
      });

      const activeV1 = (await repo.getActiveVersion(matId))!;
      const op1 = "11111111-1111-4111-8111-111111111111";
      const startRes = await repo.saveSessionAction({
        action: "start_or_resume",
        operationId: op1,
        materialId: matId,
        versionId: activeV1.version.id,
      });
      assertSessionState(startRes);

      const op2 = "22222222-2222-4222-8222-222222222222";
      await repo.saveSessionAction({
        action: "record_response",
        operationId: op2,
        attemptId: startRes.attemptId,
        itemId: activeV1.items[0]!.id,
        expectedRevision: 0,
        selectedIndex: 0,
        isDontKnow: false,
      });

      const op3 = "33333333-3333-4333-8333-333333333333";
      await repo.saveSessionAction({
        action: "complete_attempt",
        operationId: op3,
        attemptId: startRes.attemptId,
        expectedRevision: 1,
      });

      // Regenerate test: creates v2, v1 becomes inactive
      await db.savePracticeTestAtomically!({
        sourceMaterialId: matId,
        title: "Erase Test V2",
        questions: [{ question: "Q2", options: ["C", "D"], correctIndex: 1, explanation: "E2", sourcePage: 2 }],
        model: "m2",
      });

      const activeV2 = (await repo.getActiveVersion(matId))!;
      expect(activeV2.version.id).not.toBe(activeV1.version.id);

      // Start attempt on v2
      const op4 = "44444444-4444-4444-8444-444444444444";
      const startV2Res = await repo.saveSessionAction({
        action: "start_or_resume",
        operationId: op4,
        materialId: matId,
        versionId: activeV2.version.id,
      });
      assertSessionState(startV2Res);

      // Verify counts before erasure
      const attsBefore = await db.select("SELECT id FROM practice_attempts WHERE source_material_id = ?", [matId]);
      expect(attsBefore).toHaveLength(2);
      const versBefore = await db.select("SELECT id FROM practice_test_versions WHERE history_key = ?", [matId]);
      expect(versBefore).toHaveLength(2);
      const opsBefore = await db.select("SELECT operation_id FROM practice_session_operations WHERE history_key = ?", [matId]);
      expect(opsBefore).toHaveLength(4);

      // Execute atomic history erasure
      const eraseOp = "55555555-5555-4555-8555-555555555555";
      const eraseRes = await repo.eraseHistory({
        action: "erase_history",
        operationId: eraseOp,
        historyKey: matId,
      });
      expect(eraseRes).toEqual({
        action: "erase_history",
        historyKey: matId,
        erased: true,
      });

      // Verify attempts and responses are removed
      const attsAfter = await db.select("SELECT id FROM practice_attempts WHERE source_material_id = ?", [matId]);
      expect(attsAfter).toHaveLength(0);
      const respsAfter = await db.select("SELECT id FROM practice_responses WHERE attempt_id IN (?, ?)", [startRes.attemptId, startV2Res.attemptId]);
      expect(respsAfter).toHaveLength(0);

      // Inactive v1 is pruned; active v2 is preserved
      const versAfter = await db.select<{ id: string; is_active: number }>("SELECT id, is_active FROM practice_test_versions WHERE history_key = ?", [matId]);
      expect(versAfter).toHaveLength(1);
      expect(versAfter[0]?.id).toBe(activeV2.version.id);
      expect(versAfter[0]?.is_active).toBe(1);

      // practice_tests row is preserved
      const ptAfter = await db.select("SELECT source_material_id FROM practice_tests WHERE source_material_id = ?", [matId]);
      expect(ptAfter).toHaveLength(1);

      // Previous receipts converted to tombstones (is_erased = 1, result_json = 'null')
      const tombstones = await db.select<{ is_erased: number; result_json: string }>(
        "SELECT is_erased, result_json FROM practice_session_operations WHERE history_key = ? AND is_erased = 1",
        [matId],
      );
      expect(tombstones).toHaveLength(4);
      for (const t of tombstones) {
        expect(t.result_json).toBe("null");
      }

      // Replay of old tombstoned operation is refused with INVALID_STATE
      await expect(
        repo.saveSessionAction({
          action: "start_or_resume",
          operationId: op1,
          materialId: matId,
          versionId: activeV1.version.id,
        }),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });

      // Idempotent replay of erase succeeds
      const replayErase = await repo.eraseHistory({
        action: "erase_history",
        operationId: eraseOp,
        historyKey: matId,
      });
      expect(replayErase).toEqual({
        action: "erase_history",
        historyKey: matId,
        erased: true,
      });

      // Conflicting erase with changed payload returns OPERATION_CONFLICT
      await expect(
        repo.eraseHistory({
          action: "erase_history",
          operationId: eraseOp,
          historyKey: "other-key",
        }),
      ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });

      // Preserved active version is usable for fresh practice session
      const freshOp = "66666666-6666-4666-8666-666666666666";
      const freshStart = await repo.saveSessionAction({
        action: "start_or_resume",
        operationId: freshOp,
        materialId: matId,
        versionId: activeV2.version.id,
      });
      assertSessionState(freshStart);
      expect(freshStart.versionId).toBe(activeV2.version.id);
    });

    it("PR2: atomic history erasure on sqlJsDb with storage failure rolls back cleanly", async () => {
      const { createSqlJsDatabase } = await import("./sqlJsDb");
      const stored = new Map<string, string>();
      let storageFails = false;

      Object.defineProperty(globalThis, "localStorage", {
        value: {
          getItem: (key: string) => stored.get(key) ?? null,
          setItem: (key: string, value: string) => {
            if (storageFails) throw new Error("quota exceeded");
            stored.set(key, value);
          },
        },
        configurable: true,
        writable: true,
      });

      const browserDb = await createSqlJsDatabase();
      const matId = "mat-browser-erase";
      await browserDb.execute(
        `INSERT INTO study_materials (id, title, material_type, topic, review_status, priority, created_at, updated_at)
         VALUES ('${matId}', 'Browser Erase', 'study_guide', 'general', 'needs_review', 'later', '${now}', '${now}')`,
      );
      await browserDb.savePracticeTestAtomically!({
        sourceMaterialId: matId,
        title: "Browser Erase Test",
        questions: [{ question: "Q1", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null }],
        model: "test-model",
      });

      const repo = practiceSessionRepository(browserDb);
      const active = (await repo.getActiveVersion(matId))!;
      const startRes = await repo.saveSessionAction({
        action: "start_or_resume",
        operationId: "11111111-2222-4333-8444-555555555555",
        materialId: matId,
        versionId: active.version.id,
      });
      assertSessionState(startRes);

      // Trigger storage failure during erase
      storageFails = true;
      await expect(
        repo.eraseHistory({
          action: "erase_history",
          operationId: "99999999-9999-4999-8999-999999999999",
          historyKey: matId,
        }),
      ).rejects.toThrow("Browser storage refused");
      storageFails = false;

      // Rolled back: attempt still exists
      const attemptsAfterFail = await browserDb.select("SELECT id FROM practice_attempts WHERE source_material_id = ?", [matId]);
      expect(attemptsAfterFail).toHaveLength(1);

      // Successful erase
      const eraseRes = await repo.eraseHistory({
        action: "erase_history",
        operationId: "88888888-8888-4888-8888-888888888888",
        historyKey: matId,
      });
      expect(eraseRes.erased).toBe(true);

      const attemptsAfterSuccess = await browserDb.select("SELECT id FROM practice_attempts WHERE source_material_id = ?", [matId]);
      expect(attemptsAfterSuccess).toHaveLength(0);
    });

    it("PR2: sqlJsDb unrelated-history isolation and restart refusal of late old replay", async () => {
      const { createSqlJsDatabase } = await import("./sqlJsDb");
      const stored = new Map<string, string>();

      Object.defineProperty(globalThis, "localStorage", {
        value: {
          getItem: (key: string) => stored.get(key) ?? null,
          setItem: (key: string, value: string) => stored.set(key, value),
        },
        configurable: true,
        writable: true,
      });

      const browserDb = await createSqlJsDatabase();
      const matA = "mat-browser-a";
      const matB = "mat-browser-b";

      await browserDb.execute(
        `INSERT INTO study_materials (id, title, material_type, topic, review_status, priority, created_at, updated_at)
         VALUES ('${matA}', 'Browser A', 'study_guide', 'general', 'needs_review', 'later', '${now}', '${now}'),
                ('${matB}', 'Browser B', 'study_guide', 'general', 'needs_review', 'later', '${now}', '${now}')`,
      );

      await browserDb.savePracticeTestAtomically!({
        sourceMaterialId: matA,
        title: "Test A",
        questions: [{ question: "QA", options: ["1", "2"], correctIndex: 0, explanation: "", sourcePage: null }],
        model: "test-model",
      });

      await browserDb.savePracticeTestAtomically!({
        sourceMaterialId: matB,
        title: "Test B",
        questions: [{ question: "QB", options: ["3", "4"], correctIndex: 1, explanation: "", sourcePage: null }],
        model: "test-model",
      });

      const repoA = practiceSessionRepository(browserDb);
      const activeA = (await repoA.getActiveVersion(matA))!;
      const opA1 = "aaaa1111-2222-4333-8444-555555555555";
      const startA = await repoA.saveSessionAction({
        action: "start_or_resume",
        operationId: opA1,
        materialId: matA,
        versionId: activeA.version.id,
      });
      assertSessionState(startA);

      const activeB = (await repoA.getActiveVersion(matB))!;
      const opB1 = "bbbb1111-2222-4333-8444-555555555555";
      const startB = await repoA.saveSessionAction({
        action: "start_or_resume",
        operationId: opB1,
        materialId: matB,
        versionId: activeB.version.id,
      });
      assertSessionState(startB);

      // Erase only matA
      const eraseOp = "eeee1111-2222-4333-8444-555555555555";
      await repoA.eraseHistory({
        action: "erase_history",
        operationId: eraseOp,
        historyKey: matA,
      });

      // matB attempts are untouched
      const bAttempts = await browserDb.select("SELECT id FROM practice_attempts WHERE source_material_id = ?", [matB]);
      expect(bAttempts).toHaveLength(1);

      // Simulate browser restart by creating new database from stored localStorage
      const restartedDb = await createSqlJsDatabase();
      const restartedRepo = practiceSessionRepository(restartedDb);

      // Replay of old opA1 is refused with INVALID_STATE
      await expect(
        restartedRepo.saveSessionAction({
          action: "start_or_resume",
          operationId: opA1,
          materialId: matA,
          versionId: activeA.version.id,
        }),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });

      // matB still has attempt after restart
      const bAttemptsAfterRestart = await restartedDb.select("SELECT id FROM practice_attempts WHERE source_material_id = ?", [matB]);
      expect(bAttemptsAfterRestart).toHaveLength(1);
    });
  });
});
