/**
 * `simple-v1`, ported with unchanged meaning from the accepted proof
 * (`docs/evidence/m2-card-review-scope-2026-10-06/proof/proof.test.mjs`, [pure]).
 */
import { describe, expect, it } from "vitest";

import {
  CARD_RATINGS,
  DAY,
  describeWait,
  isIsoInstant,
  LADDER_DAYS,
  MINUTE,
  scheduleCard,
  SchedulerRefusal,
  stepDelayMs,
  type CardSchedule,
} from "./cardScheduler";

const T0 = "2026-10-06T15:00:00.000Z";
const at = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const gap = (from: string, to: string) => Date.parse(to) - Date.parse(from);

describe("[pure] simple-v1 scheduler", () => {
  it("first exposure: Again 10 minutes; Hard and Good 1 day; Easy 3 days", () => {
    const delays = Object.fromEntries(CARD_RATINGS.map((r) => [r, gap(T0, scheduleCard(null, r, T0).dueAt)]));
    expect(delays).toEqual({ again: 10 * MINUTE, hard: 1 * DAY, good: 1 * DAY, easy: 3 * DAY });
  });

  it("intervals are bounded: nonzero minimum, and repeated Easy never passes 180 days", () => {
    let state: CardSchedule | null = null;
    let now = T0;
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      state = scheduleCard(state, "easy", now);
      seen.push(gap(now, state.dueAt));
      now = state.dueAt;
    }
    expect(Math.max(...seen)).toBe(180 * DAY);
    expect(seen.at(-1)).toBe(180 * DAY);
    expect(Math.min(...seen)).toBeGreaterThan(0);
  });

  it("repeat failure: Again on a ladder card counts one lapse, a second Again does not count again", () => {
    let state = scheduleCard(null, "good", T0);
    state = scheduleCard(state, "good", state.dueAt);
    const failedAt = state.dueAt;
    state = scheduleCard(state, "again", failedAt);
    expect([state.step, state.lapses, gap(failedAt, state.dueAt)]).toEqual([-1, 1, 10 * MINUTE]);
    state = scheduleCard(state, "again", state.dueAt);
    expect([state.step, state.lapses]).toEqual([-1, 1]);
    const back = state.dueAt;
    state = scheduleCard(state, "good", back);
    expect([state.step, gap(back, state.dueAt)]).toEqual([0, LADDER_DAYS[0]! * DAY]);
  });

  it("overdue: a card reviewed 20 days late moves one rung, counted from the review time", () => {
    let state = scheduleCard(scheduleCard(null, "good", T0), "good", at(T0, DAY));
    const late = at(state.dueAt, 20 * DAY);
    state = scheduleCard(state, "good", late);
    expect([state.step, gap(late, state.dueAt)]).toEqual([2, LADDER_DAYS[2]! * DAY]);
  });

  it("clock rollback: a review earlier than the last saved review is refused; the same instant is not", () => {
    const state = scheduleCard(null, "good", T0);
    expect(() => scheduleCard(state, "good", at(T0, -MINUTE))).toThrowError(
      expect.objectContaining({ code: "CLOCK_BEHIND_LAST_REVIEW" }),
    );
    expect(() => scheduleCard(state, "good", T0)).not.toThrow();
  });

  it("deterministic: identical prior state, rating and time give identical, serializable output", () => {
    const prior = scheduleCard(null, "good", T0);
    const runs = [1, 2, 3].map(() => scheduleCard(JSON.parse(JSON.stringify(prior)), "hard", at(T0, 2 * DAY)));
    expect(runs[0]).toEqual(runs[1]);
    expect(runs[1]).toEqual(runs[2]);
    expect(JSON.parse(JSON.stringify(runs[0]))).toEqual(runs[0]);
  });

  it("refuses state from an unknown scheduler version instead of guessing", () => {
    const foreign = { schedulerVersion: "fsrs-6", step: 0, reps: 1, lapses: 0, lastReviewedAt: T0, dueAt: T0 };
    expect(() => scheduleCard(foreign, "good", at(T0, DAY))).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEDULER_VERSION" }),
    );
  });

  it("refuses a malformed time and an unknown rating", () => {
    expect(() => scheduleCard(null, "good", "2026-10-06T15:00:00Z")).toThrow(SchedulerRefusal);
    expect(() => scheduleCard(null, "perfect" as never, T0)).toThrowError(expect.objectContaining({ code: "INVALID_RATING" }));
  });

  it("hard stays on its rung, good climbs one, easy climbs two, all capped at the last rung", () => {
    const onRung = (step: number): CardSchedule => ({ schedulerVersion: "simple-v1", step, reps: 3, lapses: 0, lastReviewedAt: T0, dueAt: at(T0, stepDelayMs(step)) });
    expect(scheduleCard(onRung(3), "hard", at(T0, DAY)).step).toBe(3);
    expect(scheduleCard(onRung(3), "good", at(T0, DAY)).step).toBe(4);
    expect(scheduleCard(onRung(3), "easy", at(T0, DAY)).step).toBe(5);
    expect(scheduleCard(onRung(7), "easy", at(T0, DAY)).step).toBe(7);
    expect(scheduleCard(onRung(6), "easy", at(T0, DAY)).step).toBe(7);
  });

  it("only the exact 24-character UTC form is an instant", () => {
    expect(isIsoInstant(T0)).toBe(true);
    expect(isIsoInstant("2026-10-06T15:00:00Z")).toBe(false);
    expect(isIsoInstant("2026-02-30T15:00:00.000Z")).toBe(false);
    expect(isIsoInstant("2026-10-06 15:00:00.000Z")).toBe(false);
    expect(isIsoInstant(null)).toBe(false);
  });

  it("describes waits for rating labels", () => {
    expect(describeWait(10 * MINUTE)).toBe("10 minutes");
    expect(describeWait(DAY)).toBe("1 day");
    expect(describeWait(180 * DAY)).toBe("180 days");
  });
});
