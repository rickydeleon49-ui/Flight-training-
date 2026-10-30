/**
 * One quiet "how are my practice tests going" line for Today's Flight Plan.
 *
 * Built only from her own completed practice attempts. It is an average of
 * her recent practice scores, never a pass/fail prediction or an official
 * score. Inputs are read only.
 */
import type { IsoDate, PracticeAttempt } from "@/domain/types";
import { addDays, localDayOf } from "@/lib/dates";

/** Attempts in the window needed before a summary is shown. */
export const MIN_RECENT_ATTEMPTS = 3;
/** Attempts in each group that is averaged. */
export const GROUP_SIZE = 5;
/** Days, including today, that count as recent. */
export const WINDOW_DAYS = 30;
/** Enough rows for both groups; callers read at most this many attempts. */
export const ATTEMPTS_TO_READ = GROUP_SIZE * 2 + 40;

export type PracticeTrend = "up" | "down" | "steady";

export type PracticeReadiness =
  | {
      kind: "summary";
      /** Rounded average of the newest up-to-5 counted attempts. */
      recentAverage: number;
      recentCount: number;
      /** Rounded average of the up-to-5 counted attempts before those, if any. */
      previousAverage: number | null;
      trend: PracticeTrend | null;
    }
  | { kind: "nudge" }
  | { kind: "none" };

export interface PracticeReadinessInput {
  attempts: readonly PracticeAttempt[];
  /** Ids of the study materials she still has. */
  materialIds: ReadonlySet<string>;
  /** She has at least one practice test she can take. */
  hasPracticeTest: boolean;
  today: IsoDate;
}

/**
 * A finished attempt on a material she still has. Skipped questions already
 * count as wrong in its score (correct / all questions), so finished attempts
 * with skips are counted as they are. In-progress and abandoned attempts, and
 * attempts whose material was deleted, are left out.
 */
function counts(attempt: PracticeAttempt, materialIds: ReadonlySet<string>): boolean {
  return (
    attempt.status === "completed" &&
    attempt.completedAt !== null &&
    attempt.scorePercent !== null &&
    Number.isFinite(attempt.scorePercent) &&
    attempt.totalQuestions > 0 &&
    attempt.sourceMaterialId !== null &&
    materialIds.has(attempt.sourceMaterialId)
  );
}

function average(attempts: readonly PracticeAttempt[]): number {
  const total = attempts.reduce((sum, attempt) => sum + (attempt.scorePercent ?? 0), 0);
  return Math.round(total / attempts.length);
}

export function buildPracticeReadiness(input: PracticeReadinessInput): PracticeReadiness {
  const start = addDays(input.today, -(WINDOW_DAYS - 1));
  const recent = input.attempts
    .filter((attempt) => counts(attempt, input.materialIds))
    .filter((attempt) => {
      const day = localDayOf(attempt.completedAt);
      return day !== null && day >= start && day <= input.today;
    })
    // Newest first; equal times fall back to id so the order never wobbles.
    .sort((a, b) => {
      const byTime = (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
      return byTime !== 0 ? byTime : b.id.localeCompare(a.id);
    });

  if (recent.length < MIN_RECENT_ATTEMPTS) {
    return input.hasPracticeTest ? { kind: "nudge" } : { kind: "none" };
  }

  const latest = recent.slice(0, GROUP_SIZE);
  const before = recent.slice(GROUP_SIZE, GROUP_SIZE * 2);
  const recentAverage = average(latest);
  const previousAverage = before.length > 0 ? average(before) : null;
  const trend: PracticeTrend | null =
    previousAverage === null
      ? null
      : recentAverage > previousAverage
        ? "up"
        : recentAverage < previousAverage
          ? "down"
          : "steady";

  return {
    kind: "summary",
    recentAverage,
    recentCount: latest.length,
    previousAverage,
    trend,
  };
}

/** The words she reads, or null when nothing should be shown. */
export function practiceReadinessText(readiness: PracticeReadiness): string | null {
  if (readiness.kind === "none") return null;
  if (readiness.kind === "nudge") return "Take a practice test this month to see how you're doing.";
  const base = `Your last ${readiness.recentCount} practice tests averaged ${readiness.recentAverage}%`;
  switch (readiness.trend) {
    case "up":
      return `${base}, up from ${readiness.previousAverage}%.`;
    case "down":
      return `${base}, down from ${readiness.previousAverage}%.`;
    case "steady":
      return `${base}, about the same as before.`;
    default:
      return `${base}.`;
  }
}
