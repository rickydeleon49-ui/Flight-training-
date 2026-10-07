/**
 * Single-connection atomic transactions for Practice Sessions (M2 PR 1).
 *
 * Implements the normative persistence contracts from Appendix B & E:
 * - Exact five action request handling with strict schema validation.
 * - Local canonical JSON SHA-256 hash derivation.
 * - Persistent idempotent operation receipts with conflict detection.
 * - Single in-progress attempt per material and revision checks.
 * - Strict scoring and tallies derived from frozen questions.
 * - Startup legacy conversion and safe Gemini replacement / test deletion.
 */

import type {
  EraseHistoryAction,
  EraseHistoryResult,
  PracticeAbandonResult,
  PracticeCompletedResult,
  PracticeQuestion,
  PracticeRecordResponseResult,
  PracticeSessionAction,
  PracticeSessionActionResult,
  PracticeSessionResponseSummary,
  PracticeSessionState,
} from "@/domain/types";

import type { SqlValue } from "./db";
import { PracticeSessionError, type PracticeSessionErrorCode } from "./persistenceErrors";

export type Query = (sql: string, params: SqlValue[]) => Promise<Record<string, unknown>[]> | Record<string, unknown>[];

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_ID_CHARS = 128;
const MAX_QUESTION_CHARS = 10_000;
const MAX_EXPLANATION_CHARS = 5_000;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;
const MAX_OPTION_CHARS = 1_000;
const MAX_PRACTICE_QUESTIONS = 200;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VALID_ID = /^[A-Za-z0-9_.-]+$/;

function refuse(code: PracticeSessionErrorCode): never {
  throw new PracticeSessionError(code);
}

export function isUuidV4(value: string): boolean {
  return typeof value === "string" && UUID_V4.test(value);
}

export function isValidId(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_CHARS && VALID_ID.test(value);
}

export function codePointLength(str: string): number {
  return Array.from(str).length;
}

/** Formats JSON canonically with sorted object keys and compact whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map(
        (key) =>
          JSON.stringify(key) +
          ":" +
          canonicalJson((value as Record<string, unknown>)[key]),
      )
      .join(",") +
    "}"
  );
}

/** Compute SHA-256 of canonical JSON string. */
export async function computeCanonicalHash(value: unknown): Promise<string> {
  const text = canonicalJson(value);
  if (typeof globalThis.crypto?.subtle?.digest === "function") {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const { createHash } = await import(/* @vite-ignore */ "node:crypto");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

type Json = Record<string, unknown>;

function exactObject(value: unknown, allowedKeys: readonly string[]): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    refuse("INVALID_ARGUMENT");
  }
  const own = Object.keys(value);
  if (own.length !== allowedKeys.length || !allowedKeys.every((k) => Object.prototype.hasOwnProperty.call(value, k))) {
    refuse("INVALID_ARGUMENT");
  }
  return value as Json;
}

function stringAt(object: Json, key: string): string {
  const val = object[key];
  if (typeof val !== "string") refuse("INVALID_ARGUMENT");
  return val;
}

function integerAt(object: Json, key: string, min: number, max: number): number {
  const val = object[key];
  if (typeof val !== "number" || !Number.isInteger(val) || val < min || val > max) {
    refuse("INVALID_ARGUMENT");
  }
  return val;
}

function boolAt(object: Json, key: string): boolean {
  const val = object[key];
  if (typeof val !== "boolean") refuse("INVALID_ARGUMENT");
  return val;
}

/** Strictly validate and decode incoming practice action request. */
export function decodePracticeAction(value: unknown): PracticeSessionAction {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    refuse("INVALID_ARGUMENT");
  }
  const jsonStr = JSON.stringify(value);
  if (jsonStr.length > MAX_PAYLOAD_BYTES) refuse("INVALID_ARGUMENT");

  const obj = exactObject(value, Object.keys(value as Json));
  const action = stringAt(obj, "action");
  const operationId = stringAt(obj, "operationId");
  if (!isUuidV4(operationId)) refuse("INVALID_ARGUMENT");

  switch (action) {
    case "start_or_resume": {
      exactObject(value, ["action", "operationId", "materialId", "versionId"]);
      const materialId = stringAt(obj, "materialId");
      const versionId = stringAt(obj, "versionId");
      if (!isValidId(materialId) || !isValidId(versionId)) refuse("INVALID_ARGUMENT");
      return { action, operationId, materialId, versionId };
    }
    case "record_response": {
      exactObject(value, [
        "action",
        "operationId",
        "attemptId",
        "itemId",
        "expectedRevision",
        "selectedIndex",
        "isDontKnow",
      ]);
      const attemptId = stringAt(obj, "attemptId");
      const itemId = stringAt(obj, "itemId");
      if (!isValidId(attemptId) || !isValidId(itemId)) refuse("INVALID_ARGUMENT");
      const expectedRevision = integerAt(obj, "expectedRevision", 0, 2_147_483_647);
      const isDontKnow = boolAt(obj, "isDontKnow");
      let selectedIndex: number | null = null;
      if (isDontKnow) {
        if (obj["selectedIndex"] !== null) refuse("INVALID_ARGUMENT");
      } else {
        if (typeof obj["selectedIndex"] !== "number") refuse("INVALID_ARGUMENT");
        selectedIndex = integerAt(obj, "selectedIndex", 0, 100);
      }
      return {
        action,
        operationId,
        attemptId,
        itemId,
        expectedRevision,
        selectedIndex,
        isDontKnow,
      };
    }
    case "complete_attempt": {
      exactObject(value, ["action", "operationId", "attemptId", "expectedRevision"]);
      const attemptId = stringAt(obj, "attemptId");
      if (!isValidId(attemptId)) refuse("INVALID_ARGUMENT");
      const expectedRevision = integerAt(obj, "expectedRevision", 0, 2_147_483_647);
      return { action, operationId, attemptId, expectedRevision };
    }
    case "retake_attempt": {
      exactObject(value, [
        "action",
        "operationId",
        "expectedAttemptId",
        "materialId",
        "versionId",
      ]);
      const materialId = stringAt(obj, "materialId");
      const versionId = stringAt(obj, "versionId");
      if (!isValidId(materialId) || !isValidId(versionId)) refuse("INVALID_ARGUMENT");
      let expectedAttemptId: string | null = null;
      if (obj["expectedAttemptId"] !== null) {
        expectedAttemptId = stringAt(obj, "expectedAttemptId");
        if (!isValidId(expectedAttemptId)) refuse("INVALID_ARGUMENT");
      }
      return {
        action,
        operationId,
        expectedAttemptId,
        materialId,
        versionId,
      };
    }
    case "abandon_attempt": {
      exactObject(value, ["action", "operationId", "attemptId", "expectedRevision"]);
      const attemptId = stringAt(obj, "attemptId");
      if (!isValidId(attemptId)) refuse("INVALID_ARGUMENT");
      const expectedRevision = integerAt(obj, "expectedRevision", 0, 2_147_483_647);
      return { action, operationId, attemptId, expectedRevision };
    }
    default:
      refuse("INVALID_ARGUMENT");
  }
}

/** Build in-progress attempt state representation. */
async function buildSessionState(
  query: Query,
  attemptId: string,
): Promise<PracticeSessionState> {
  const [att] = await query(
    `SELECT version_id, started_at, total_questions, answered_count, revision
     FROM practice_attempts WHERE id = ? AND status = 'in_progress'`,
    [attemptId],
  );
  if (!att) refuse("NOT_FOUND");

  const responseRows = await query(
    `SELECT item_id, selected_index, is_dont_know, is_correct, answered_at
     FROM practice_responses WHERE attempt_id = ? ORDER BY answered_at ASC, id ASC`,
    [attemptId],
  );

  const responses: PracticeSessionResponseSummary[] = responseRows.map((r) => ({
    itemId: String(r["item_id"]),
    selectedIndex: r["selected_index"] !== null && r["selected_index"] !== undefined ? Number(r["selected_index"]) : null,
    isDontKnow: Number(r["is_dont_know"]) === 1,
    isCorrect: Number(r["is_correct"]) === 1,
    answeredAt: String(r["answered_at"]),
  }));

  const [unansweredRow] = await query(
    `SELECT ordinal FROM practice_test_items
     WHERE version_id = ? AND id NOT IN (
         SELECT item_id FROM practice_responses WHERE attempt_id = ?
     ) ORDER BY ordinal ASC LIMIT 1`,
    [String(att["version_id"]), attemptId],
  );

  const nextUnansweredOrdinal =
    unansweredRow && unansweredRow["ordinal"] !== undefined && unansweredRow["ordinal"] !== null
      ? Number(unansweredRow["ordinal"])
      : null;

  return {
    attemptId,
    versionId: String(att["version_id"]),
    status: "in_progress",
    startedAt: String(att["started_at"]),
    completedAt: null,
    totalQuestions: Number(att["total_questions"]),
    answeredCount: Number(att["answered_count"]),
    revision: Number(att["revision"]),
    nextUnansweredOrdinal,
    responses,
  };
}

/** Execute a practice session action within an owned single-connection transaction. */
export async function executePracticeSessionAction(
  exec: (sql: string) => Promise<void> | void,
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  actionInput: unknown,
  timestamp: string = new Date().toISOString(),
): Promise<PracticeSessionActionResult> {
  const action = decodePracticeAction(actionInput);
  const currentHash = await computeCanonicalHash(actionInput);
  const operationId = action.operationId;
  const actionName = action.action;

  await exec("BEGIN IMMEDIATE");
  try {
    // 1. Inspect practice_session_operations for replay or conflict
    const [receipt] = await query(
      "SELECT request_hash, result_json, is_erased FROM practice_session_operations WHERE operation_id = ?",
      [operationId],
    );

    if (receipt) {
      if (receipt["request_hash"] !== currentHash) {
        refuse("OPERATION_CONFLICT");
      }
      if (Number(receipt["is_erased"]) === 1) {
        refuse("INVALID_STATE");
      }
      await exec("COMMIT");
      return JSON.parse(String(receipt["result_json"])) as PracticeSessionActionResult;
    }

    let historyKey = "";
    let attemptId = "";
    let resultVal: PracticeSessionActionResult;

    switch (action.action) {
      case "start_or_resume": {
        const [version] = await query(
          "SELECT history_key, source_material_title, is_active FROM practice_test_versions WHERE id = ? AND source_material_id = ?",
          [action.versionId, action.materialId],
        );
        if (!version || Number(version["is_active"]) !== 1) {
          refuse("NOT_FOUND");
        }
        historyKey = String(version["history_key"]);

        const [existing] = await query(
          "SELECT id FROM practice_attempts WHERE source_material_id = ? AND status = 'in_progress'",
          [action.materialId],
        );

        if (existing) {
          attemptId = String(existing["id"]);
        } else {
          const [countRow] = await query(
            "SELECT COUNT(*) AS total FROM practice_test_items WHERE version_id = ?",
            [action.versionId],
          );
          const totalQuestions = Number(countRow?.["total"] ?? 0);
          attemptId = crypto.randomUUID();

          await run(
            `INSERT INTO practice_attempts (
               id, version_id, source_material_id, source_material_title,
               started_at, completed_at, status, revision, total_questions,
               answered_count, correct_count, incorrect_count, dont_know_count, score_percent
             ) VALUES (?, ?, ?, ?, ?, NULL, 'in_progress', 0, ?, 0, 0, 0, 0, NULL)`,
            [
              attemptId,
              action.versionId,
              action.materialId,
              String(version["source_material_title"]),
              timestamp,
              totalQuestions,
            ],
          );
        }

        resultVal = await buildSessionState(query, attemptId);
        break;
      }

      case "retake_attempt": {
        const [version] = await query(
          "SELECT history_key, source_material_title, is_active FROM practice_test_versions WHERE id = ? AND source_material_id = ?",
          [action.versionId, action.materialId],
        );
        if (!version || Number(version["is_active"]) !== 1) {
          refuse("NOT_FOUND");
        }
        historyKey = String(version["history_key"]);

        const [currInProgress] = await query(
          "SELECT id FROM practice_attempts WHERE source_material_id = ? AND status = 'in_progress'",
          [action.materialId],
        );

        const currentId = currInProgress ? String(currInProgress["id"]) : null;

        if (currentId !== null && action.expectedAttemptId !== null) {
          if (currentId !== action.expectedAttemptId) {
            refuse("INVALID_STATE");
          }
          await run(
            "UPDATE practice_attempts SET status = 'abandoned', completed_at = ?, revision = revision + 1 WHERE id = ?",
            [timestamp, currentId],
          );
        } else if (currentId !== null && action.expectedAttemptId === null) {
          refuse("INVALID_STATE");
        } else if (currentId === null && action.expectedAttemptId !== null) {
          refuse("INVALID_STATE");
        }

        const [countRow] = await query(
          "SELECT COUNT(*) AS total FROM practice_test_items WHERE version_id = ?",
          [action.versionId],
        );
        const totalQuestions = Number(countRow?.["total"] ?? 0);
        attemptId = crypto.randomUUID();

        await run(
          `INSERT INTO practice_attempts (
             id, version_id, source_material_id, source_material_title,
             started_at, completed_at, status, revision, total_questions,
             answered_count, correct_count, incorrect_count, dont_know_count, score_percent
           ) VALUES (?, ?, ?, ?, ?, NULL, 'in_progress', 0, ?, 0, 0, 0, 0, NULL)`,
          [
            attemptId,
            action.versionId,
            action.materialId,
            String(version["source_material_title"]),
            timestamp,
            totalQuestions,
          ],
        );

        resultVal = await buildSessionState(query, attemptId);
        break;
      }

      case "record_response": {
        attemptId = action.attemptId;
        const [attempt] = await query(
          `SELECT a.version_id, a.revision, a.status, v.history_key
           FROM practice_attempts a
           JOIN practice_test_versions v ON a.version_id = v.id
           WHERE a.id = ?`,
          [attemptId],
        );

        if (!attempt) refuse("NOT_FOUND");
        if (String(attempt["status"]) !== "in_progress") refuse("INVALID_STATE");
        if (Number(attempt["revision"]) !== action.expectedRevision) refuse("INVALID_STATE");

        historyKey = String(attempt["history_key"]);
        const versionId = String(attempt["version_id"]);

        const [item] = await query(
          "SELECT correct_index, options_json FROM practice_test_items WHERE id = ? AND version_id = ?",
          [action.itemId, versionId],
        );
        if (!item) refuse("NOT_FOUND");

        const options = JSON.parse(String(item["options_json"])) as string[];
        if (action.selectedIndex !== null) {
          if (action.selectedIndex < 0 || action.selectedIndex >= options.length) {
            refuse("INVALID_ARGUMENT");
          }
        }

        const isCorrect =
          !action.isDontKnow && action.selectedIndex !== null && action.selectedIndex === Number(item["correct_index"]);

        const [existing] = await query(
          "SELECT selected_index, is_dont_know, answered_at FROM practice_responses WHERE attempt_id = ? AND item_id = ?",
          [attemptId, action.itemId],
        );

        let finalRevision = Number(attempt["revision"]);
        let finalAnsweredAt = timestamp;

        if (existing) {
          const storedSel = existing["selected_index"] !== null && existing["selected_index"] !== undefined ? Number(existing["selected_index"]) : null;
          const storedDk = Number(existing["is_dont_know"]) === 1;

          if (storedSel === action.selectedIndex && storedDk === action.isDontKnow) {
            // No-op on attempt revision and timestamps, but receipt is recorded
            finalAnsweredAt = String(existing["answered_at"]);
          } else {
            await run(
              `UPDATE practice_responses SET selected_index = ?, is_dont_know = ?, is_correct = ?, answered_at = ?
               WHERE attempt_id = ? AND item_id = ?`,
              [
                action.selectedIndex,
                action.isDontKnow ? 1 : 0,
                isCorrect ? 1 : 0,
                timestamp,
                attemptId,
                action.itemId,
              ],
            );
            finalRevision += 1;
            await run("UPDATE practice_attempts SET revision = ? WHERE id = ?", [finalRevision, attemptId]);
          }
        } else {
          const responseId = crypto.randomUUID();
          await run(
            `INSERT INTO practice_responses (
               id, attempt_id, item_id, selected_index, is_dont_know, is_correct, answered_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              responseId,
              attemptId,
              action.itemId,
              action.selectedIndex,
              action.isDontKnow ? 1 : 0,
              isCorrect ? 1 : 0,
              timestamp,
            ],
          );
          finalRevision += 1;
          await run(
            `UPDATE practice_attempts SET revision = ?, answered_count = (SELECT COUNT(*) FROM practice_responses WHERE attempt_id = ?)
             WHERE id = ?`,
            [finalRevision, attemptId, attemptId],
          );
        }

        const [ansCountRow] = await query(
          "SELECT COUNT(*) AS count FROM practice_responses WHERE attempt_id = ?",
          [attemptId],
        );
        const answeredCount = Number(ansCountRow?.["count"] ?? 0);

        resultVal = {
          attemptId,
          itemId: action.itemId,
          answeredCount,
          revision: finalRevision,
          isCorrect,
          answeredAt: finalAnsweredAt,
        } as PracticeRecordResponseResult;
        break;
      }

      case "complete_attempt": {
        attemptId = action.attemptId;
        const [attempt] = await query(
          `SELECT a.version_id, a.started_at, a.revision, a.status, v.history_key
           FROM practice_attempts a
           JOIN practice_test_versions v ON a.version_id = v.id
           WHERE a.id = ?`,
          [attemptId],
        );

        if (!attempt) refuse("NOT_FOUND");
        if (String(attempt["status"]) !== "in_progress") refuse("INVALID_STATE");
        if (Number(attempt["revision"]) !== action.expectedRevision) refuse("INVALID_STATE");

        historyKey = String(attempt["history_key"]);
        const versionId = String(attempt["version_id"]);

        const [totRow] = await query(
          "SELECT COUNT(*) AS count FROM practice_test_items WHERE version_id = ?",
          [versionId],
        );
        const totalQuestions = Number(totRow?.["count"] ?? 0);

        const [ansRow] = await query(
          "SELECT COUNT(*) AS count FROM practice_responses WHERE attempt_id = ?",
          [attemptId],
        );
        const answeredCount = Number(ansRow?.["count"] ?? 0);

        const [corRow] = await query(
          `SELECT COUNT(*) AS count
           FROM practice_responses r
           JOIN practice_test_items i ON r.item_id = i.id
           WHERE r.attempt_id = ?
             AND r.is_dont_know = 0
             AND r.selected_index IS NOT NULL
             AND r.selected_index = i.correct_index`,
          [attemptId],
        );
        const correctCount = Number(corRow?.["count"] ?? 0);

        const [dkRow] = await query(
          "SELECT COUNT(*) AS count FROM practice_responses WHERE attempt_id = ? AND is_dont_know = 1",
          [attemptId],
        );
        const dontKnowCount = Number(dkRow?.["count"] ?? 0);

        const incorrectCount = answeredCount - correctCount - dontKnowCount;
        const unansweredCount = totalQuestions - answeredCount;
        const scorePercent =
          totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 1000) / 10 : 0.0;

        const finalRevision = Number(attempt["revision"]) + 1;

        await run(
          `UPDATE practice_attempts SET
             status = 'completed',
             completed_at = ?,
             revision = ?,
             total_questions = ?,
             answered_count = ?,
             correct_count = ?,
             incorrect_count = ?,
             dont_know_count = ?,
             score_percent = ?
           WHERE id = ?`,
          [
            timestamp,
            finalRevision,
            totalQuestions,
            answeredCount,
            correctCount,
            incorrectCount,
            dontKnowCount,
            scorePercent,
            attemptId,
          ],
        );

        resultVal = {
          attemptId,
          status: "completed",
          startedAt: String(attempt["started_at"]),
          completedAt: timestamp,
          totalQuestions,
          answeredCount,
          revision: finalRevision,
          correctCount,
          incorrectCount,
          dontKnowCount,
          unansweredCount,
          scorePercent,
        } as PracticeCompletedResult;
        break;
      }

      case "abandon_attempt": {
        attemptId = action.attemptId;
        const [attempt] = await query(
          `SELECT a.revision, a.status, v.history_key
           FROM practice_attempts a
           JOIN practice_test_versions v ON a.version_id = v.id
           WHERE a.id = ?`,
          [attemptId],
        );

        if (!attempt) refuse("NOT_FOUND");
        if (String(attempt["status"]) !== "in_progress") refuse("INVALID_STATE");
        if (Number(attempt["revision"]) !== action.expectedRevision) refuse("INVALID_STATE");

        historyKey = String(attempt["history_key"]);
        const finalRevision = Number(attempt["revision"]) + 1;

        await run(
          "UPDATE practice_attempts SET status = 'abandoned', completed_at = ?, revision = ? WHERE id = ?",
          [timestamp, finalRevision, attemptId],
        );

        resultVal = {
          attemptId,
          status: "abandoned",
          revision: finalRevision,
          completedAt: timestamp,
        } as PracticeAbandonResult;
        break;
      }
    }

    // 2. Commit operation receipt
    await run(
      `INSERT INTO practice_session_operations (
         operation_id, action, request_hash, applied_at, result_json, history_key, attempt_id, is_erased
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        operationId,
        actionName,
        currentHash,
        timestamp,
        JSON.stringify(resultVal),
        historyKey,
        attemptId,
      ],
    );

    await exec("COMMIT");
    return resultVal;
  } catch (error) {
    try {
      await exec("ROLLBACK");
    } catch {
      // rollback best effort
    }
    if (error instanceof PracticeSessionError) throw error;
    throw new PracticeSessionError("STORAGE_ERROR", { cause: error });
  }
}

/** Validate legacy questions array. */
export function validateLegacyQuestions(rawJson: string): PracticeQuestion[] | null {
  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_PRACTICE_QUESTIONS) {
      return null;
    }
    const questions: PracticeQuestion[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) return null;
      const q = item as Record<string, unknown>;
      if (typeof q["question"] !== "string") return null;
      const qLen = codePointLength(q["question"]);
      if (qLen === 0 || qLen > MAX_QUESTION_CHARS) return null;

      if (!Array.isArray(q["options"])) return null;
      if (q["options"].length < MIN_OPTIONS || q["options"].length > MAX_OPTIONS) return null;
      for (const opt of q["options"]) {
        if (typeof opt !== "string") return null;
        const optLen = codePointLength(opt);
        if (optLen === 0 || optLen > MAX_OPTION_CHARS) return null;
      }

      if (typeof q["correctIndex"] !== "number" || !Number.isInteger(q["correctIndex"])) return null;
      if (q["correctIndex"] < 0 || q["correctIndex"] >= q["options"].length) return null;

      let explanation = "";
      if (q["explanation"] !== undefined && q["explanation"] !== null) {
        if (typeof q["explanation"] !== "string") return null;
        if (codePointLength(q["explanation"]) > MAX_EXPLANATION_CHARS) return null;
        explanation = q["explanation"];
      }

      let sourcePage: number | null = null;
      if (q["sourcePage"] !== undefined && q["sourcePage"] !== null) {
        if (typeof q["sourcePage"] !== "number" || !Number.isInteger(q["sourcePage"])) return null;
        if (q["sourcePage"] < 1 || q["sourcePage"] > 1_000) return null;
        sourcePage = q["sourcePage"];
      }

      questions.push({
        question: q["question"],
        options: q["options"] as string[],
        correctIndex: q["correctIndex"],
        explanation,
        sourcePage,
      });
    }
    return questions;
  } catch {
    return null;
  }
}

/**
 * Execute legacy conversion inside an owned single-connection transaction.
 *
 * `beforeCommit` runs on the same open transaction after conversion, so it
 * sees the pending state; if it throws, everything rolls back. Driver
 * initialization passes its whole-database validation here, which makes
 * conversion plus validation one atomic step.
 */
export async function executeLegacyConversion(
  exec: (sql: string) => Promise<void> | void,
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  timestamp: string = new Date().toISOString(),
  beforeCommit?: () => Promise<void> | void,
): Promise<number> {
  await exec("BEGIN IMMEDIATE");
  try {
    const rows = await query(
      `SELECT source_material_id, title, questions_json, provider, model, generated_at
       FROM practice_tests
       WHERE legacy_migrated_at IS NULL
         AND legacy_error IS NULL`,
      [],
    );

    let convertedCount = 0;
    for (const row of rows) {
      const materialId = String(row["source_material_id"]);
      const title = String(row["title"]);
      const questionsJson = String(row["questions_json"]);
      const provider = String(row["provider"]);
      const model = String(row["model"]);
      const generatedAt = String(row["generated_at"]);

      const validQuestions = validateLegacyQuestions(questionsJson);
      if (!validQuestions) {
        await run("UPDATE practice_tests SET legacy_error = 'MALFORMED_QUESTION' WHERE source_material_id = ?", [
          materialId,
        ]);
        continue;
      }

      const contentHash = await computeCanonicalHash(validQuestions);

      // Check if version already exists for this material
      const existingVersions = await query(
        "SELECT id, content_hash, is_active FROM practice_test_versions WHERE source_material_id = ?",
        [materialId],
      );

      if (existingVersions.length > 0) {
        const activeVersion = existingVersions.find((v) => Number(v["is_active"]) === 1);
        if (!activeVersion) {
          throw new PracticeSessionError("INVALID_STATE");
        }

        const storedItems = await query(
          `SELECT ordinal, question_text, options_json, correct_index, explanation, source_page
           FROM practice_test_items
           WHERE version_id = ?
           ORDER BY ordinal ASC`,
          [String(activeVersion["id"])],
        );

        const matches =
          String(activeVersion["content_hash"]) === contentHash &&
          storedItems.length === validQuestions.length &&
          storedItems.every((item, i) => {
            const q = validQuestions[i]!;
            return (
              String(item["question_text"]) === q.question &&
              Number(item["correct_index"]) === q.correctIndex &&
              String(item["explanation"]) === q.explanation &&
              (item["source_page"] === null ? null : Number(item["source_page"])) === q.sourcePage &&
              JSON.stringify(JSON.parse(String(item["options_json"]))) === JSON.stringify(q.options)
            );
          });

        if (matches) {
          // Matching version repairs the unset marker without duplicating!
          await run("UPDATE practice_tests SET legacy_migrated_at = ?, legacy_error = NULL WHERE source_material_id = ?", [
            timestamp,
            materialId,
          ]);
          convertedCount++;
          continue;
        } else {
          // Conflicting version: legacy content differs from existing version! Refuse startup!
          throw new PracticeSessionError("INVALID_STATE");
        }
      }

      const [matRow] = await query("SELECT title FROM study_materials WHERE id = ?", [materialId]);
      const materialTitle = matRow ? String(matRow["title"]) : title;

      const versionId = crypto.randomUUID();

      await run(
        `INSERT INTO practice_test_versions (
           id, source_material_id, history_key, source_material_title,
           version_number, provider, model, title, content_hash, created_at, is_active
         ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 1)`,
        [
          versionId,
          materialId,
          materialId,
          materialTitle,
          provider,
          model,
          title,
          contentHash,
          generatedAt,
        ],
      );

      for (let i = 0; i < validQuestions.length; i++) {
        const q = validQuestions[i]!;
        const itemId = crypto.randomUUID();
        await run(
          `INSERT INTO practice_test_items (
             id, version_id, ordinal, question_text, options_json,
             correct_index, explanation, source_page
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            itemId,
            versionId,
            i,
            q.question,
            JSON.stringify(q.options),
            q.correctIndex,
            q.explanation,
            q.sourcePage,
          ],
        );
      }

      await run(
        "UPDATE practice_tests SET legacy_migrated_at = ?, legacy_error = NULL WHERE source_material_id = ?",
        [timestamp, materialId],
      );
      convertedCount++;
    }

    await beforeCommit?.();
    await exec("COMMIT");
    return convertedCount;
  } catch (error) {
    try {
      await exec("ROLLBACK");
    } catch {
      // rollback best effort
    }
    throw error;
  }
}

/** Execute save/regeneration of practice test inside an owned transaction. */
export async function executeSavePracticeTest(
  exec: (sql: string) => Promise<void> | void,
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  operation: { sourceMaterialId: string; title: string; questions: PracticeQuestion[]; model: string },
  timestamp: string = new Date().toISOString(),
): Promise<void> {
  const { sourceMaterialId, title, questions, model } = operation;
  const questionsJson = JSON.stringify(questions);
  const valid = validateLegacyQuestions(questionsJson);
  if (!valid) refuse("INVALID_ARGUMENT");

  await exec("BEGIN IMMEDIATE");
  try {
    // 1. Deactivate existing active version
    await run("UPDATE practice_test_versions SET is_active = 0 WHERE source_material_id = ? AND is_active = 1", [
      sourceMaterialId,
    ]);

    // 2. Abandon old in_progress attempt
    await run(
      "UPDATE practice_attempts SET status = 'abandoned', completed_at = ?, revision = revision + 1 WHERE source_material_id = ? AND status = 'in_progress'",
      [timestamp, sourceMaterialId],
    );

    // 3. Version number
    const [verRow] = await query(
      "SELECT COALESCE(MAX(version_number), 0) + 1 AS next_ver FROM practice_test_versions WHERE source_material_id = ?",
      [sourceMaterialId],
    );
    const nextVer = Number(verRow?.["next_ver"] ?? 1);

    const [matRow] = await query("SELECT title FROM study_materials WHERE id = ?", [sourceMaterialId]);
    const materialTitle = matRow ? String(matRow["title"]) : title;

    const versionId = crypto.randomUUID();
    const contentHash = await computeCanonicalHash(valid);

    // 4. Insert new version
    await run(
      `INSERT INTO practice_test_versions (
         id, source_material_id, history_key, source_material_title,
         version_number, provider, model, title, content_hash, created_at, is_active
       ) VALUES (?, ?, ?, ?, ?, 'gemini', ?, ?, ?, ?, 1)`,
      [
        versionId,
        sourceMaterialId,
        sourceMaterialId,
        materialTitle,
        nextVer,
        model,
        title,
        contentHash,
        timestamp,
      ],
    );

    // 5. Insert items
    for (let i = 0; i < valid.length; i++) {
      const q = valid[i]!;
      const itemId = crypto.randomUUID();
      await run(
        `INSERT INTO practice_test_items (
           id, version_id, ordinal, question_text, options_json,
           correct_index, explanation, source_page
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          itemId,
          versionId,
          i,
          q.question,
          JSON.stringify(q.options),
          q.correctIndex,
          q.explanation,
          q.sourcePage,
        ],
      );
    }

    // 6. Upsert practice_tests
    await run(
      `INSERT INTO practice_tests (
         source_material_id, title, questions_json, provider, model, generated_at, updated_at, legacy_migrated_at, legacy_error
       ) VALUES (?, ?, ?, 'gemini', ?, ?, ?, ?, NULL)
       ON CONFLICT(source_material_id) DO UPDATE SET
         title = excluded.title,
         questions_json = excluded.questions_json,
         provider = excluded.provider,
         model = excluded.model,
         generated_at = excluded.generated_at,
         updated_at = excluded.updated_at,
         legacy_migrated_at = excluded.legacy_migrated_at,
         legacy_error = NULL`,
      [sourceMaterialId, title, questionsJson, model, timestamp, timestamp, timestamp],
    );

    await exec("COMMIT");
  } catch (error) {
    try {
      await exec("ROLLBACK");
    } catch {
      // rollback best effort
    }
    if (error instanceof PracticeSessionError) throw error;
    throw new PracticeSessionError("STORAGE_ERROR", { cause: error });
  }
}

/** Execute remove practice test inside an owned transaction. */
export async function executeRemovePracticeTest(
  exec: (sql: string) => Promise<void> | void,
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  _query: Query,
  sourceMaterialId: string,
): Promise<void> {
  await exec("BEGIN IMMEDIATE");
  try {
    // 1. Deactivate active version
    await run("UPDATE practice_test_versions SET is_active = 0 WHERE source_material_id = ? AND is_active = 1", [
      sourceMaterialId,
    ]);

    // 2. Tombstone operations for in_progress/abandoned attempts
    await run(
      `UPDATE practice_session_operations SET is_erased = 1, result_json = 'null'
       WHERE attempt_id IN (
           SELECT id FROM practice_attempts WHERE source_material_id = ? AND status IN ('in_progress', 'abandoned')
       )`,
      [sourceMaterialId],
    );

    // 3. Delete in_progress and abandoned attempts
    await run(
      "DELETE FROM practice_attempts WHERE source_material_id = ? AND status IN ('in_progress', 'abandoned')",
      [sourceMaterialId],
    );

    // 4. Prune versions with 0 completed attempts
    await run(
      `DELETE FROM practice_test_versions
       WHERE source_material_id = ?
         AND id NOT IN (SELECT DISTINCT version_id FROM practice_attempts WHERE status = 'completed')`,
      [sourceMaterialId],
    );

    // 5. Delete legacy row
    await run("DELETE FROM practice_tests WHERE source_material_id = ?", [sourceMaterialId]);

    await exec("COMMIT");
  } catch (error) {
    try {
      await exec("ROLLBACK");
    } catch {
      // rollback best effort
    }
    if (error instanceof PracticeSessionError) throw error;
    throw new PracticeSessionError("STORAGE_ERROR", { cause: error });
  }
}

/** Strictly validate and decode incoming erase history request. */
export function decodeEraseHistoryAction(value: unknown): EraseHistoryAction {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    refuse("INVALID_ARGUMENT");
  }
  const jsonStr = JSON.stringify(value);
  if (jsonStr.length > MAX_PAYLOAD_BYTES) refuse("INVALID_ARGUMENT");

  exactObject(value, ["action", "operationId", "historyKey"]);
  const obj = value as Record<string, unknown>;
  const action = stringAt(obj, "action");
  if (action !== "erase_history") refuse("INVALID_ARGUMENT");
  const operationId = stringAt(obj, "operationId");
  if (!isUuidV4(operationId)) refuse("INVALID_ARGUMENT");
  const historyKey = stringAt(obj, "historyKey");
  if (!isValidId(historyKey)) refuse("INVALID_ARGUMENT");

  return { action: "erase_history", operationId, historyKey };
}

/** Single-connection atomic transaction for erasing history for a history key (M2 PR 2). */
export async function executeEraseHistoryAction(
  exec: (sql: string) => Promise<void> | void,
  run: (sql: string, params: SqlValue[]) => Promise<void> | void,
  query: Query,
  actionInput: unknown,
  timestamp: string = new Date().toISOString(),
): Promise<EraseHistoryResult> {
  const action = decodeEraseHistoryAction(actionInput);
  const currentHash = await computeCanonicalHash(actionInput);
  const operationId = action.operationId;
  const historyKey = action.historyKey;

  await exec("BEGIN IMMEDIATE");
  try {
    // 1. Inspect practice_session_operations for replay or conflict
    const [receipt] = await query(
      "SELECT request_hash, result_json, is_erased FROM practice_session_operations WHERE operation_id = ?",
      [operationId],
    );

    if (receipt) {
      if (receipt["request_hash"] !== currentHash) {
        refuse("OPERATION_CONFLICT");
      }
      if (Number(receipt["is_erased"]) === 1) {
        refuse("INVALID_STATE");
      }
      await exec("COMMIT");
      return JSON.parse(String(receipt["result_json"])) as EraseHistoryResult;
    }

    // 2. Turn associated receipts into non-content tombstones sufficient to refuse old replay
    await run(
      "UPDATE practice_session_operations SET is_erased = 1, result_json = 'null' WHERE history_key = ?",
      [historyKey],
    );

    // 3. Remove saved attempts/responses (including unfinished progress under that key)
    await run(
      "DELETE FROM practice_attempts WHERE version_id IN (SELECT id FROM practice_test_versions WHERE history_key = ?)",
      [historyKey],
    );

    // 4. Remove unused inactive versions/items under that key
    await run(
      "DELETE FROM practice_test_versions WHERE history_key = ? AND is_active = 0",
      [historyKey],
    );

    // 5. Store erasure receipt
    const resultObj: EraseHistoryResult = {
      action: "erase_history",
      historyKey,
      erased: true,
    };
    const resultJson = JSON.stringify(resultObj);

    await run(
      `INSERT INTO practice_session_operations (
         operation_id, action, request_hash, applied_at, result_json, history_key, attempt_id, is_erased
       ) VALUES (?, 'erase_history', ?, ?, ?, ?, ?, 0)`,
      [operationId, currentHash, timestamp, resultJson, historyKey, historyKey],
    );

    await exec("COMMIT");
    return resultObj;
  } catch (error) {
    try {
      await exec("ROLLBACK");
    } catch {
      // rollback best effort
    }
    if (error instanceof PracticeSessionError) throw error;
    throw new PracticeSessionError("STORAGE_ERROR", { cause: error });
  }
}
