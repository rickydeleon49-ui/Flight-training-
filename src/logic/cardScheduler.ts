/**
 * The deterministic card scheduler `simple-v1` (approved default C-D1/C-D2).
 *
 * Pure: (prior state | null, rating, now) -> next state. No randomness, clock
 * read or I/O. Stored due values are absolute UTC instants in the 24-character
 * `Date#toISOString` form; local calendar handling lives in `localDay.ts`.
 *
 * Ratings only decide when a card comes back. They are not a score, mastery,
 * an FAA result or a prediction of test success. The native twin in
 * `src-tauri/src/card_reviews.rs` must give identical results.
 */

export const SCHEDULER_VERSION = "simple-v1";
export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

/** Again is the only sub-day step; every other rating waits at least a day. */
export const AGAIN_DELAY_MINUTES = 10;
/** The review ladder in days. The last rung is the maximum interval. */
export const LADDER_DAYS: readonly number[] = Object.freeze([1, 3, 7, 16, 35, 75, 150, 180]);
export const MAX_STEP = LADDER_DAYS.length - 1;

export type CardRating = "again" | "hard" | "good" | "easy";
export const CARD_RATINGS: readonly CardRating[] = Object.freeze(["again", "hard", "good", "easy"]);

export interface CardSchedule {
  schedulerVersion: string;
  /** -1 while not on the day ladder (new, or relearning after Again). */
  step: number;
  reps: number;
  lapses: number;
  lastReviewedAt: string;
  dueAt: string;
}

export type SchedulerRefusalCode =
  | "INVALID_RATING"
  | "INVALID_TIME"
  | "UNSUPPORTED_SCHEDULER_VERSION"
  | "CLOCK_BEHIND_LAST_REVIEW";

export class SchedulerRefusal extends Error {
  readonly code: SchedulerRefusalCode;
  constructor(code: SchedulerRefusalCode) {
    super(code);
    this.name = "SchedulerRefusal";
    this.code = code;
  }
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** True only for the exact 24-character UTC form that round-trips through Date. */
export function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value;
}

/**
 * Schedule one rating.
 *
 *   again -> step -1, due in 10 minutes; a lapse is counted if it was on the ladder
 *   hard  -> stay on the current rung (at least rung 0)
 *   good  -> one rung up
 *   easy  -> two rungs up
 *
 * Intervals count from the review time, so an overdue card is not advanced
 * further for having waited. A clock earlier than the last review refuses.
 */
export function scheduleCard(prior: CardSchedule | null, rating: CardRating, nowIso: string): CardSchedule {
  if (!CARD_RATINGS.includes(rating)) throw new SchedulerRefusal("INVALID_RATING");
  if (!isIsoInstant(nowIso)) throw new SchedulerRefusal("INVALID_TIME");
  const now = Date.parse(nowIso);
  if (prior && prior.schedulerVersion !== SCHEDULER_VERSION) {
    throw new SchedulerRefusal("UNSUPPORTED_SCHEDULER_VERSION");
  }
  if (prior && now < Date.parse(prior.lastReviewedAt)) {
    throw new SchedulerRefusal("CLOCK_BEHIND_LAST_REVIEW");
  }
  const from = prior?.step ?? -1;
  let lapses = prior?.lapses ?? 0;
  let step: number;
  let due: number;
  if (rating === "again") {
    if (from >= 0) lapses += 1;
    step = -1;
    due = now + AGAIN_DELAY_MINUTES * MINUTE;
  } else {
    step = rating === "hard" ? Math.max(0, from) : Math.min(from + (rating === "good" ? 1 : 2), MAX_STEP);
    due = now + LADDER_DAYS[step]! * DAY;
  }
  return {
    schedulerVersion: SCHEDULER_VERSION,
    step,
    reps: (prior?.reps ?? 0) + 1,
    lapses,
    lastReviewedAt: new Date(now).toISOString(),
    dueAt: new Date(due).toISOString(),
  };
}

/** The wait a step sets after a review, in milliseconds. */
export function stepDelayMs(step: number): number {
  return step < 0 ? AGAIN_DELAY_MINUTES * MINUTE : LADDER_DAYS[step]! * DAY;
}

/** "10 minutes", "1 day", "3 days": the wait a rating would set, for button labels. */
export function describeWait(ms: number): string {
  if (ms < DAY) {
    const minutes = Math.round(ms / MINUTE);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const days = Math.round(ms / DAY);
  return `${days} day${days === 1 ? "" : "s"}`;
}
