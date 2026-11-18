import { expect, it } from "vitest";
import { getFigure } from "./figures";
import { FIGURE_QUESTIONS } from "./figureQuestions";
import { windComponents } from "./performanceAid";

it("every figure question points at a real figure and has a valid answer", () => {
  expect(FIGURE_QUESTIONS.length).toBeGreaterThanOrEqual(3);
  for (const q of FIGURE_QUESTIONS) {
    expect(q.figureId && getFigure(q.figureId), q.question).toBeTruthy();
    expect(q.options.length).toBeGreaterThanOrEqual(2);
    expect(q.correctIndex).toBeGreaterThanOrEqual(0);
    expect(q.correctIndex).toBeLessThan(q.options.length);
    expect(q.explanation.trim()).not.toBe("");
    expect(q.sourcePage).toBeNull();
  }
  expect(new Set(FIGURE_QUESTIONS.map((q) => q.question)).size).toBe(FIGURE_QUESTIONS.length);
});

// Inputs for each Figure 36 chart-reading question, checked against the arithmetic in performanceAid.
const CROSSWIND_INPUTS: { text: string; runway: number; windDir: number; speed: number; part: "crosswind" | "headwind"; answer: number }[] = [
  { text: "30 knot wind give when it is 40 degrees", runway: 36, windDir: 320, speed: 30, part: "crosswind", answer: 19 },
  { text: "20 knot wind give when it is 30 degrees", runway: 9, windDir: 60, speed: 20, part: "headwind", answer: 17 },
  { text: "30 knot wind give when it is 70 degrees", runway: 27, windDir: 340, speed: 30, part: "crosswind", answer: 28 },
  { text: "40 knot wind give when it is only 10 degrees", runway: 18, windDir: 190, speed: 40, part: "crosswind", answer: 7 },
  { text: "50 knot wind give when it is 40 degrees", runway: 9, windDir: 130, speed: 50, part: "headwind", answer: 38 },
];

it("crosswind chart questions agree with windComponents within chart-reading tolerance", () => {
  for (const row of CROSSWIND_INPUTS) {
    const q = FIGURE_QUESTIONS.find((x) => x.figureId === "faa-36" && x.question.includes(row.text));
    expect(q, row.text).toBeTruthy();
    const w = windComponents(row.runway, row.windDir, row.speed)!;
    const expected = row.part === "crosswind" ? w.crosswind : w.headwind;
    expect(Math.abs(expected - row.answer), row.text).toBeLessThanOrEqual(2);
    const shown = Number(/(\d+)/.exec(q!.options[q!.correctIndex]!)?.[1]);
    expect(Math.abs(shown - expected), row.text).toBeLessThanOrEqual(2);
    for (const [i, o] of q!.options.entries()) {
      if (i === q!.correctIndex) continue;
      expect(Math.abs(Number(/(\d+)/.exec(o!)?.[1]) - expected), o).toBeGreaterThan(4);
    }
  }
});
