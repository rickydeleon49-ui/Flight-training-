import { afterEach, describe, expect, it, vi } from "vitest";

import type { PracticeAttempt } from "@/domain/types";

import {
  buildPracticeReadiness,
  practiceReadinessText,
  type PracticeReadinessInput,
} from "./practiceReadiness";

const TODAY = "2026-10-20";

function attempt(
  id: string,
  completedAt: string | null,
  scorePercent: number | null,
  overrides: Partial<PracticeAttempt> = {},
): PracticeAttempt {
  return {
    id,
    versionId: "v-1",
    sourceMaterialId: "mat-1",
    sourceMaterialTitle: "Weather",
    startedAt: completedAt ?? "2026-10-01T10:00:00Z",
    completedAt,
    status: "completed",
    revision: 1,
    totalQuestions: 10,
    answeredCount: 10,
    correctCount: 0,
    incorrectCount: 0,
    dontKnowCount: 0,
    scorePercent,
    ...overrides,
  };
}

function input(attempts: PracticeAttempt[], overrides: Partial<PracticeReadinessInput> = {}) {
  return {
    attempts,
    materialIds: new Set(["mat-1", "mat-2"]),
    hasPracticeTest: true,
    today: TODAY,
    ...overrides,
  };
}

function text(attempts: PracticeAttempt[], overrides: Partial<PracticeReadinessInput> = {}) {
  return practiceReadinessText(buildPracticeReadiness(input(attempts, overrides)));
}

/** n attempts on consecutive days ending yesterday, newest first, at noon UTC. */
function series(scores: number[]): PracticeAttempt[] {
  return scores.map((score, index) => {
    const day = String(19 - index).padStart(2, "0");
    return attempt(`a${index}`, `2026-10-${day}T12:00:00Z`, score);
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildPracticeReadiness", () => {
  it("nudges when she has fewer than three recent attempts and a test to take", () => {
    expect(text([])).toBe("Take a practice test to see how you're doing.");
    expect(text(series([80, 90]))).toBe("Take a practice test to see how you're doing.");
  });

  it("shows nothing when she has no practice test to take", () => {
    expect(buildPracticeReadiness(input([], { hasPracticeTest: false }))).toEqual({ kind: "none" });
    expect(text(series([80, 90]), { hasPracticeTest: false })).toBeNull();
  });

  it("summarises three attempts without a comparison", () => {
    expect(text(series([70, 80, 91]))).toBe("Your last 3 practice tests averaged 80%.");
  });

  it("still summarises when she has no practice test left but has recent attempts", () => {
    expect(text(series([70, 80, 90]), { hasPracticeTest: false })).toBe(
      "Your last 3 practice tests averaged 80%.",
    );
  });

  it("compares the last five with the up-to-five before them", () => {
    // Last 5: 90 80 80 70 70 = 78; before: 70 70 = 70.
    expect(text(series([90, 80, 80, 70, 70, 70, 70]))).toBe(
      "Your last 5 practice tests averaged 78%, up from 70%.",
    );
    // Only the five before count, not older ones.
    expect(text(series([60, 60, 60, 60, 60, 80, 80, 80, 80, 80, 10, 10]))).toBe(
      "Your last 5 practice tests averaged 60%, down from 80%.",
    );
  });

  it("calls equal rounded averages steady", () => {
    expect(text(series([70, 70, 70, 70, 70, 70.4]))).toBe(
      "Your last 5 practice tests averaged 70%, about the same as before.",
    );
  });

  it("orders attempts with the same completion time by id, newest id first", () => {
    const same = "2026-10-19T12:00:00Z";
    const attempts = [
      attempt("a", same, 0),
      attempt("f", same, 100),
      attempt("c", same, 100),
      attempt("e", same, 100),
      attempt("b", same, 0),
      attempt("d", same, 100),
    ];
    // f e d c b are the newest five; a is the one before.
    expect(buildPracticeReadiness(input(attempts))).toEqual({
      kind: "summary",
      recentAverage: 80,
      recentCount: 5,
      previousAverage: 0,
      trend: "up",
    });
    expect(buildPracticeReadiness(input([...attempts].reverse()))).toEqual(
      buildPracticeReadiness(input(attempts)),
    );
  });

  it("leaves out unfinished and abandoned attempts", () => {
    const attempts = [
      ...series([80, 80]),
      attempt("p1", "2026-10-10T12:00:00Z", 50, { status: "in_progress" }),
      attempt("p2", "2026-10-10T12:00:00Z", 50, { status: "abandoned" }),
      attempt("p4", "2026-10-10T12:00:00Z", null),
      attempt("p5", null, 50),
      attempt("p6", "2026-10-10T12:00:00Z", 0, { totalQuestions: 0, answeredCount: 0 }),
    ];
    expect(buildPracticeReadiness(input(attempts))).toEqual({ kind: "nudge" });
  });

  it("counts a finished attempt with skipped questions at its stored score (skips count as wrong)", () => {
    expect(text([...series([80, 80]), attempt("p3", "2026-10-10T12:00:00Z", 50, { answeredCount: 6 })])).toBe(
      "Your last 3 practice tests averaged 70%.",
    );
  });

  it("leaves out attempts on deleted materials", () => {
    const attempts = [
      ...series([80, 80]),
      attempt("gone", "2026-10-10T12:00:00Z", 10, { sourceMaterialId: null }),
      attempt("other", "2026-10-10T12:00:00Z", 10, { sourceMaterialId: "deleted" }),
    ];
    expect(buildPracticeReadiness(input(attempts))).toEqual({ kind: "nudge" });
    expect(
      text([...series([80, 80]), attempt("m2", "2026-10-10T12:00:00Z", 50, { sourceMaterialId: "mat-2" })]),
    ).toBe("Your last 3 practice tests averaged 70%.");
  });

  it("counts only the last 30 local days, today included", () => {
    const attempts = [
      attempt("today", "2026-10-20T12:00:00Z", 90),
      attempt("edge", "2026-09-21T12:00:00Z", 90),
      attempt("old", "2026-09-20T12:00:00Z", 90),
      attempt("future", "2026-10-22T12:00:00Z", 90),
    ];
    expect(buildPracticeReadiness(input(attempts))).toEqual({ kind: "nudge" });
    expect(text([...attempts, attempt("mid", "2026-10-01T12:00:00Z", 60)])).toBe(
      "Your last 3 practice tests averaged 80%.",
    );
  });

  it("reads the window in her local time zone, not UTC", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    // 03:00 UTC on 21 September is still 20 September in California: outside.
    const attempts = [
      ...series([80, 80]),
      attempt("late", "2026-09-21T03:00:00Z", 80),
    ];
    expect(buildPracticeReadiness(input(attempts))).toEqual({ kind: "nudge" });
    // 03:00 UTC on 21 October is 20 October (today) in California: inside.
    expect(text([...series([80, 80]), attempt("eve", "2026-10-21T03:00:00Z", 80)])).toBe(
      "Your last 3 practice tests averaged 80%.",
    );
  });

  it("never mentions passing, failing or an official score", () => {
    const words = [
      text([]),
      text(series([90, 80, 70])),
      text(series([90, 90, 90, 90, 90, 50])),
      text(series([50, 50, 50, 50, 50, 90])),
      text(series([70, 70, 70, 70, 70, 70])),
    ].join(" ");
    expect(words).not.toMatch(/pass|fail|ready|official|predict|FAA/i);
  });
});
