import { describe, expect, it } from "vitest";
import type { OralRating, PracticeTestItem } from "@/domain/types";
import { acsReadiness, type ReadinessAttempt } from "./acsReadiness";

const item = (id: string, acsTask?: string | null) => ({ id, acsTask }) as PracticeTestItem;
const attempt = (rows: [string | null | undefined, boolean][]): ReadinessAttempt => ({
  items: rows.map(([t], i) => item(`i${i}`, t)),
  responses: rows.map(([, ok], i) => ({ itemId: `i${i}`, isCorrect: ok })),
});
const rate = (scenarioId: string, area: string, rating: OralRating["rating"], date: string): OralRating =>
  ({ scenarioId, title: scenarioId, area, rating, date });
const row = (rows: ReturnType<typeof acsReadiness>, area: string) => rows.find((r) => r.area === area)!;

describe("acsReadiness", () => {
  it("returns 12 empty rows with no data", () => {
    const rows = acsReadiness({ attempts: [] });
    expect(rows).toHaveLength(12);
    expect(rows[0]!.area).toBe("PA.I");
    expect(rows[0]!.title).toBe("Preflight Preparation");
    for (const r of rows) {
      expect(r).toMatchObject({ percent: null, answered: 0, oralRated: 0, oralSatisfactory: 0, nextLook: null });
    }
  });

  it("ignores untagged and unknown-task questions", () => {
    const rows = acsReadiness({
      attempts: [attempt([[null, true], [undefined, true], ["XX.9.Z", true]])],
      mockRows: [{ acsTask: null, correct: true }],
    });
    expect(rows.every((r) => r.answered === 0 && r.nextLook === null)).toBe(true);
  });

  it("shows a percent only from 5 answers in an area", () => {
    const four = acsReadiness({ attempts: [attempt([["PA.I.A", true], ["PA.I.A", true], ["PA.I.B", true], ["PA.I.B", false]])] });
    expect(row(four, "PA.I")).toMatchObject({ percent: null, answered: 4 });
    const five = acsReadiness({
      attempts: [attempt([["PA.I.A", true], ["PA.I.A", true], ["PA.I.B", true], ["PA.I.B", false]])],
      mockRows: [{ acsTask: "PA.I.C", correct: false }],
    });
    expect(row(five, "PA.I")).toMatchObject({ percent: 60, answered: 5 });
  });

  it("picks the weakest task with 3+ answers, ties by code", () => {
    const tied = attempt([
      ["PA.I.B", true], ["PA.I.B", false], ["PA.I.B", true],
      ["PA.I.A", true], ["PA.I.A", false], ["PA.I.A", true],
      ["PA.I.C", false], ["PA.I.C", false], // weakest but only 2 answers
    ]);
    expect(row(acsReadiness({ attempts: [tied] }), "PA.I").nextLook).toBe("PA.I.A");
    const weaker = attempt([["PA.I.C", false], ["PA.I.C", false], ["PA.I.C", true]]);
    expect(row(acsReadiness({ attempts: [tied, weaker] }), "PA.I").nextLook).toBe("PA.I.C");
  });

  it("counts the latest oral rating per scenario", () => {
    const rows = acsReadiness({
      oralRatings: [
        rate("s1", "PA.II", "Needs work", "2026-11-01"),
        rate("s1", "PA.II", "Satisfactory", "2026-11-05"),
        rate("s2", "PA.II", "Satisfactory", "2026-11-02"),
        rate("s2", "PA.II", "Needs work", "2026-11-02"),
        rate("s3", "PA.III", "Satisfactory", "2026-11-03"),
      ],
      attempts: [],
    });
    expect(row(rows, "PA.II")).toMatchObject({ oralRated: 2, oralSatisfactory: 1 });
    expect(row(rows, "PA.III")).toMatchObject({ oralRated: 1, oralSatisfactory: 1 });
  });
});
