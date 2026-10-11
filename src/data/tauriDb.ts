/**
 * SQLite through Tauri's SQL plugin — the real desktop database.
 *
 * The file lives in the application data directory chosen by Tauri, never
 * inside the project, so private training data is never near the repository.
 */
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import type {
  PracticeSessionAction,
  PracticeSessionActionResult,
  SplitBatchCancelResult,
  SplitBatchReconciliation,
  SplitBatchSaveResult,
  SplitPartPresentation,
  SplitSourceReceipt,
  StoredDocumentFingerprint,
  StudyMaterial,
} from "@/domain/types";

import {
  isFingerprintList,
  isSplitBatchCancelResult,
  isSplitBatchReconciliation,
  isSplitBatchSaveResult,
  SplitResultShapeError,
} from "./splitLineageShapes";
import {
  toNumberedPlaceholders,
  type NativeImportSaveResult,
  type PracticeTestSaveOperation,
  type SqlDatabase,
  type SqlValue,
  type StructuredImportSaveOperation,
} from "./db";
import {
  CARD_LIBRARY_ERROR_MESSAGES,
  CardLibraryReadError,
  type CardLibraryErrorCode,
} from "@/logic/cardLibrary";
import {
  CARD_REVIEW_ERROR_MESSAGES,
  CardReviewError,
  IMPORT_SAVE_MESSAGES,
  isImportSaveErrorCode,
  isNativeCardReviewErrorCode,
  isPracticeSessionErrorCode,
  PRACTICE_SESSION_ERROR_MESSAGES,
  PracticeSessionError,
  StructuredImportSaveError,
} from "./persistenceErrors";
import {
  invokeListSkills,
  invokeReadObservationHistory,
  invokeReadSkillEvidencePage,
  invokeReadSkillSummary,
  invokeSkillEvidenceAction,
} from "./skillEvidenceShapes";

const DB_URL = "sqlite:her-flight-deck.db";

/**
 * Invoke the native structured-import save and accept only its allowlisted
 * outcomes. A refusal is recognized only when it is exactly one native code
 * with its fixed message; anything else (an outer invoke failure, a rejected
 * envelope, an unexpected result) becomes `IPC_TRANSPORT_ERROR` and is never
 * shown raw.
 */
export async function invokeStructuredImportSave(
  operation: StructuredImportSaveOperation,
  call: typeof invoke = invoke,
): Promise<NativeImportSaveResult> {
  let result: unknown;
  try {
    result = await call("save_structured_study_material_atomically", { operation });
  } catch (rejection) {
    const { code, message } = (rejection ?? {}) as { code?: unknown; message?: unknown };
    if (
      isImportSaveErrorCode(code) &&
      code !== "IPC_TRANSPORT_ERROR" &&
      message === IMPORT_SAVE_MESSAGES[code]
    ) {
      throw new StructuredImportSaveError(code);
    }
    throw new StructuredImportSaveError("IPC_TRANSPORT_ERROR", { cause: rejection });
  }
  const { status, materialId } = (result ?? {}) as { status?: unknown; materialId?: unknown };
  if ((status === "saved" || status === "already_saved") && materialId === operation.materialId) {
    return { status, materialId };
  }
  throw new StructuredImportSaveError("IPC_TRANSPORT_ERROR");
}

/**
 * Invoke the native practice session save and accept only its allowlisted
 * outcomes.
 */
export async function invokePracticeSessionSave(
  action: PracticeSessionAction,
  call: typeof invoke = invoke,
): Promise<PracticeSessionActionResult> {
  let result: unknown;
  try {
    result = await call("save_practice_session_atomically", { action });
  } catch (rejection) {
    const { code, message } = (rejection ?? {}) as { code?: unknown; message?: unknown };
    if (
      isPracticeSessionErrorCode(code) &&
      code !== "IPC_TRANSPORT_ERROR" &&
      message === PRACTICE_SESSION_ERROR_MESSAGES[code]
    ) {
      throw new PracticeSessionError(code);
    }
    throw new PracticeSessionError("IPC_TRANSPORT_ERROR", { cause: rejection });
  }
  return validatePracticeActionResult(action, result);
}

function validatePracticeActionResult(
  action: PracticeSessionAction,
  result: unknown,
): PracticeSessionActionResult {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
  }
  const r = result as Record<string, unknown>;
  if (typeof r.attemptId !== "string" || !r.attemptId.trim()) {
    throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
  }
  const rev = r.revision ?? r.currentRevision;
  if (
    typeof rev !== "number" ||
    !Number.isInteger(rev) ||
    rev < 0
  ) {
    throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
  }

  switch (action.action) {
    case "start_or_resume":
    case "retake_attempt":
      if (typeof r.versionId !== "string" || !r.versionId.trim()) {
        throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
      }
      if (r.status !== "in_progress") {
        throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
      }
      if (
        typeof r.totalQuestions !== "number" ||
        typeof r.answeredCount !== "number"
      ) {
        throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
      }
      break;

    case "record_response":
      if (typeof r.itemId !== "string" || !r.itemId.trim()) {
        throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
      }
      if (typeof r.answeredCount !== "number") {
        throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
      }
      if (typeof r.isCorrect !== "boolean") {
        throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
      }
      if (typeof r.answeredAt !== "string" || !r.answeredAt.trim()) {
        throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
      }
      break;

    case "complete_attempt":
      if (r.status !== "completed") {
        throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
      }
      if (typeof r.completedAt !== "string" || !r.completedAt.trim()) {
        throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
      }
      if (typeof r.scorePercent !== "number" || Number.isNaN(r.scorePercent)) {
        throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
      }
      if (
        typeof r.correctCount !== "number" ||
        typeof r.incorrectCount !== "number" ||
        typeof r.dontKnowCount !== "number" ||
        typeof r.unansweredCount !== "number" ||
        typeof r.totalQuestions !== "number"
      ) {
        throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
      }
      break;

    case "abandon_attempt":
      if (r.status !== "abandoned") {
        throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
      }
      if (typeof r.completedAt !== "string" || !r.completedAt.trim()) {
        throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
      }
      break;

    default:
      throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
  }

  return result as PracticeSessionActionResult;
}

/**
 * Invoke the native practice test save/regeneration.
 * Unit return contract: awaits native completion without wire result object.
 */
export async function invokePracticeTestSave(
  operation: PracticeTestSaveOperation,
  call: typeof invoke = invoke,
): Promise<void> {
  try {
    await call("save_practice_test_atomically", { operation });
  } catch (rejection) {
    const { code, message } = (rejection ?? {}) as { code?: unknown; message?: unknown };
    if (
      isPracticeSessionErrorCode(code) &&
      code !== "IPC_TRANSPORT_ERROR" &&
      message === PRACTICE_SESSION_ERROR_MESSAGES[code]
    ) {
      throw new PracticeSessionError(code);
    }
    throw new PracticeSessionError("IPC_TRANSPORT_ERROR", { cause: rejection });
  }
}

/**
 * Invoke the native practice test removal.
 */
export async function invokeRemovePracticeTest(
  sourceMaterialId: string,
  call: typeof invoke = invoke,
): Promise<void> {
  try {
    await call("remove_practice_test_atomically", { sourceMaterialId });
  } catch (rejection) {
    const { code, message } = (rejection ?? {}) as { code?: unknown; message?: unknown };
    if (
      isPracticeSessionErrorCode(code) &&
      code !== "IPC_TRANSPORT_ERROR" &&
      message === PRACTICE_SESSION_ERROR_MESSAGES[code]
    ) {
      throw new PracticeSessionError(code);
    }
    throw new PracticeSessionError("IPC_TRANSPORT_ERROR", { cause: rejection });
  }
}

/**
 * Invoke native practice history erasure.
 */
export async function invokeErasePracticeHistory(
  action: import("@/domain/types").EraseHistoryAction,
  call: typeof invoke = invoke,
): Promise<import("@/domain/types").EraseHistoryResult> {
  try {
    const raw = await call("erase_practice_history_atomically", { action });
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
    }
    const r = raw as Record<string, unknown>;
    if (r.action !== "erase_history" || typeof r.historyKey !== "string" || typeof r.erased !== "boolean") {
      throw new PracticeSessionError("IPC_TRANSPORT_ERROR");
    }
    return raw as import("@/domain/types").EraseHistoryResult;
  } catch (rejection) {
    if (rejection instanceof PracticeSessionError) throw rejection;
    const { code, message } = (rejection ?? {}) as { code?: unknown; message?: unknown };
    if (
      isPracticeSessionErrorCode(code) &&
      code !== "IPC_TRANSPORT_ERROR" &&
      message === PRACTICE_SESSION_ERROR_MESSAGES[code]
    ) {
      throw new PracticeSessionError(code);
    }
    throw new PracticeSessionError("IPC_TRANSPORT_ERROR", { cause: rejection });
  }
}

/**
 * Invoke the native card-review save and accept only its allowlisted
 * outcomes: exactly one native code with its fixed message, or a result whose
 * shape matches the action sent. Anything else becomes `IPC_TRANSPORT_ERROR`
 * and is never shown raw.
 */
export async function invokeCardReviewSave(
  action: import("@/domain/types").CardReviewAction,
  call: typeof invoke = invoke,
): Promise<import("@/domain/types").CardReviewResult> {
  let result: unknown;
  try {
    result = await call("save_card_review_atomically", { operation: action });
  } catch (rejection) {
    const { code, message } = (rejection ?? {}) as { code?: unknown; message?: unknown };
    if (isNativeCardReviewErrorCode(code) && message === CARD_REVIEW_ERROR_MESSAGES[code]) {
      throw new CardReviewError(code);
    }
    throw new CardReviewError("IPC_TRANSPORT_ERROR", { cause: rejection });
  }
  if (!isCardReviewResultFor(action, result)) throw new CardReviewError("IPC_TRANSPORT_ERROR");
  return result;
}

const isNullableText = (value: unknown) => value === null || typeof value === "string";
const isCount = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0;

function isCardReviewResultFor(
  action: import("@/domain/types").CardReviewAction,
  value: unknown,
): value is import("@/domain/types").CardReviewResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  if (action.action === "reset") {
    return (
      Object.keys(r).length === 3 &&
      r.action === "reset" &&
      r.materialId === action.materialId &&
      isCount(r.generation)
    );
  }
  return (
    Object.keys(r).length === 8 &&
    r.action === action.action &&
    r.itemId === action.itemId &&
    isCount(r.generation) &&
    isCount(r.revision) &&
    isNullableText(r.dueAt) &&
    isNullableText(r.reviewedAt) &&
    typeof r.suspended === "boolean" &&
    (r.flag === null || r.flag === "wrong_answer" || r.flag === "unclear" || r.flag === "not_in_source")
  );
}

/**
 * Invoke a native library-wide card review read (M2-4 / C2) and accept only
 * allowlisted outcomes: exactly one native code with its fixed message, or a
 * result of the expected shape. Anything else becomes IPC_TRANSPORT_ERROR.
 */
export async function invokeCardLibraryRead<T>(
  command: "get_library_review_due" | "get_library_recent_reviews",
  input: unknown,
  isShape: (value: unknown) => value is T,
  call: typeof invoke = invoke,
): Promise<T> {
  let result: unknown;
  try {
    result = await call(command, { input });
  } catch (rejection) {
    const { code, message } = (rejection ?? {}) as { code?: unknown; message?: unknown };
    if (isNativeCardLibraryErrorCode(code) && message === CARD_LIBRARY_ERROR_MESSAGES[code]) {
      throw new CardLibraryReadError(code);
    }
    throw new CardLibraryReadError("IPC_TRANSPORT_ERROR", { cause: rejection });
  }
  if (!isShape(result)) throw new CardLibraryReadError("IPC_TRANSPORT_ERROR");
  return result;
}

const NATIVE_CARD_LIBRARY_CODES: readonly CardLibraryErrorCode[] = [
  "INVALID_TIME",
  "INVALID_FILTER",
  "INVALID_INPUT",
  "INVALID_CURSOR",
  "STALE_CURSOR",
  "INVALID_TARGET",
  "NOT_READY",
  "STORAGE_ERROR",
];

function isNativeCardLibraryErrorCode(value: unknown): value is CardLibraryErrorCode {
  return typeof value === "string" && (NATIVE_CARD_LIBRARY_CODES as readonly string[]).includes(value);
}

/* ------------------------- split lineage (M2) ------------------------- */

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
const callNative: Invoke = (command, args) => invoke(command, args);

/** Save a recorded split's parts; the receipt goes back exactly as issued. */
export async function invokeSaveSplitBatch(
  receipt: SplitSourceReceipt,
  presentation: SplitPartPresentation[],
  call: Invoke = callNative,
): Promise<SplitBatchSaveResult> {
  const result = await call("save_split_batch", { receipt, presentation });
  if (!isSplitBatchSaveResult(result)) throw new SplitResultShapeError("save_split_batch");
  return result;
}

export async function invokeCancelSplitBatch(
  operationId: string,
  call: Invoke = callNative,
): Promise<SplitBatchCancelResult> {
  const result = await call("cancel_split_batch", { operationId });
  if (!isSplitBatchCancelResult(result)) throw new SplitResultShapeError("cancel_split_batch");
  return result;
}

export async function invokeReconcileSplitBatch(
  operationId: string,
  call: Invoke = callNative,
): Promise<SplitBatchReconciliation> {
  const result = await call("reconcile_split_batch", { operationId });
  if (!isSplitBatchReconciliation(result)) throw new SplitResultShapeError("reconcile_split_batch");
  return result;
}

export async function invokeFingerprintStoredDocuments(
  relativePaths: string[],
  call: Invoke = callNative,
): Promise<StoredDocumentFingerprint[]> {
  const result = await call("fingerprint_stored_documents", { relativePaths });
  if (!isFingerprintList(result, relativePaths)) {
    throw new SplitResultShapeError("fingerprint_stored_documents");
  }
  return result;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function isLibraryReviewDueResult(value: unknown): value is import("@/domain/types").LibraryReviewDueResult {
  return (
    isRecord(value) &&
    Array.isArray(value.materials) &&
    Array.isArray(value.issues) &&
    (value.nextCursor === null || typeof value.nextCursor === "string") &&
    isRecord(value.summary) &&
    value.summary.isPageLocal === true &&
    typeof value.summary.isComplete === "boolean" &&
    value.materials.every((m) => isRecord(m) && typeof m.materialId === "string" && typeof m.newCount === "number")
  );
}

export function isLibraryRecentReviewsResult(value: unknown): value is import("@/domain/types").LibraryRecentReviewsResult {
  return (
    isRecord(value) &&
    Array.isArray(value.rows) &&
    Array.isArray(value.pendingMaterialIds) &&
    (value.next === null || typeof value.next === "string") &&
    (value.enrichment === null || Array.isArray(value.enrichment)) &&
    isRecord(value.summary) &&
    value.summary.isPageLocal === true &&
    value.rows.every((r) => isRecord(r) && typeof r.id === "string" && typeof r.materialId === "string")
  );
}

export async function createTauriDatabase(): Promise<SqlDatabase> {
  // Migrations were registered in Rust and run as part of this load().
  const db = await Database.load(DB_URL);

  // Foreign keys are off by default in SQLite and must be enabled per
  // connection, otherwise our ON DELETE rules silently do nothing.
  await db.execute("PRAGMA foreign_keys = ON");

  // The Rust SQL plugin opens a small pool of connections to this one file.
  // Without WAL, any write holds a lock that blocks *every* reader too, so a
  // slow write (a multi-part PDF split saving its records, a backup snapshot
  // reading it) and an unrelated autosave can collide as "database is locked"
  // even though neither is doing anything wrong. WAL lets readers proceed
  // alongside a single writer, which is what actually removes that
  // contention — it is a property of the database file itself, not of this
  // one connection, so setting it once here is enough for the whole pool and
  // for every future launch. `busy_timeout` is *not* set here: it is
  // per-connection, so doing it through one pooled connection would not
  // reach the others — sqlx's own default of five seconds already applies to
  // every connection the pool opens (see `SqliteConnectOptions::default()`),
  // and `documentRepository.createMany`'s retry exists for the case where
  // even that is not enough.
  //
  // Best-effort: a database still on the old journal mode elsewhere (another
  // running instance, an unusual filesystem) should not stop this one from
  // starting.
  try {
    // `journal_mode` is a query, not a plain statement — it hands back the
    // mode it ended up in, even when setting it — so this goes through
    // `select`, the same way `wal_checkpoint` already does elsewhere.
    await db.select("PRAGMA journal_mode = WAL");
  } catch {
    // Nothing to do — the database still works, just with more contention.
  }

  // Run legacy practice test conversion after migrations and before session repositories become ready.
  await invoke("run_practice_legacy_conversion");

  return {
    async saveMaterialsAtomically(materials: StudyMaterial[]): Promise<void> {
      await invoke("save_split_materials", { materials });
    },
    saveSplitBatch: (receipt, presentation) => invokeSaveSplitBatch(receipt, presentation),
    cancelSplitBatch: (operationId) => invokeCancelSplitBatch(operationId),
    reconcileSplitBatch: (operationId) => invokeReconcileSplitBatch(operationId),
    fingerprintStoredDocuments: (relativePaths) => invokeFingerprintStoredDocuments(relativePaths),
    async saveDebriefAtomically(operation: import("./db").DebriefSaveOperation): Promise<void> {
      await invoke("save_debrief_operation", { operation });
    },
    async saveMaterialAtomically(
      operation: import("./db").MaterialSaveOperation,
    ): Promise<StudyMaterial> {
      return invoke<StudyMaterial>("save_material_operation", { operation });
    },
    saveStructuredImportAtomically(
      operation: StructuredImportSaveOperation,
    ): Promise<NativeImportSaveResult> {
      return invokeStructuredImportSave(operation);
    },
    savePracticeSessionAtomically(
      action: PracticeSessionAction,
    ): Promise<PracticeSessionActionResult> {
      return invokePracticeSessionSave(action);
    },
    savePracticeTestAtomically(
      operation: PracticeTestSaveOperation,
    ): Promise<void> {
      return invokePracticeTestSave(operation);
    },
    removePracticeTestAtomically(
      sourceMaterialId: string,
    ): Promise<void> {
      return invokeRemovePracticeTest(sourceMaterialId);
    },
    erasePracticeHistoryAtomically(
      action: import("@/domain/types").EraseHistoryAction,
    ): Promise<import("@/domain/types").EraseHistoryResult> {
      return invokeErasePracticeHistory(action);
    },
    saveCardReviewAtomically(
      action: import("@/domain/types").CardReviewAction,
    ): Promise<import("@/domain/types").CardReviewResult> {
      return invokeCardReviewSave(action);
    },
    readLibraryReviewDue(
      input: import("@/domain/types").LibraryReviewDueInput,
    ): Promise<import("@/domain/types").LibraryReviewDueResult> {
      return invokeCardLibraryRead("get_library_review_due", input, isLibraryReviewDueResult);
    },
    readLibraryRecentReviews(
      input: import("@/domain/types").LibraryRecentReviewsInput,
    ): Promise<import("@/domain/types").LibraryRecentReviewsResult> {
      return invokeCardLibraryRead("get_library_recent_reviews", input, isLibraryRecentReviewsResult);
    },
    saveSkillEvidenceAtomically: (action) => invokeSkillEvidenceAction(action, callNative),
    readSkillEvidencePage: (input) => invokeReadSkillEvidencePage(input, callNative),
    readSkillSummary: (skillId) => invokeReadSkillSummary(skillId, callNative),
    listSkills: (options) => invokeListSkills(options, callNative),
    readObservationHistory: (input) => invokeReadObservationHistory(input, callNative),
    async select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return db.select<T[]>(toNumberedPlaceholders(sql), params);
    },
    async execute(sql: string, params: SqlValue[] = []): Promise<void> {
      await db.execute(toNumberedPlaceholders(sql), params);
    },
  };
}
