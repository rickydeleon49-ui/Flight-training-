import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

import { applyMigrations, MIGRATIONS } from "./migrations";
import { practiceSessionRepository } from "./repositories/practiceSessionRepository";
import { createNodeSqliteDatabase, type TestDatabase } from "./testing/nodeSqliteDb";
import { seedPracticeTest } from "./testing/practiceTestFixtures";
import { LEGACY_TIMED_STORAGE_KEY } from "@/logic/timedAttempts";
import type { PracticeSessionState } from "@/domain/types";

const now = "2026-10-04T20:00:00.000Z";

describe("migration 0042 timed attempts", () => {
  it("adds nullable columns; old attempts read NULL", async () => {
    const raw = new DatabaseSync(":memory:");
    const exec = (sql: string) => raw.exec(sql);
    const through41 = new Set(MIGRATIONS.filter((m) => m.version > 41).map((m) => m.version));
    await applyMigrations(exec, through41);
    raw.exec(
      `INSERT INTO study_materials (id, title, material_type, topic, review_status, priority, notes, created_at, updated_at)
       VALUES ('m','T','study_guide','general','needs_review','later','','${now}','${now}');
       INSERT INTO practice_test_versions (id, source_material_id, history_key, source_material_title, version_number, is_active, content_hash, created_at, model)
       VALUES ('v','m','m','T',1,1,'h','${now}','x');
       INSERT INTO practice_attempts (id, version_id, source_material_id, source_material_title, started_at, status, revision, total_questions)
       VALUES ('a1','v','m','T','${now}','in_progress',0,1);`,
    );
    const cols = () => raw.prepare("SELECT name FROM pragma_table_info('practice_attempts')").all().map((r) => (r as { name: string }).name);
    expect(cols()).not.toContain("timed_started_ms");
    await applyMigrations(exec, new Set(MIGRATIONS.filter((m) => m.version <= 41).map((m) => m.version)));
    expect(cols()).toEqual(expect.arrayContaining(["timed_started_ms", "timed_deadline_ms", "timed_seconds_used"]));
    expect(raw.prepare("SELECT timed_started_ms, timed_deadline_ms, timed_seconds_used FROM practice_attempts WHERE id='a1'").get()).toEqual({
      timed_started_ms: null,
      timed_deadline_ms: null,
      timed_seconds_used: null,
    });
  });
});

describe("timed attempts in the practice repository", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createNodeSqliteDatabase();
    for (const id of ["mat-1", "mat-2"]) {
      await db.execute(
        `INSERT INTO study_materials (id, title, material_type, topic, review_status, priority, goal_id, event_id, notes, file_path, original_file_name, file_size, created_at, updated_at, last_reviewed_at)
         VALUES (?, ?, 'study_guide', 'general', 'needs_review', 'later', NULL, NULL, '', NULL, NULL, NULL, ?, ?, NULL)`,
        [id, id, now, now],
      );
      await seedPracticeTest(db, {
        sourceMaterialId: id,
        title: id,
        questions: [{ question: "Q1", options: ["A", "B"], correctIndex: 0, explanation: "E", sourcePage: null }],
        model: "test-model",
      });
    }
  });

  afterEach(() => {
    db.close();
  });

  async function start(repo: ReturnType<typeof practiceSessionRepository>, materialId: string): Promise<PracticeSessionState> {
    const active = (await repo.getActiveVersion(materialId))!;
    return (await repo.saveSessionAction({
      action: "start_or_resume",
      operationId: crypto.randomUUID(),
      materialId,
      versionId: active.version.id,
    })) as PracticeSessionState;
  }

  function fakeStorage(initial: string | null) {
    let value = initial;
    return {
      getItem: (k: string) => (k === LEGACY_TIMED_STORAGE_KEY ? value : null),
      removeItem: (k: string) => {
        if (k === LEGACY_TIMED_STORAGE_KEY) value = null;
      },
      peek: () => value,
    };
  }

  it("start then finish writes the fields; an untimed attempt stays NULL; reads expose them", async () => {
    const repo = practiceSessionRepository(db);
    const timed = await start(repo, "mat-1");
    const plain = await start(repo, "mat-2");
    await repo.setTimedStart(timed.attemptId, 1_000, 121_000);
    await repo.setTimedStart(timed.attemptId, 5, 6); // keeps the first values
    await repo.setTimedFinish(plain.attemptId, 30); // not timed: ignored
    expect(await repo.getTimedRecord(timed.attemptId)).toEqual({ startedMs: 1_000, deadlineMs: 121_000 });
    expect(await repo.getTimedRecord(plain.attemptId)).toBeNull();
    expect(await repo.getCurrentAttempt("mat-1")).toMatchObject({ timedStartedMs: 1_000, timedDeadlineMs: 121_000, timedSecondsUsed: null });
    expect(await repo.getCurrentAttempt("mat-2")).toMatchObject({ timedStartedMs: null, timedSecondsUsed: null });

    await repo.setTimedFinish(timed.attemptId, 42);
    await repo.setTimedFinish(timed.attemptId, 99); // keeps the first value
    expect(await repo.getTimedRecord(timed.attemptId)).toEqual({ startedMs: 1_000, deadlineMs: 121_000, secondsUsed: 42 });

    const active = (await repo.getActiveVersion("mat-1"))!;
    await repo.saveSessionAction({
      action: "record_response",
      operationId: crypto.randomUUID(),
      attemptId: timed.attemptId,
      itemId: active.items[0]!.id,
      expectedRevision: 0,
      selectedIndex: 0,
      isDontKnow: false,
    });
    await repo.saveSessionAction({ action: "complete_attempt", operationId: crypto.randomUUID(), attemptId: timed.attemptId, expectedRevision: 1 });
    const history = await repo.getCompletedHistory(active.version.historyKey);
    expect(history[0]).toMatchObject({ attemptId: timed.attemptId, timedStartedMs: 1_000, timedDeadlineMs: 121_000, timedSecondsUsed: 42 });
    expect(await repo.getAttempt(timed.attemptId)).toMatchObject({ timedSecondsUsed: 42 });
  });

  it("imports old browser records: unknown ids skipped, DB values kept, key removed", async () => {
    const repo = practiceSessionRepository(db);
    const a = await start(repo, "mat-1");
    const b = await start(repo, "mat-2");
    await repo.setTimedStart(b.attemptId, 7, 8);
    const storage = fakeStorage(
      JSON.stringify({
        [a.attemptId]: { startedMs: 100, deadlineMs: 700, secondsUsed: 50 },
        [b.attemptId]: { startedMs: 1, deadlineMs: 2 },
        "no-such-attempt": { startedMs: 1, deadlineMs: 2 },
        junk: { startedMs: "x" },
      }),
    );
    await repo.importLegacyTimedAttempts(storage);
    expect(storage.peek()).toBeNull();
    expect(await repo.getTimedRecord(a.attemptId)).toEqual({ startedMs: 100, deadlineMs: 700, secondsUsed: 50 });
    expect(await repo.getTimedRecord(b.attemptId)).toEqual({ startedMs: 7, deadlineMs: 8 });
    await repo.importLegacyTimedAttempts(storage); // idempotent
    const rows = await db.select("SELECT COUNT(*) AS n FROM practice_attempts WHERE timed_started_ms IS NOT NULL");
    expect(rows).toEqual([{ n: 2 }]);
  });

  it("ignores bad JSON and drops the key", async () => {
    const repo = practiceSessionRepository(db);
    const a = await start(repo, "mat-1");
    for (const bad of ["{not json", "[1,2]", "null", "7"]) {
      const storage = fakeStorage(bad);
      await expect(repo.importLegacyTimedAttempts(storage)).resolves.toBeUndefined();
      expect(storage.peek()).toBeNull();
    }
    expect(await repo.getTimedRecord(a.attemptId)).toBeNull();
    await expect(repo.importLegacyTimedAttempts(fakeStorage(null))).resolves.toBeUndefined();
  });

  it("the first timed read imports from real localStorage once", async () => {
    const repo = practiceSessionRepository(db);
    const a = await start(repo, "mat-1");
    const store = new Map<string, string>([[LEGACY_TIMED_STORAGE_KEY, JSON.stringify({ [a.attemptId]: { startedMs: 5, deadlineMs: 9 } })]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      removeItem: (k: string) => void store.delete(k),
    });
    try {
      expect(await repo.getTimedRecord(a.attemptId)).toEqual({ startedMs: 5, deadlineMs: 9 });
      expect(store.has(LEGACY_TIMED_STORAGE_KEY)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
