import { describe, expect, it } from "vitest";

import { makeAction, makeEvent, makeProfile, makeTransaction } from "@/testing/factories";
import { flightLogTotals } from "./flightLog";
import {
  buildReminders,
  DEFAULT_TOOLKIT_STATE,
  makeQuizAttempt,
  normalizeToolkitState,
  QUIZ_QUESTIONS,
  readinessSummary,
  trainingCostForecast,
} from "./toolkit";

describe("pilot toolkit", () => {
  it("restores newly added readiness items when loading older state", () => {
    const state = normalizeToolkitState({ readinessItems: [] });
    expect(state.readinessItems.length).toBeGreaterThan(10);
    expect(state.reminderLeadDays).toBe(7);
  });

  it("summarizes self-assessed and instructor-confirmed readiness separately", () => {
    const items = DEFAULT_TOOLKIT_STATE.readinessItems.slice(0, 3).map((item, index) => ({
      ...item,
      status: index === 0 ? ("instructor_signed_off" as const) : index === 1 ? ("ready" as const) : ("learning" as const),
    }));
    expect(readinessSummary(items)).toMatchObject({ total: 3, ready: 2, signedOff: 1 });
  });

  it("forecasts remaining private-pilot planning cost from observed spending", () => {
    const totals = flightLogTotals([]);
    totals.totalTime = 10;
    const result = trainingCostForecast(
      totals,
      [makeTransaction({ amount: 2_000_00, category: "flight_lesson" })],
      { ...DEFAULT_TOOLKIT_STATE, additionalTrainingCosts: 500_00 },
    );
    expect(result.observedHourly).toBe(200_00);
    expect(result.estimatedRemaining).toBe(6_500_00);
  });

  it("collects overdue actions, upcoming events, and expiring records", () => {
    const reminders = buildReminders({
      actions: [makeAction({ id: "a", dueDate: "2026-09-04" })],
      events: [makeEvent({ id: "e", date: "2026-09-07" })],
      credentials: [{ id: "c", type: "medical", title: "Medical", identifier: "", issuedOn: null, expiresOn: "2026-09-10", notes: "", materialId: null }],
      profile: makeProfile(),
      today: "2026-09-05",
      leadDays: 7,
    });
    expect(reminders.map((item) => item.id)).toEqual(["action-a", "event-e", "credential-c"]);
  });

  it("scores quiz attempts and records weak topics", () => {
    const answers = QUIZ_QUESTIONS.map((question) => question.correct);
    answers[0] = answers[0] === 0 ? 1 : 0;
    const attempt = makeQuizAttempt(answers, "2026-09-05T12:00:00Z", "q1");
    expect(attempt.score).toBe(QUIZ_QUESTIONS.length - 1);
    expect(attempt.weakTopics).toContain("weather");
  });
});
