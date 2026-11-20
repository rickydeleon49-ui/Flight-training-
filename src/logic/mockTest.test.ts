import { describe, expect, it } from "vitest";
import type { PracticeQuestion, PracticeTest, StudyMaterial } from "@/domain/types";
import { FIGURE_QUESTIONS } from "./figureQuestions";
import { MOCK_MAX_FIGURE_QUESTIONS, answerKey, buildMockTest, formatLongClock, mockSeconds, scoreMock } from "./mockTest";

function seeded(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}
const mat = (id: string) => ({ id, title: `M ${id}` }) as unknown as StudyMaterial;
const q = (text: string, acsTask?: string): PracticeQuestion =>
  ({ question: text, options: ["a", "b", "c"], correctIndex: 1, explanation: "", sourcePage: null, acsTask });
const test = (materialId: string, n: number, prefix = materialId): PracticeTest =>
  ({ sourceMaterialId: materialId, title: "t", provider: "manual", model: "", generatedAt: "", updatedAt: "",
    questions: Array.from({ length: n }, (_, i) => q(`${prefix} q${i}`)) }) as unknown as PracticeTest;

describe("figure questions in the mock", () => {
  const materials = [mat("a")];
  const figs = (out: ReturnType<typeof buildMockTest>) => out.filter((x) => x.question.figureId);
  it("mixes at most 8 into a full mock and keeps their figureId", () => {
    const out = buildMockTest([test("a", 100)], materials, seeded(5));
    expect(out).toHaveLength(60);
    expect(figs(out)).toHaveLength(MOCK_MAX_FIGURE_QUESTIONS);
    expect(new Set(out.map((x) => x.id)).size).toBe(60);
    expect(figs(out).every((x) => FIGURE_QUESTIONS.some((f) => f.figureId === x.question.figureId))).toBe(true);
  });
  it("a small bank fills from figure questions only up to the cap", () => {
    const out = buildMockTest([test("a", 10)], materials, seeded(6));
    expect(out).toHaveLength(18);
    expect(figs(out)).toHaveLength(8);
    expect(buildMockTest([], materials, seeded(6))).toHaveLength(8);
  });
  it("the id lookup (infinite cap) keeps every figure question", () => {
    expect(figs(buildMockTest([test("a", 3)], materials, () => 0.5, Number.POSITIVE_INFINITY))).toHaveLength(FIGURE_QUESTIONS.length);
  });
  it("scores figure questions into their area or Not tagged yet", () => {
    const out = buildMockTest([], materials, seeded(7));
    const run = { questionIds: out.map((x) => x.id), answers: Object.fromEntries(out.map((x) => [x.id, answerKey(x.question.correctIndex)])) };
    const score = scoreMock(run, out);
    expect(score.total).toBe(8);
    expect(score.correct).toBe(8);
    expect(score.rows.reduce((n, r) => n + r.total, 0)).toBe(8);
  });
});

describe("buildMockTest", () => {
  const materials = [mat("a"), mat("b"), mat("c")];
  it("handles an empty bank", () => expect(buildMockTest([], materials, seeded(1), 60, [])).toEqual([]));
  it("takes all of a 12 question bank (plus figure questions)", () => {
    expect(buildMockTest([test("a", 6), test("b", 6)], materials, seeded(1), 60, [])).toHaveLength(12);
  });
  it("takes exactly 60 from a 60 bank", () => {
    const out = buildMockTest([test("a", 20), test("b", 20), test("c", 20)], materials, seeded(2));
    expect(out).toHaveLength(60);
    expect(new Set(out.map((x) => x.id)).size).toBe(60);
  });
  it("caps a 200 bank at 60, spread across materials", () => {
    const out = buildMockTest([test("a", 150), test("b", 40), test("c", 10)], materials, seeded(3), 60, []);
    expect(out).toHaveLength(60);
    const counts = ["a", "b", "c"].map((id) => out.filter((x) => x.materialId === id).length);
    expect(counts).toEqual([25, 25, 10]);
  });
  it("never repeats a question that appears in two tests", () => {
    const out = buildMockTest([test("a", 5, "same"), test("a", 5, "same")], materials, seeded(4), 60, []);
    expect(out).toHaveLength(5);
  });
  it("is deterministic with a seeded random", () => {
    const tests = [test("a", 80), test("b", 80)];
    const ids = (s: number) => buildMockTest(tests, materials, seeded(s)).map((x) => x.id);
    expect(ids(7)).toEqual(ids(7));
    expect(ids(7)).not.toEqual(ids(8));
  });
});

describe("clock", () => {
  it("is 150 seconds per question", () => {
    expect(mockSeconds(60)).toBe(9000);
    expect(mockSeconds(0)).toBe(0);
  });
  it("formats h:mm:ss", () => {
    expect(formatLongClock(9_000_000)).toBe("2:30:00");
    expect(formatLongClock(61_000)).toBe("0:01:01");
    expect(formatLongClock(-5)).toBe("0:00:00");
  });
});

describe("scoreMock", () => {
  const items = ["PA.I.A", "PA.I.B", "PA.V.A", undefined].map((code, i) =>
    ({ id: `q${i}`, materialId: "a", materialTitle: "A", question: q(`x${i}`, code) }));
  const ids = items.map((i) => i.id);
  it("groups by area, counts untagged and unanswered as missed", () => {
    const s = scoreMock({ questionIds: ids, answers: { q0: answerKey(1), q1: answerKey(0), q3: answerKey(1) } }, items);
    expect(s.correct).toBe(2);
    expect(s.total).toBe(4);
    expect(s.percent).toBe(50);
    expect(s.passLine).toBe(70);
    expect(s.atOrAbovePassLine).toBe(false);
    expect(s.missedIds).toEqual(["q1", "q2"]);
    expect(s.rows.map((r) => [r.key, r.correct, r.total])).toEqual([["I", 1, 2], ["V", 0, 1], ["untagged", 1, 1]]);
    expect(s.rows[2]!.label).toBe("Not tagged yet");
  });
  it("scores an empty run as zero", () => {
    const s = scoreMock({ questionIds: [], answers: {} }, []);
    expect(s).toMatchObject({ correct: 0, total: 0, percent: 0, rows: [], atOrAbovePassLine: false });
  });
});
