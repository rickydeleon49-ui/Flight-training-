/**
 * `fsrs6-candidate-1`: the disposable FSRS-6 candidate from the P54-06 phase B
 * preregistration (docs/evidence/p54-06-phase-b-2026-10-19/PREREGISTRATION.md).
 *
 * Evaluation evidence only. It is NOT imported by the application, it does not
 * replace `simple-v1`, and nothing here chooses a production algorithm.
 *
 * Pure: (prior | null, rating, nowIso, config) -> next state. No clock read,
 * randomness, fuzz or I/O, and the prior is never mutated. The memory-state
 * formulas are written in the same operation order as the pinned FSRS4Anki
 * v6.1.3 oracle so that both produce the same IEEE-754 doubles.
 */

export const SCHEDULER_VERSION = "fsrs6-candidate-1";

/** The oracle's default FSRS-6 parameters, w[0]..w[20]; w[20] is the decay. */
export const W: readonly number[] = Object.freeze([
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
]);
/** Benchmark retention only (the oracle default), not a product setting. */
export const REQUEST_RETENTION = 0.9;
const DECAY = -W[20]!;
const FACTOR = 0.9 ** (1 / DECAY) - 1;

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;
export const AGAIN_DELAY_MS = 10 * MINUTE_MS;
export const MAX_DUE_MS = Date.parse("9999-12-31T23:59:59.999Z");
export const D_MIN = 1;
export const D_MAX = 10;
export const S_MIN = 0.01;
export const S_MAX = 1_000_000;

export type FsrsRating = "again" | "hard" | "good" | "easy";
export const FSRS_RATINGS: readonly FsrsRating[] = Object.freeze(["again", "hard", "good", "easy"]);
const GRADE: Readonly<Record<FsrsRating, number>> = Object.freeze({ again: 1, hard: 2, good: 3, easy: 4 });

export interface FsrsConfig {
  /** Longest interval in days: 180 for product comparison, 36,500 for oracle parity. */
  maximumInterval: number;
}
export const PRODUCT_CONFIG: Readonly<FsrsConfig> = Object.freeze({ maximumInterval: 180 });
export const ORACLE_PARITY_CONFIG: Readonly<FsrsConfig> = Object.freeze({ maximumInterval: 36_500 });

export interface FsrsState {
  schedulerVersion: string;
  d: number;
  s: number;
  reps: number;
  lapses: number;
  lastReviewedAt: string;
  dueAt: string;
}

export type FsrsRefusalCode =
  | "INVALID_RATING"
  | "INVALID_TIME"
  | "UNSUPPORTED_SCHEDULER_VERSION"
  | "INVALID_STATE"
  | "CLOCK_BEHIND_LAST_REVIEW"
  | "COUNTER_OUT_OF_RANGE"
  | "DUE_OUT_OF_RANGE";

export class FsrsRefusal extends Error {
  readonly code: FsrsRefusalCode;
  constructor(code: FsrsRefusalCode) {
    super(code);
    this.name = "FsrsRefusal";
    this.code = code;
  }
}

export type FsrsPath = "new" | "same-day" | "review";

export interface FsrsDecision {
  state: FsrsState;
  path: FsrsPath;
  /** null on the new path (there is no previous review). */
  elapsedDays: number | null;
  /** Whole days until due; null for Again (10 minutes). */
  intervalDays: number | null;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** True only for the canonical 24-character UTC instant that round-trips through Date. */
export function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 24 || !ISO_INSTANT.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value;
}

const isCounter = (value: unknown): boolean =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const inRange = (value: unknown, lo: number, hi: number): boolean =>
  typeof value === "number" && Number.isFinite(value) && value >= lo && value <= hi;

/** Check 4: every field of an FSRS prior (the version is check 3). */
export function isValidPriorFields(prior: FsrsState): boolean {
  return (
    inRange(prior.d, D_MIN, D_MAX) &&
    inRange(prior.s, S_MIN, S_MAX) &&
    isCounter(prior.reps) &&
    isCounter(prior.lapses) &&
    isCanonicalInstant(prior.lastReviewedAt) &&
    isCanonicalInstant(prior.dueAt)
  );
}

// ---- Memory-state formulas: same expressions and order as the oracle. ----

function constrainDifficulty(difficulty: number): number {
  return Math.min(Math.max(+difficulty.toFixed(2), 1), 10);
}
function initDifficulty(rating: FsrsRating): number {
  return +constrainDifficulty(W[4]! - Math.exp(W[5]! * (GRADE[rating] - 1)) + 1).toFixed(2);
}
function initStability(rating: FsrsRating): number {
  return +Math.max(W[GRADE[rating] - 1]!, 0.1).toFixed(2);
}
function linearDamping(deltaD: number, oldD: number): number {
  return (deltaD * (10 - oldD)) / 9;
}
function meanReversion(init: number, current: number): number {
  return W[7]! * init + (1 - W[7]!) * current;
}
function nextDifficulty(d: number, rating: FsrsRating): number {
  const deltaD = -W[6]! * (GRADE[rating] - 3);
  const nextD = d + linearDamping(deltaD, d);
  return constrainDifficulty(meanReversion(initDifficulty("easy"), nextD));
}
function forgettingCurve(elapsedDays: number, stability: number): number {
  return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
}
function nextRecallStability(d: number, s: number, r: number, rating: FsrsRating): number {
  const hardPenalty = rating === "hard" ? W[15]! : 1;
  const easyBonus = rating === "easy" ? W[16]! : 1;
  return +(
    s *
    (1 +
      Math.exp(W[8]!) *
        (11 - d) *
        Math.pow(s, -W[9]!) *
        (Math.exp((1 - r) * W[10]!) - 1) *
        hardPenalty *
        easyBonus)
  ).toFixed(2);
}
function nextForgetStability(d: number, s: number, r: number): number {
  const sMin = s / Math.exp(W[17]! * W[18]!);
  return +Math.min(
    W[11]! * Math.pow(d, -W[12]!) * (Math.pow(s + 1, W[13]!) - 1) * Math.exp((1 - r) * W[14]!),
    sMin,
  ).toFixed(2);
}
function nextShortTermStability(s: number, rating: FsrsRating): number {
  const grade = GRADE[rating];
  let sinc = Math.exp(W[17]! * (grade - 3 + W[18]!)) * Math.pow(s, -W[19]!);
  if (grade >= 3) sinc = Math.max(sinc, 1);
  return +(s * sinc).toFixed(2);
}

/** Deviations C1 (floor 0.01) and C3 (ceiling 1,000,000), applied after the oracle's rounding. */
function boundStability(s: number): number {
  return Math.min(Math.max(s, S_MIN), S_MAX);
}

/** Unfuzzed `next_interval`, including the oracle's own cap. */
function nextInterval(stability: number, maximum: number): number {
  const raw = (stability / FACTOR) * (Math.pow(REQUEST_RETENTION, 1 / DECAY) - 1);
  return Math.min(Math.max(Math.round(raw), 1), maximum);
}

type Memory = Record<FsrsRating, { d: number; s: number }>;

function memoryFor(path: FsrsPath, prior: FsrsState | null, elapsedDays: number): Memory {
  const out = {} as Memory;
  for (const rating of FSRS_RATINGS) {
    let d: number;
    let s: number;
    if (path === "new") {
      d = initDifficulty(rating);
      s = initStability(rating);
    } else if (path === "same-day") {
      d = nextDifficulty(prior!.d, rating);
      s = nextShortTermStability(prior!.s, rating);
    } else {
      const r = forgettingCurve(elapsedDays, prior!.s);
      d = nextDifficulty(prior!.d, rating);
      s = rating === "again" ? nextForgetStability(prior!.d, prior!.s, r) : nextRecallStability(prior!.d, prior!.s, r, rating);
    }
    out[rating] = { d, s: boundStability(s) };
  }
  return out;
}

/** Day intervals for Hard, Good and Easy; deviation C2 caps after ordering. */
function intervalsFor(path: FsrsPath, memory: Memory, maximum: number): Record<"hard" | "good" | "easy", number> {
  let hard: number;
  let good: number;
  let easy: number;
  if (path === "review") {
    hard = nextInterval(memory.hard.s, maximum);
    good = nextInterval(memory.good.s, maximum);
    easy = nextInterval(memory.easy.s, maximum);
    hard = Math.min(hard, good);
    good = Math.max(good, hard + 1);
    easy = Math.max(easy, good + 1);
  } else {
    hard = 1;
    good = nextInterval(memory.good.s, maximum);
    easy = Math.max(nextInterval(memory.easy.s, maximum), good + 1);
  }
  return { hard: Math.min(hard, maximum), good: Math.min(good, maximum), easy: Math.min(easy, maximum) };
}

function checkConfig(config: FsrsConfig): number {
  const maximum = config?.maximumInterval;
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new TypeError("maximumInterval must be a positive safe integer");
  return maximum;
}

/** Schedule one rating and explain how (path, elapsed days, interval). */
export function decideFsrs(prior: FsrsState | null, rating: FsrsRating, nowIso: string, config: FsrsConfig): FsrsDecision {
  // 1. rating
  if (typeof rating !== "string" || !FSRS_RATINGS.includes(rating)) throw new FsrsRefusal("INVALID_RATING");
  // 2. time
  if (!isCanonicalInstant(nowIso)) throw new FsrsRefusal("INVALID_TIME");
  const now = Date.parse(nowIso);
  if (prior !== null) {
    // 3. version. A non-object prior carries no recognisable version.
    if (typeof prior !== "object" || Array.isArray(prior) || prior.schedulerVersion !== SCHEDULER_VERSION) {
      throw new FsrsRefusal("UNSUPPORTED_SCHEDULER_VERSION");
    }
    // 4. state
    if (!isValidPriorFields(prior)) throw new FsrsRefusal("INVALID_STATE");
  }
  // 5. clock
  const last = prior === null ? null : Date.parse(prior.lastReviewedAt);
  if (last !== null && now < last) throw new FsrsRefusal("CLOCK_BEHIND_LAST_REVIEW");

  const elapsedDays = last === null ? null : Math.floor((now - last) / DAY_MS);
  const path: FsrsPath = elapsedDays === null ? "new" : elapsedDays === 0 ? "same-day" : "review";
  const isLapse = path === "review" && rating === "again";

  // 6. counters (compared without forming an unsafe successor)
  const reps = prior?.reps ?? 0;
  const lapses = prior?.lapses ?? 0;
  if (reps >= Number.MAX_SAFE_INTEGER || (isLapse && lapses >= Number.MAX_SAFE_INTEGER)) {
    throw new FsrsRefusal("COUNTER_OUT_OF_RANGE");
  }

  // A bad config is a programming error, checked only after the numbered refusals (1–6) so it never preempts them.
  const maximum = checkConfig(config);
  const memory = memoryFor(path, prior, elapsedDays ?? 0);
  const intervalDays = rating === "again" ? null : intervalsFor(path, memory, maximum)[rating];
  const due = intervalDays === null ? now + AGAIN_DELAY_MS : now + intervalDays * DAY_MS;
  // 7. due range
  if (!(due <= MAX_DUE_MS)) throw new FsrsRefusal("DUE_OUT_OF_RANGE");

  return {
    state: {
      schedulerVersion: SCHEDULER_VERSION,
      d: memory[rating].d,
      s: memory[rating].s,
      reps: reps + 1,
      lapses: isLapse ? lapses + 1 : lapses,
      lastReviewedAt: nowIso,
      dueAt: new Date(due).toISOString(),
    },
    path,
    elapsedDays,
    intervalDays,
  };
}

/** The preregistered entry point: returns only the next state, or throws FsrsRefusal. */
export function scheduleFsrs(prior: FsrsState | null, rating: FsrsRating, nowIso: string, config: FsrsConfig): FsrsState {
  return decideFsrs(prior, rating, nowIso, config).state;
}
