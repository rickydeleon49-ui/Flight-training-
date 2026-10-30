/**
 * TESTTOOLS-01: property tests for `simple-v1` and the shared parity fixture
 * `src-tauri/fixtures/scheduler-parity/cases.json`.
 *
 * The fixture holds ~200 seeded random (prior, rating, now) cases, valid and
 * refused, with this scheduler's result for each. The native twin must give
 * identical results (`card_reviews_tests::scheduler_parity_fixture_matches_typescript`).
 * Regenerate only deliberately:
 * `UPDATE_SCHEDULER_PARITY_FIXTURE=1 npx vitest run src/logic/cardScheduler.property.test.ts`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  AGAIN_DELAY_MINUTES,
  CARD_RATINGS,
  DAY,
  LADDER_DAYS,
  MAX_STEP,
  MINUTE,
  SCHEDULER_VERSION,
  scheduleCard,
  SchedulerRefusal,
  stepDelayMs,
  type CardRating,
  type CardSchedule,
} from "./cardScheduler";

const FIXTURE = `${process.cwd()}/src-tauri/fixtures/scheduler-parity/cases.json`;
const SEED = 20261029;
const CASES = 200;

// 1970-01-01 .. 2199-12-31: four-digit years both sides format identically.
const MIN_MS = 0;
const MAX_MS = Date.UTC(2199, 11, 31, 23, 59, 59, 999);
const iso = (ms: number) => new Date(ms).toISOString();
const gap = (s: CardSchedule) => Date.parse(s.dueAt) - Date.parse(s.lastReviewedAt);

const instantMs = fc.integer({ min: MIN_MS, max: MAX_MS });
const rating = fc.constantFrom<CardRating>(...CARD_RATINGS);
const priorAt = (lastMs: number) =>
  fc.record({
    schedulerVersion: fc.constant(SCHEDULER_VERSION),
    step: fc.integer({ min: -1, max: MAX_STEP }),
    reps: fc.nat({ max: 100_000 }),
    lapses: fc.nat({ max: 100_000 }),
    lastReviewedAt: fc.constant(iso(lastMs)),
    dueAt: fc.constant(iso(lastMs)),
  });

/** A valid review: optional prior, a rating, and a time at or after the prior review. */
const validCase = instantMs.chain((lastMs) =>
  fc.record({
    prior: fc.option(priorAt(lastMs), { nil: null }),
    rating,
    now: fc.integer({ min: lastMs, max: Math.min(MAX_MS, lastMs + 400 * DAY) }).map(iso),
  }),
);

/** Inputs the scheduler must refuse, one refusal path each. */
const refusedCase = fc.oneof(
  fc.record({
    prior: fc.constant(null),
    rating: fc.constantFrom("", "Good", "perfect", "AGAIN", " easy"),
    now: instantMs.map(iso),
  }),
  fc.record({
    prior: fc.constant(null),
    rating,
    now: fc.constantFrom(
      "2026-10-06T15:00:00Z",
      "2026-02-30T15:00:00.000Z",
      "2026-10-06 15:00:00.000Z",
      "2026-10-06T24:00:00.000Z",
      "2026-13-01T00:00:00.000Z",
      "2026-10-06T15:00:60.000Z",
      "2026-10-06t15:00:00.000z",
      "",
    ),
  }),
  instantMs.chain((lastMs) =>
    fc.record({
      prior: priorAt(lastMs).map((p) => ({ ...p, schedulerVersion: "fsrs-6" })),
      rating,
      now: fc.constant(iso(Math.min(MAX_MS, lastMs + DAY))),
    }),
  ),
  fc.integer({ min: MIN_MS + 1, max: MAX_MS }).chain((lastMs) =>
    fc.record({
      prior: priorAt(lastMs),
      rating,
      now: fc.integer({ min: MIN_MS, max: lastMs - 1 }).map(iso),
    }),
  ),
);

interface ParityCase {
  prior: CardSchedule | null;
  rating: string;
  now: string;
  expected: { ok: CardSchedule } | { error: string };
}

function outcome(prior: CardSchedule | null, r: string, now: string): ParityCase["expected"] {
  try {
    return { ok: scheduleCard(prior, r as CardRating, now) };
  } catch (error) {
    if (error instanceof SchedulerRefusal) return { error: error.code };
    throw error;
  }
}

function generate(): ParityCase[] {
  const inputs = [
    ...fc.sample(validCase, { seed: SEED, numRuns: (CASES * 3) / 4 }),
    ...fc.sample(refusedCase, { seed: SEED + 1, numRuns: CASES / 4 }),
  ];
  return inputs.map(({ prior, rating: r, now }) => ({ prior, rating: r, now, expected: outcome(prior, r, now) }));
}

describe("[pure] simple-v1 properties (fast-check)", () => {
  it("never schedules into the past: due is after the review, which is exactly now", () => {
    fc.assert(
      fc.property(validCase, ({ prior, rating: r, now }) => {
        const next = scheduleCard(prior, r, now);
        expect(next.lastReviewedAt).toBe(now);
        expect(Date.parse(next.dueAt)).toBeGreaterThan(Date.parse(now));
        expect(gap(next)).toBe(stepDelayMs(next.step));
        expect(gap(next)).toBeLessThanOrEqual(LADDER_DAYS[MAX_STEP]! * DAY);
      }),
    );
  });

  it("good never shortens the wait; easy >= good >= hard >= again from the same state", () => {
    fc.assert(
      fc.property(validCase, ({ prior, now }) => {
        const waits = (["again", "hard", "good", "easy"] as const).map((r) => gap(scheduleCard(prior, r, now)));
        for (let i = 1; i < waits.length; i++) expect(waits[i]!).toBeGreaterThanOrEqual(waits[i - 1]!);
        const priorWait = prior ? stepDelayMs(prior.step) : 0;
        expect(waits[2]!).toBeGreaterThanOrEqual(priorWait);
      }),
    );
  });

  it("again is 10 minutes off the ladder and counts a lapse only for a ladder card", () => {
    fc.assert(
      fc.property(validCase, ({ prior, now }) => {
        const next = scheduleCard(prior, "again", now);
        expect(next.step).toBe(-1);
        expect(gap(next)).toBe(AGAIN_DELAY_MINUTES * MINUTE);
        const lapses = prior?.lapses ?? 0;
        expect(next.lapses).toBe(prior && prior.step >= 0 ? lapses + 1 : lapses);
      }),
    );
  });

  it("every review counts once and only Again changes lapses", () => {
    fc.assert(
      fc.property(validCase, ({ prior, rating: r, now }) => {
        const next = scheduleCard(prior, r, now);
        expect(next.reps).toBe((prior?.reps ?? 0) + 1);
        if (r !== "again") expect(next.lapses).toBe(prior?.lapses ?? 0);
        expect(next.step).toBeGreaterThanOrEqual(-1);
        expect(next.step).toBeLessThanOrEqual(MAX_STEP);
      }),
    );
  });

  it("a chain of reviews at their due times keeps advancing time and stays valid", () => {
    fc.assert(
      fc.property(fc.integer({ min: MIN_MS, max: Date.UTC(2100, 0, 1) }), fc.array(rating, { maxLength: 30 }), (startMs, ratings) => {
        let state: CardSchedule | null = null;
        let now = iso(startMs);
        for (const r of ratings) {
          const next: CardSchedule = scheduleCard(state, r, now);
          expect(Date.parse(next.dueAt)).toBeGreaterThan(Date.parse(now));
          state = next;
          now = next.dueAt;
        }
      }),
    );
  });

  it("refuses every malformed or out-of-order input with a typed code", () => {
    fc.assert(
      fc.property(refusedCase, ({ prior, rating: r, now }) => {
        expect(outcome(prior, r, now)).toHaveProperty("error");
      }),
    );
  });
});

describe("simple-v1 shared parity fixture", () => {
  it("the committed cases reproduce exactly (native twin checks the same file)", () => {
    if (process.env.UPDATE_SCHEDULER_PARITY_FIXTURE === "1") {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      const fixture = {
        description:
          "Shared simple-v1 parity cases (TESTTOOLS-01). Each case is (prior | null, rating, now) and the expected {ok: schedule} or {error: CODE}. TypeScript: scheduleCard in src/logic/cardScheduler.ts; native: card_reviews::schedule_card. Generated by src/logic/cardScheduler.property.test.ts with fast-check seed " +
          `${SEED}; every value is synthetic.`,
        cases: generate(),
      };
      writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 1)}\n`);
    }
    expect(existsSync(FIXTURE)).toBe(true);
    const { cases } = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: ParityCase[] };
    expect(cases.length).toBe(CASES);
    expect(cases.filter((c) => "error" in c.expected).length).toBeGreaterThanOrEqual(CASES / 4);
    for (const c of cases) expect(outcome(c.prior, c.rating, c.now)).toEqual(c.expected);
  });
});
