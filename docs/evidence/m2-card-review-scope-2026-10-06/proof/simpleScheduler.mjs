// Proposed deterministic card scheduler "simple-v1" (research proof only).
//
// Pure: (prior state | null, rating, now) -> next state. No randomness, no
// clock read, no I/O. Stored due values are absolute UTC instants; local
// calendar handling lives only in `isDueByLocalDay` below.
//
// This is review scheduling, not a measure of mastery or a validated
// aviation training method.

export const SCHEDULER_VERSION = "simple-v1";
export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

/** Again is the only sub-day step; every other rating waits at least a day. */
export const AGAIN_DELAY_MINUTES = 10;
/** Review ladder in days. The last rung is the maximum interval (180 days). */
export const LADDER_DAYS = Object.freeze([1, 3, 7, 16, 35, 75, 150, 180]);
export const MAX_STEP = LADDER_DAYS.length - 1;

export const RATINGS = Object.freeze(["again", "hard", "good", "easy"]);

export class SchedulerRefusal extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * step -1 means "not yet on the ladder" (new or relearning after Again).
 *   again -> step -1, due in 10 minutes, lapse counted if it was on the ladder
 *   hard  -> stay on the current rung (at least rung 0)
 *   good  -> one rung up
 *   easy  -> two rungs up
 * Intervals count from the review time, so an overdue card is not advanced
 * further for having waited.
 */
export function schedule(prior, rating, nowIso) {
  if (!RATINGS.includes(rating)) throw new SchedulerRefusal("INVALID_RATING");
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) throw new SchedulerRefusal("INVALID_TIME");
  const state = prior ?? { schedulerVersion: SCHEDULER_VERSION, step: -1, reps: 0, lapses: 0, lastReviewedAt: null, dueAt: null };
  if (state.schedulerVersion !== SCHEDULER_VERSION) throw new SchedulerRefusal("UNSUPPORTED_SCHEDULER_VERSION");
  if (state.lastReviewedAt !== null && now < Date.parse(state.lastReviewedAt)) {
    // The computer's clock is earlier than the last saved review: refuse
    // rather than schedule from a time that went backwards.
    throw new SchedulerRefusal("CLOCK_BEHIND_LAST_REVIEW");
  }
  let step;
  let lapses = state.lapses;
  let due;
  if (rating === "again") {
    if (state.step >= 0) lapses += 1;
    step = -1;
    due = now + AGAIN_DELAY_MINUTES * MINUTE;
  } else {
    const from = state.step;
    step =
      rating === "hard" ? Math.max(0, from) : rating === "good" ? Math.min(from + 1, MAX_STEP) : Math.min(from + 2, MAX_STEP);
    due = now + LADDER_DAYS[step] * DAY;
  }
  return {
    schedulerVersion: SCHEDULER_VERSION,
    step,
    reps: state.reps + 1,
    lapses,
    lastReviewedAt: new Date(now).toISOString(),
    dueAt: new Date(due).toISOString(),
  };
}

/** The local calendar date (YYYY-MM-DD) of an instant in an IANA time zone. */
export function localDate(instantIso, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(instantIso),
  );
}

/**
 * Queue rule. A card on the day ladder (step >= 0) belongs in today's Review
 * due when its stored instant falls on or before the current local day in the
 * zone the computer is in now. A card waiting after Again (step -1) is due
 * only once its exact instant has passed, so it does not reappear before its
 * ten minutes are up. Nothing stored is rewritten when the zone changes.
 */
export function isDue(state, nowIso, timeZone) {
  if (state.step < 0) return Date.parse(state.dueAt) <= Date.parse(nowIso);
  return localDate(state.dueAt, timeZone) <= localDate(nowIso, timeZone);
}
