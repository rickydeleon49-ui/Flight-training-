/**
 * "Test conditions" for a practice test. The pace is the FAA written-test pace
 * for the Private Pilot Airplane test (60 questions in 2.0 hours), i.e. two
 * minutes per question. The timing is kept in a small add-only side record per
 * attempt, so the saved attempt format does not change and attempts saved
 * before this existed load exactly as they did.
 */
export const SECONDS_PER_QUESTION = 120;
export const TIMED_STORAGE_KEY = "hfd.timedAttempts.v1";

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

function readAll(): Record<string, TimedAttemptRecord> {
  try {
    const raw = globalThis.localStorage?.getItem(TIMED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, TimedAttemptRecord>)
      : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, TimedAttemptRecord>): void {
  try {
    globalThis.localStorage?.setItem(TIMED_STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* Timing is a convenience; the attempt itself is saved elsewhere. */
  }
}

function isRecord(value: unknown): value is TimedAttemptRecord {
  const v = value as TimedAttemptRecord | null;
  return !!v && typeof v.startedMs === "number" && typeof v.deadlineMs === "number";
}

export function readTimedAttempt(attemptId: string): TimedAttemptRecord | null {
  const value = readAll()[attemptId];
  return isRecord(value) ? value : null;
}

export function isTimedAttempt(attemptId: string): boolean {
  return readTimedAttempt(attemptId) !== null;
}

export function startTimedAttempt(
  attemptId: string,
  questionCount: number,
  nowMs: number = Date.now(),
): TimedAttemptRecord {
  const record: TimedAttemptRecord = {
    startedMs: nowMs,
    deadlineMs: nowMs + timedSecondsFor(questionCount) * 1000,
  };
  writeAll({ ...readAll(), [attemptId]: record });
  return record;
}

/** Whole seconds used by `finishedMs`, never more than the time allowed. */
export function secondsUsedAt(record: TimedAttemptRecord, finishedMs: number): number {
  const limit = Math.round((record.deadlineMs - record.startedMs) / 1000);
  return Math.min(limit, Math.max(0, Math.round((finishedMs - record.startedMs) / 1000)));
}

/** Records the time used once; later calls keep the first value. */
export function finishTimedAttempt(
  attemptId: string,
  finishedMs: number = Date.now(),
): TimedAttemptRecord | null {
  const all = readAll();
  const record = all[attemptId];
  if (!isRecord(record)) return null;
  if (typeof record.secondsUsed === "number") return record;
  const next = { ...record, secondsUsed: secondsUsedAt(record, finishedMs) };
  writeAll({ ...all, [attemptId]: next });
  return next;
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
