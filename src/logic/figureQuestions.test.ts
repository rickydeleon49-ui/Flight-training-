import { expect, it } from "vitest";
import { getFigure } from "./figures";
import { FIGURE_QUESTIONS } from "./figureQuestions";

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
