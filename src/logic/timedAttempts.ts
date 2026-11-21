/**
 * "Test conditions" for a practice test. The pace is the FAA written-test pace
 * for the Private Pilot Airplane test (60 questions in 2.0 hours), i.e. two
 * minutes per question. The timing lives on the attempt row (nullable columns,
 * NULL = not timed), so attempts saved before this existed load as untimed.
 */
export const SECONDS_PER_QUESTION = 120;
/** Old browser-storage key, read once to move earlier records into the database. */
export const LEGACY_TIMED_STORAGE_KEY = "hfd.timedAttempts.v1";

export interface TimedAttemptRecord {
  /** Epoch ms the clock started. */
  startedMs: number;
  /** Epoch ms the clock runs out; the countdown is always derived from this. */
  deadlineMs: number;
  /** Whole seconds used, written once the attempt is finished. */
  secondsUsed?: number;
}

export function timedSecondsFor(questionCount: number): number {
  return Math.max(0, Math.floor(questionCount)) * SECONDS_PER_QUESTION;
}

/** The record for a clock started at `nowMs` for a test of `questionCount` questions. */
export function newTimedRecord(questionCount: number, nowMs: number = Date.now()): TimedAttemptRecord {
  return { startedMs: nowMs, deadlineMs: nowMs + timedSecondsFor(questionCount) * 1000 };
}

export function isTimedRecord(value: unknown): value is TimedAttemptRecord {
  const v = value as TimedAttemptRecord | null;
  return (
    !!v &&
    typeof v === "object" &&
    Number.isFinite(v.startedMs) &&
    Number.isFinite(v.deadlineMs) &&
    (v.secondsUsed === undefined || Number.isFinite(v.secondsUsed))
  );
}

/** Whole seconds used by `finishedMs`, never more than the time allowed. */
export function secondsUsedAt(record: TimedAttemptRecord, finishedMs: number): number {
  const limit = Math.round((record.deadlineMs - record.startedMs) / 1000);
  return Math.min(limit, Math.max(0, Math.round((finishedMs - record.startedMs) / 1000)));
}

export function remainingMs(record: TimedAttemptRecord, nowMs: number = Date.now()): number {
  return Math.max(0, record.deadlineMs - nowMs);
}

/** mm:ss (minutes are not capped, so two hours reads 120:00). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Spoken only at the two thresholds, never every second. */
export function timeAnnouncement(ms: number): string {
  if (ms <= 0) return "Time is up";
  if (ms <= 60_000) return "1 minute left";
  if (ms <= 300_000) return "5 minutes left";
  return "";
}

export function describeDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m} min ${String(s).padStart(2, "0")} s`;
}
