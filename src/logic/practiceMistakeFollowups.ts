/**
 * Pure helper selecting bounded historical mistake follow-ups for a completed
 * practice attempt.
 *
 * MISTAKES-01a / DIFF03-A,E:
 * - Single explicit contract taking an input object.
 * - Selects first N missed/skipped questions in frozen ordinal order (default 3, max 5).
 * - Distinguishes incorrect, dont_know, and unanswered; excludes correct.
 * - Valid integer 0 opts out; >5 clamps to 5; invalid limits fail closed as unavailable.
 * - Discriminated union result: available vs unavailable with strict snake_case reasons.
 * - Collision-safe candidate IDs using unambiguous array serialization.
 * - Deeply immutable: returns fresh copies of items and responses; never mutates inputs.
 * - Pure historical review suggestions: never a new scored response, completion,
 *   mastery, readiness, or minute estimate.
 */

import type {
  PracticeAttempt,
  PracticeResponse,
  PracticeTestItem,
  PracticeTestVersion,
} from "@/domain/types";
import {
  attemptReviewPath,
  buildAttemptReview,
} from "./practiceAttemptReview";

export const DEFAULT_MISTAKE_FOLLOWUPS_LIMIT = 3;
export const MAX_MISTAKE_FOLLOWUPS_LIMIT = 5;

export type PracticeMistakeFollowupOutcome = "incorrect" | "dont_know" | "unanswered";

export interface PracticeMistakeFollowupCandidate {
  readonly id: string;
  readonly number: number;
  readonly outcome: PracticeMistakeFollowupOutcome;
  readonly item: PracticeTestItem;
  readonly response: PracticeResponse | null;
}

export type PracticeMistakeFollowupsUnavailableReason =
  | "invalid_limit"
  | "attempt_unavailable"
  | "version_unavailable"
  | "version_mismatch"
  | "items_unavailable"
  | "responses_unavailable";

export interface PracticeMistakeFollowupsUnavailableResult {
  readonly status: "unavailable";
  readonly reason: PracticeMistakeFollowupsUnavailableReason;
  readonly suggestions: [];
}

export interface PracticeMistakeFollowupsAvailableResult {
  readonly status: "available";
  readonly attemptId: string;
  readonly versionId: string;
  readonly sourceMaterialId: string | null;
  readonly sourceMaterialTitle: string;
  readonly fullMissedReviewPath: string;
  readonly suggestions: PracticeMistakeFollowupCandidate[];
  readonly totalEligibleCount: number;
  readonly remainingCount: number;
}

export type PracticeMistakeFollowupsResult =
  | PracticeMistakeFollowupsAvailableResult
  | PracticeMistakeFollowupsUnavailableResult;

export interface PracticeMistakeFollowupsInput {
  readonly attempt?: PracticeAttempt | null;
  readonly version?: PracticeTestVersion | null;
  readonly items?: readonly PracticeTestItem[] | null;
  readonly responses?: readonly PracticeResponse[] | null;
  readonly limit?: number;
}

function unavailable(
  reason: PracticeMistakeFollowupsUnavailableReason,
): PracticeMistakeFollowupsUnavailableResult {
  return {
    status: "unavailable",
    reason,
    suggestions: [],
  };
}

export function selectPracticeMistakeFollowups(
  input: PracticeMistakeFollowupsInput,
): PracticeMistakeFollowupsResult {
  // 1. Limit validation: negative/fractional/NaN/Infinity fails closed as unavailable.
  let effectiveLimit = DEFAULT_MISTAKE_FOLLOWUPS_LIMIT;
  if (input?.limit !== undefined) {
    const limit = input.limit;
    if (
      typeof limit !== "number" ||
      !Number.isFinite(limit) ||
      Number.isNaN(limit) ||
      !Number.isInteger(limit) ||
      limit < 0
    ) {
      return unavailable("invalid_limit");
    }
    if (limit === 0) {
      effectiveLimit = 0;
    } else if (limit > MAX_MISTAKE_FOLLOWUPS_LIMIT) {
      effectiveLimit = MAX_MISTAKE_FOLLOWUPS_LIMIT;
    } else {
      effectiveLimit = limit;
    }
  }

  // 2. Attempt validation
  const attempt = input?.attempt;
  if (
    !attempt ||
    typeof attempt !== "object" ||
    typeof attempt.id !== "string" ||
    attempt.id.length === 0 ||
    attempt.status !== "completed" ||
    typeof attempt.completedAt !== "string" ||
    attempt.completedAt.length === 0 ||
    typeof attempt.totalQuestions !== "number" ||
    !Number.isSafeInteger(attempt.totalQuestions) ||
    attempt.totalQuestions < 0 ||
    typeof attempt.versionId !== "string" ||
    attempt.versionId.length === 0
  ) {
    return unavailable("attempt_unavailable");
  }

  // 3. Version validation
  const version = input?.version;
  if (
    !version ||
    typeof version !== "object" ||
    typeof version.id !== "string" ||
    version.id.length === 0 ||
    typeof version.historyKey !== "string" ||
    version.historyKey.length === 0 ||
    typeof version.sourceMaterialTitle !== "string"
  ) {
    return unavailable("version_unavailable");
  }

  // 4. Exact matching version
  if (attempt.versionId !== version.id) {
    return unavailable("version_mismatch");
  }

  // 5. Items validation
  const items = input?.items;
  if (!Array.isArray(items) || items.length !== attempt.totalQuestions) {
    return unavailable("items_unavailable");
  }

  const seenIds = new Set<string>();
  const seenOrdinals = new Set<number>();
  for (const item of items) {
    if (
      !item ||
      typeof item !== "object" ||
      item.versionId !== version.id ||
      typeof item.id !== "string" ||
      item.id.length === 0 ||
      seenIds.has(item.id) ||
      typeof item.ordinal !== "number" ||
      !Number.isSafeInteger(item.ordinal) ||
      item.ordinal < 0 ||
      item.ordinal >= items.length ||
      seenOrdinals.has(item.ordinal)
    ) {
      return unavailable("items_unavailable");
    }
    seenIds.add(item.id);
    seenOrdinals.add(item.ordinal);
  }

  // 6. Responses validation
  const responses = input?.responses;
  if (!Array.isArray(responses)) {
    return unavailable("responses_unavailable");
  }

  // 7. Build attempt review (handles foreign responses, classifications, sorting by ordinal)
  const entries = buildAttemptReview(attempt.id, items, responses);

  // 8. Filter missed/skipped (keeps incorrect, dont_know, unanswered distinct; excludes correct)
  const missedEntries = entries.filter(
    (e): e is typeof e & { outcome: PracticeMistakeFollowupOutcome } =>
      e.outcome !== "correct",
  );
  const totalEligibleCount = missedEntries.length;

  const selectedEntries = missedEntries.slice(0, effectiveLimit);
  const remainingCount = totalEligibleCount - selectedEntries.length;

  // 9. Build fresh isolated candidates with collision-safe IDs
  const suggestions: PracticeMistakeFollowupCandidate[] = selectedEntries.map((entry) => ({
    id: JSON.stringify([attempt.id, version.id, entry.item.id]),
    number: entry.number,
    outcome: entry.outcome,
    item: structuredClone(entry.item),
    response: entry.response ? structuredClone(entry.response) : null,
  }));

  return {
    status: "available",
    attemptId: attempt.id,
    versionId: version.id,
    sourceMaterialId: version.sourceMaterialId ?? null,
    sourceMaterialTitle: version.sourceMaterialTitle,
    fullMissedReviewPath: attemptReviewPath(version.historyKey, attempt.id, "missed"),
    suggestions,
    totalEligibleCount,
    remainingCount,
  };
}
