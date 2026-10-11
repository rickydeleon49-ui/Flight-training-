/**
 * Shared, synthetic fixtures for the M3 prototype tests.
 *
 * `buildPopulatedSchema13` writes a genuine schema-13 library through the
 * shipped production driver and repositories (debrief transaction with its
 * action and question, practice attempt, rated card, split lineage), so the
 * upgrade and restore proofs start from real shipped behaviour rather than
 * hand-written rows.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { CardItemAction } from "@/domain/types";
import { createRepositories } from "@/data/repositories";
import { practiceSessionRepository } from "@/data/repositories/practiceSessionRepository";
import { createNodeSqliteDatabase } from "@/data/testing/nodeSqliteDb";

import { openCandidateStore, openEngine, type CandidateStore, type EngineName } from "../prototype/candidateEngine";
import type { SkillEvidenceAction } from "../prototype/types";

export const T0 = "2026-10-08T12:00:00.000Z";

let counter = 0;
/** Deterministic UUID v4s, unique per process. */
export function uuid(): string {
  counter += 1;
  const hex = counter.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

/** A fixed, injectable clock: every call returns the same instant unless advanced. */
export function clock(start = "2026-10-10T09:00:00.000Z") {
  let ms = Date.parse(start);
  const now = () => new Date(ms).toISOString();
  return { now, advance: (by = 1000) => (ms += by) };
}

export function tempDir(prefix: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface Debrief {
  journalId: string;
  actionId: string;
  questionId: string;
}

/** A real debrief through the shipped atomic transaction (journal + action + question). */
export async function saveDebrief(
  db: Awaited<ReturnType<typeof createNodeSqliteDatabase>>,
  overrides: { title?: string; date?: string; instructorFeedback?: string; wasDifficult?: string } = {},
): Promise<Debrief> {
  const journalId = uuid();
  const actionId = uuid();
  const questionId = uuid();
  await db.saveDebriefAtomically!({
    operationId: uuid(),
    targetId: journalId,
    journal: {
      date: overrides.date ?? "2026-10-01",
      title: overrides.title ?? "Pattern work",
      instructorFeedback: overrides.instructorFeedback ?? "Look further down the runway in the flare.",
      wasDifficult: overrides.wasDifficult ?? "Holding centerline in the gusts.",
      wentWell: "Radio calls felt calmer.",
      practiced: "Six landings.",
      confidence: 3,
      instructorName: "Synthetic CFI",
    },
    action: { id: actionId, title: "Review flare timing" },
    question: { id: questionId, text: "When should I add power on a go-around?" },
  });
  return { journalId, actionId, questionId };
}

/**
 * A populated schema-13 library on disk, written by the production driver.
 * Returns its path and the ids of what it holds.
 */
export async function buildPopulatedSchema13(path: string) {
  const db = await createNodeSqliteDatabase(path);
  const repos = createRepositories(db);
  const debrief = await saveDebrief(db);
  const second = await saveDebrief(db, { title: "Crosswind practice", date: "2026-10-03" });

  // Study material with practice history and a rated card.
  await db.execute(
    "INSERT INTO study_materials (id, title, file_path, created_at, updated_at) VALUES ('mat', 'Synthetic handbook', 'mat.pdf', ?, ?)",
    [T0, T0],
  );
  await db.savePracticeTestAtomically!({
    sourceMaterialId: "mat",
    title: "Synthetic",
    questions: [
      { question: "Synthetic one", options: ["A", "B"], correctIndex: 0, explanation: "", sourcePage: null },
      { question: "Synthetic two", options: ["A", "B"], correctIndex: 1, explanation: "", sourcePage: null },
    ],
    model: "synthetic",
  });
  const practice = practiceSessionRepository(db);
  const active = (await practice.getActiveVersion("mat"))!;
  const started = await practice.saveSessionAction({
    action: "start_or_resume", operationId: uuid(), materialId: "mat", versionId: active.version.id,
  });
  await practice.saveSessionAction({
    action: "record_response", operationId: uuid(), attemptId: started.attemptId,
    itemId: active.items[0]!.id, expectedRevision: 0, selectedIndex: 0, isDontKnow: false,
  });
  await db.execute(
    `INSERT INTO ai_study_sets (source_material_id, title, summary, sections_json, flashcards_json, source_notes,
       provider, model, generated_at, updated_at)
     VALUES ('mat', 'Synthetic', '', '[]', ?, '', 'import', '', ?, ?)`,
    [JSON.stringify([{ front: "Synthetic front", back: "Synthetic back", sourcePage: null }]), T0, T0],
  );
  const snap = await repos.cardReviews.getCardReviewSnapshot("mat");
  if (snap.current.status !== "ok") throw new Error("no cards");
  await repos.cardReviews.saveAction({
    action: "rate", rating: "good", operationId: uuid(), materialId: "mat",
    versionContentHash: snap.current.contentHash, itemId: snap.current.items[0]!.itemId,
    expectedGeneration: snap.generation, expectedRevision: 0,
  } as CardItemAction);

  // Split lineage (schema 13).
  await db.execute(
    "INSERT INTO study_materials (id, title, file_path, created_at, updated_at) VALUES ('part', 'Synthetic part', 'part.pdf', ?, ?)",
    [T0, T0],
  );
  await db.execute(
    `INSERT INTO material_split_lineage (material_id, parent_material_id, root_material_id,
       source_page_start, source_page_end, child_page_count, source_file_name, source_title,
       source_content_sha256, source_total_pages, nested_level, created_at)
     VALUES ('part', NULL, 'mat', 1, 10, 10, 'mat.pdf', 'Synthetic handbook', ?, 40, 1, ?)`,
    ["d".repeat(64), T0],
  );
  db.close();
  return { debrief, second };
}

/** A candidate store with one real debrief already saved through the shipped transaction. */
export async function candidateWithDebrief(engine: EngineName = "node:sqlite") {
  const e = await openEngine(engine);
  const store = await openCandidateStore(e);
  // The debrief path is the shipped one; run it on this same connection.
  const { executeDebriefSave } = await import("@/data/debriefTransaction");
  const journalId = uuid();
  const actionId = uuid();
  await executeDebriefSave(
    (sql) => e.exec(sql),
    (sql, params) => e.run(sql, params),
    (sql, params) => e.query(sql, params).length > 0,
    {
      operationId: uuid(),
      targetId: journalId,
      journal: {
        date: "2026-10-01",
        title: "Pattern work",
        instructorFeedback: "Look further down the runway in the flare.",
        wasDifficult: "Holding centerline in the gusts.",
        instructorName: "Synthetic CFI",
      },
      action: { id: actionId, title: "Review flare timing" },
    },
  );
  return { engine: e, store, journalId, actionId };
}

export function observation(
  skillId: string,
  journalId: string,
  overrides: Partial<Extract<SkillEvidenceAction, { action: "create_observation" }>> = {},
): Extract<SkillEvidenceAction, { action: "create_observation" }> {
  return {
    action: "create_observation",
    operationId: uuid(),
    observationId: uuid(),
    skillId,
    journalId,
    sourceField: "instructor_feedback",
    wording: "Look further down the runway in the flare.",
    observedOn: "2026-10-01",
    attribution: "instructor_transcribed",
    instructorName: "Synthetic CFI",
    ...overrides,
  };
}

export async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e as { code?: string; message?: string },
  );
  if (!error) throw new Error(`expected ${code}, but it succeeded`);
  if (error.code !== code) throw new Error(`expected ${code}, got ${error.code ?? "no code"}: ${error.message}`);
}

export type { CandidateStore };
