/**
 * SqlDatabase backed by Node's built-in SQLite. Used by the test suite so
 * repositories are exercised against real SQLite — including foreign keys
 * and partial unique indexes — rather than a hand-written fake.
 *
 * It holds one connection, so every public method runs through a
 * `ConnectionOwner` (see `connectionOwner.ts`), exactly like the sql.js
 * browser driver.
 *
 * Initialization follows the browser contract: legacy conversion and
 * whole-database validation (`practiceStateValidation.ts`) run on one
 * transaction before the driver is returned. A failure rolls the conversion
 * back, closes the connection and rejects, so tests exercise the same
 * refusal the browser driver gives.
 */
import type { SqlDatabase, SqlValue } from "../db";
import { createConnectionOwner, refuseTransactionControl, rollbackIfOpen } from "../connectionOwner";
import { executeDebriefSave } from "../debriefTransaction";
import { executeMaterialSave, executeMaterialsBatch } from "../materialTransaction";
import { executeStructuredImport } from "../structuredImportTransaction";
import { executeCardReviewAction } from "../cardReviewTransaction";
import { readLibraryRecentReviews, readLibraryReviewDue } from "../cardLibraryReader";
import { executeSkillEvidenceAction } from "../skillEvidenceTransaction";
import { listSkills, readEvidencePage, readObservationHistory, readSkillSummary } from "../skillEvidenceReader";
import {
  executeEraseHistoryAction,
  executeLegacyConversion,
  executePracticeSessionAction,
  executeRemovePracticeTest,
  executeSavePracticeTest,
} from "../practiceSessionTransaction";
import { applyMigrations } from "../migrations";
import { validateApplicationDatabase, type ValidationQuery } from "../practiceStateValidation";

export interface TestDatabase extends SqlDatabase {
  close(): void;
  /**
   * Test-only fault seam: awaited before every data statement — public
   * `execute` and the statements inside the atomic saves — so a test can fail
   * or pause one specific write. Transaction control and reads are not routed
   * through it. This driver is never used by the app.
   */
  beforeStatement?: (sql: string, params: SqlValue[]) => void | Promise<void>;
}

// Keep this native-only module out of Vite's jsdom client transform. Node 22
// supports it, but does not expose it through builtinModules for Vite to
// recognize automatically.
const nativeSqlite = "node:sqlite";

let reference: Promise<ValidationQuery> | null = null;

/**
 * The registered-migration schema reference, built once per process: it is
 * only ever read, and every test database opens through it.
 */
function schemaReference(): Promise<ValidationQuery> {
  reference ??= (async () => {
    const { DatabaseSync } = await import(/* @vite-ignore */ nativeSqlite);
    const handle = new DatabaseSync(":memory:");
    await applyMigrations((sql) => handle.exec(sql), new Set());
    return (sql: string, params: SqlValue[]) => handle.prepare(sql).all(...params) as Record<string, unknown>[];
  })();
  return reference;
}

export async function createNodeSqliteDatabase(path = ":memory:"): Promise<TestDatabase> {
  const { DatabaseSync } = await import(/* @vite-ignore */ nativeSqlite);
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");

  // Reopening an existing file must skip the migrations it already has, the
  // same way the real drivers do; otherwise a second launch fails outright.
  const applied = new Set<number>();
  try {
    for (const row of db.prepare("SELECT version FROM schema_migrations").all()) {
      applied.add(Number((row as { version: number }).version));
    }
  } catch {
    // No migrations table yet — this is a fresh database.
  }

  await applyMigrations((sql) => db.exec(sql), applied);

  let testDb: TestDatabase;

  // Raw statements for use inside an owned operation only.
  const exec = (sql: string): void => {
    db.exec(sql);
  };
  const run = async (sql: string, params: SqlValue[]): Promise<void> => {
    await testDb?.beforeStatement?.(sql, params);
    db.prepare(sql).run(...params);
  };
  const query = (sql: string, params: SqlValue[]) =>
    db.prepare(sql).all(...params) as Record<string, unknown>[];

  // Initialization: conversion plus validation on one transaction, before
  // the driver exists.
  const referenceQuery = await schemaReference();
  try {
    await executeLegacyConversion(exec, run, query, undefined, () =>
      validateApplicationDatabase(query, referenceQuery),
    );
  } catch (error) {
    db.close();
    throw error;
  }

  const owner = createConnectionOwner(() => rollbackIfOpen(exec));

  testDb = {
    select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return owner.exclusive(() => {
        refuseTransactionControl(sql);
        return query(sql, params) as T[];
      });
    },
    execute(sql: string, params: SqlValue[] = []): Promise<void> {
      return owner.exclusive(() => {
        refuseTransactionControl(sql);
        return run(sql, params);
      });
    },
    saveDebriefAtomically(operation: import("../db").DebriefSaveOperation): Promise<void> {
      return owner.exclusive(() =>
        executeDebriefSave(
          exec,
          run,
          (sql, params) => Boolean(db.prepare(sql).get(...params)),
          operation,
        ),
      );
    },
    saveMaterialAtomically(
      operation: import("../db").MaterialSaveOperation,
    ): Promise<import("@/domain/types").StudyMaterial> {
      return owner.exclusive(() => executeMaterialSave(exec, run, query, operation));
    },
    saveMaterialsAtomically(materials: import("@/domain/types").StudyMaterial[]): Promise<void> {
      return owner.exclusive(() => executeMaterialsBatch(exec, run, query, materials));
    },
    saveStructuredImportAtomically(
      operation: import("../db").StructuredImportSaveOperation,
    ): Promise<import("../db").NativeImportSaveResult> {
      return owner.exclusive(() => executeStructuredImport(exec, run, query, operation));
    },
    savePracticeSessionAtomically(
      action: import("@/domain/types").PracticeSessionAction,
    ): Promise<import("@/domain/types").PracticeSessionActionResult> {
      return owner.exclusive(() => executePracticeSessionAction(exec, run, query, action));
    },
    savePracticeTestAtomically(
      operation: import("../db").PracticeTestSaveOperation,
    ): Promise<void> {
      return owner.exclusive(() => executeSavePracticeTest(exec, run, query, operation));
    },
    removePracticeTestAtomically(
      sourceMaterialId: string,
    ): Promise<void> {
      return owner.exclusive(() => executeRemovePracticeTest(exec, run, query, sourceMaterialId));
    },
    erasePracticeHistoryAtomically(
      action: import("@/domain/types").EraseHistoryAction,
    ): Promise<import("@/domain/types").EraseHistoryResult> {
      return owner.exclusive(() => executeEraseHistoryAction(exec, run, query, action));
    },
    saveCardReviewAtomically(
      action: import("@/domain/types").CardReviewAction,
    ): Promise<import("@/domain/types").CardReviewResult> {
      return owner.exclusive(() => executeCardReviewAction(exec, run, query, action));
    },
    readLibraryReviewDue(
      input: import("@/domain/types").LibraryReviewDueInput,
    ): Promise<import("@/domain/types").LibraryReviewDueResult> {
      return owner.exclusive(() => readLibraryReviewDue(query, input));
    },
    readLibraryRecentReviews(
      input: import("@/domain/types").LibraryRecentReviewsInput,
    ): Promise<import("@/domain/types").LibraryRecentReviewsResult> {
      return owner.exclusive(() => readLibraryRecentReviews(query, input));
    },
    saveSkillEvidenceAtomically(
      action: import("@/domain/types").SkillEvidenceAction,
    ): Promise<import("@/domain/types").SkillEvidenceOutcome> {
      return owner.exclusive(() => executeSkillEvidenceAction(exec, run, query, action));
    },
    readSkillEvidencePage(input: import("@/domain/types").EvidencePageInput) {
      return owner.exclusive(() => readEvidencePage(query, input));
    },
    readSkillSummary(skillId: string) {
      return owner.exclusive(() => readSkillSummary(query, skillId));
    },
    listSkills(options: { includeRetired?: boolean }) {
      return owner.exclusive(() => listSkills(query, options));
    },
    readObservationHistory(input: import("@/domain/types").ObservationHistoryInput) {
      return owner.exclusive(() => readObservationHistory(query, input));
    },
    close() {
      db.close();
    },
  };
  return testDb;
}
