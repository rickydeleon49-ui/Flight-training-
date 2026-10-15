import { describe, expect, it } from "vitest";

import { makeAction, makeEvent, makeJournalEntry, makeProfile, makeTransaction } from "@/testing/factories";
import { flightLogTotals } from "./flightLog";
import {
  buildReminders,
  DEFAULT_TOOLKIT_STATE,
  makeQuizAttempt,
  normalizeToolkitState,
  reminderLeadDays,
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

  it("forecasts remaining private-pilot planning cost from lesson cost per flight hour", () => {
    const journal = [makeJournalEntry({ eventId: "e1", totalTime: 10 })];
    const totals = flightLogTotals(journal);
    const result = trainingCostForecast(
      totals,
      [makeTransaction({ amount: 2_000_00, category: "flight_lesson", eventId: "e1" })],
      { ...DEFAULT_TOOLKIT_STATE, additionalTrainingCosts: 500_00 },
      journal,
    );
    expect(result.observedHourly).toBe(200_00);
    expect(result.observedLessons).toBe(1);
    expect(result.estimatedRemaining).toBe(6_500_00);
  });

  it("does not multiply one-off costs like a headset across every remaining flight hour", () => {
    const journal = [makeJournalEntry({ eventId: "e1", totalTime: 2 })];
    const result = trainingCostForecast(
      flightLogTotals(journal),
      [
        makeTransaction({ amount: 400_00, category: "flight_lesson", eventId: "e1" }),
        makeTransaction({ amount: 400_00, category: "headset" }),
        makeTransaction({ amount: 150_00, category: "medical" }),
      ],
      { ...DEFAULT_TOOLKIT_STATE, additionalTrainingCosts: 0 },
      journal,
    );
    expect(result.spent).toBe(950_00);
    expect(result.observedHourly).toBe(200_00);
    expect(result.estimatedRemaining).toBe(38 * 200_00);
  });

  it("uses her own hourly estimate until a lesson has both a cost and logged time", () => {
    const journal = [makeJournalEntry({ totalTime: 5 })];
    const result = trainingCostForecast(
      flightLogTotals(journal),
      [makeTransaction({ amount: 900_00, category: "flight_lesson" })],
      { ...DEFAULT_TOOLKIT_STATE, estimatedHourlyCost: 175_00, additionalTrainingCosts: 0 },
      journal,
    );
    expect(result.observedHourly).toBeNull();
    expect(result.observedLessons).toBeNull();
    expect(result.hourly).toBe(175_00);
    expect(result.estimatedRemaining).toBe(35 * 175_00);
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

describe("medical reminders", () => {
  const medical = (expiresOn: string) => ({
    id: "c1", type: "medical" as const, title: "Third class medical", identifier: "", issuedOn: null,
    expiresOn, notes: "", materialId: null,
  });

  it("lists a medical once when Settings and a saved record give the same expiry", () => {
    const reminders = buildReminders({
      actions: [], events: [], credentials: [medical("2026-10-20")],
      profile: makeProfile({ medicalExpiry: "2026-10-20" }), leadDays: 14, today: "2026-10-14",
    });
    expect(reminders.map((item) => item.title)).toEqual(["Third class medical"]);
  });

  it("keeps both when the two dates disagree, so neither is hidden", () => {
    const reminders = buildReminders({
      actions: [], events: [], credentials: [medical("2026-10-20")],
      profile: makeProfile({ medicalExpiry: "2026-10-25" }), leadDays: 14, today: "2026-10-14",
    });
    expect(reminders.map((item) => item.date)).toEqual(["2026-10-20", "2026-10-25"]);
  });
});

describe("reminderLeadDays", () => {
  it("keeps the window to whole days from 0 to 90, whatever was typed", () => {
    expect(reminderLeadDays("14")).toBe(14);
    expect(reminderLeadDays("500")).toBe(90);
    expect(reminderLeadDays("-3")).toBe(0);
    expect(reminderLeadDays("2.5")).toBe(2);
    expect(reminderLeadDays("", 0)).toBe(0);
  });

  it("falls back instead of producing a window that is not a number", () => {
    expect(reminderLeadDays("soon")).toBe(7);
    expect(reminderLeadDays(undefined)).toBe(7);
  });

  it("repairs unreadable stored toolkit numbers rather than carrying NaN into dates and money", () => {
    const state = normalizeToolkitState({
      reminderLeadDays: "soon",
      estimatedHourlyCost: "lots",
      additionalTrainingCosts: null,
    } as unknown as Parameters<typeof normalizeToolkitState>[0]);
    expect(state.reminderLeadDays).toBe(7);
    expect(state.estimatedHourlyCost).toBe(220_00);
    expect(state.additionalTrainingCosts).toBe(1_500_00);
    expect(buildReminders({ actions: [], events: [], credentials: [], profile: makeProfile(), leadDays: state.reminderLeadDays, today: "2026-10-14" })).toEqual([]);
  });
});
