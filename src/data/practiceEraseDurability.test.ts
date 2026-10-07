/**
 * M2 PR2 finishing evidence: browser history erasure when recovery cannot
 * return the connection to a safe state. Real sql.js over its WASM build with
 * an in-memory storage map — never a user profile, browser store or provider.
 */
import initSqlJs, { type BindParams } from "sql.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sql.js/dist/sql-wasm.wasm?url", () => ({
  default: `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`,
}));

import { DatabaseDisabledError } from "./persistenceErrors";
import { practiceSessionRepository } from "./repositories/practiceSessionRepository";
import { createSqlJsDatabase } from "./sqlJsDb";

const WASM = `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
const MAT = "mat-erase-disabled";
const stamp = "2026-10-05T00:00:00.000Z";

const sqlJs = () => initSqlJs({ locateFile: () => WASM });

let stored: Map<string, string>;

beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** One saved test with one unfinished attempt that already holds an answer. */
async function seedErasureTarget() {
  const db = await createSqlJsDatabase();
  await db.execute(
    `INSERT INTO study_materials (id, title, created_at, updated_at)
     VALUES ('${MAT}', 'Disabled Erase Material', '${stamp}', '${stamp}')`,
  );
  await db.savePracticeTestAtomically!({
    sourceMaterialId: MAT,
    title: "Disabled Erase Test",
    questions: [
      { question: "Q1", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null },
    ],
    model: "synthetic",
  });
  const repo = practiceSessionRepository(db);
  const active = (await repo.getActiveVersion(MAT))!;
  const started = await repo.saveSessionAction({
    action: "start_or_resume",
    operationId: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a",
    materialId: MAT,
    versionId: active.version.id,
  });
  if (!("attemptId" in started)) throw new Error("Expected an in-progress attempt");
  await repo.saveSessionAction({
    action: "record_response",
    operationId: "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b",
    attemptId: started.attemptId,
    itemId: active.items[0]!.id,
    expectedRevision: 0,
    selectedIndex: 1,
    isDontKnow: false,
  });
  return { db, repo, attemptId: started.attemptId, versionId: active.version.id };
}

async function practiceRows(db: Awaited<ReturnType<typeof createSqlJsDatabase>>) {
  const attempts = await db.select<{ id: string }>(
    "SELECT id FROM practice_attempts WHERE source_material_id = ?",
    [MAT],
  );
  const responses = await db.select<{ id: string }>(
    "SELECT r.id FROM practice_responses r JOIN practice_attempts a ON r.attempt_id = a.id WHERE a.source_material_id = ?",
    [MAT],
  );
  const receipts = await db.select<{ id: string }>(
    "SELECT operation_id AS id FROM practice_session_operations WHERE history_key = ?",
    [MAT],
  );
  return { attempts: attempts.length, responses: responses.length, receipts: receipts.length };
}

describe("browser history erasure durability (M2 PR2 R10)", () => {
  it("an erasure whose recovery fails disables the adapter and keeps every saved row", async () => {
    const SQL = await sqlJs();
    const { db, repo, attemptId } = await seedErasureTarget();
    const before = await practiceRows(db);
    expect(before).toEqual({ attempts: 1, responses: 1, receipts: 2 });
    const storedBefore = stored.get("her-flight-deck.dev-database");
    expect(storedBefore).toBeTruthy();

    // Storage refuses the erasure's export, and recovery cannot prove foreign
    // keys on any handle, so the connection owner disables itself.
    vi.spyOn(SQL.Database.prototype, "export").mockImplementationOnce(() => {
      throw new Error("synthetic export failure");
    });
    const originalExec = SQL.Database.prototype.exec;
    vi.spyOn(SQL.Database.prototype, "exec").mockImplementation(function (
      this: InstanceType<typeof SQL.Database>,
      sql: string,
      params?: BindParams,
    ) {
      if (/^\s*PRAGMA foreign_keys\s*;?\s*$/i.test(sql)) {
        return [{ columns: ["foreign_keys"], values: [[0]] }];
      }
      return originalExec.call(this, sql, params);
    });

    const erase = {
      action: "erase_history" as const,
      operationId: "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c",
      historyKey: MAT,
    };
    await expect(repo.eraseHistory(erase)).rejects.toBeInstanceOf(DatabaseDisabledError);
    await expect(repo.eraseHistory(erase)).rejects.toBeInstanceOf(DatabaseDisabledError);
    await expect(db.select("SELECT 1")).rejects.toBeInstanceOf(DatabaseDisabledError);

    // The stored bytes never changed, so the refused erasure is not in them.
    expect(stored.get("her-flight-deck.dev-database")).toBe(storedBefore);

    vi.restoreAllMocks();

    // Recovery: reopening the last stored archive returns everything intact.
    const reopened = await createSqlJsDatabase();
    const reopenedRepo = practiceSessionRepository(reopened);
    const restored = await reopenedRepo.getAttempt(attemptId);
    expect(restored).toMatchObject({ status: "in_progress", answeredCount: 1 });
    expect(await practiceRows(reopened)).toEqual(before);

    // A new deliberate erasure with its own identity now succeeds for real.
    const retried = await reopenedRepo.eraseHistory({
      action: "erase_history",
      operationId: "0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d",
      historyKey: MAT,
    });
    expect(retried.erased).toBe(true);
    expect(await practiceRows(reopened)).toEqual({ attempts: 0, responses: 0, receipts: 3 });
    expect(await reopenedRepo.getCurrentAttempt(MAT)).toBeNull();
    // Completed history stays addressable through the preserved active version.
    expect(await reopenedRepo.getActiveVersion(MAT)).not.toBeNull();
  });
});
