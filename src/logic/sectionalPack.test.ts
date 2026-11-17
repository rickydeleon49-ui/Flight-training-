import { expect, it } from "vitest";
import { FAA_FIGURES } from "./figures";
import { SECTIONAL_PACK, getSectionalFigure } from "./sectionalPack";
import { SECTIONAL_QUESTIONS } from "./sectionalQuestions";

it("pack data is well formed", () => {
  expect(SECTIONAL_PACK.id).toBe("sectionals-v1");
  expect(SECTIONAL_PACK.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(SECTIONAL_PACK.url.startsWith("https://github.com/")).toBe(true);
  expect(SECTIONAL_PACK.bytes).toBeGreaterThan(0);
  const ids = SECTIONAL_PACK.figures.map((x) => x.id);
  expect(new Set(ids).size).toBe(ids.length);
  const bundled = new Set(FAA_FIGURES.map((x) => x.id));
  for (const fig of SECTIONAL_PACK.figures) {
    expect(bundled.has(fig.id), fig.id).toBe(false);
    expect(fig.file).toBe(`${fig.id}.webp`);
    expect(fig.width).toBeGreaterThan(0);
    expect(getSectionalFigure(fig.id)).toBe(fig);
  }
});

it("every sectional question points into the pack and has a valid answer", () => {
  expect(SECTIONAL_QUESTIONS.length).toBeGreaterThanOrEqual(18);
  for (const q of SECTIONAL_QUESTIONS) {
    expect(q.figureId && getSectionalFigure(q.figureId), q.question).toBeTruthy();
    expect(q.options.length).toBe(3);
    expect(q.correctIndex).toBeGreaterThanOrEqual(0);
    expect(q.correctIndex).toBeLessThan(q.options.length);
    expect(q.explanation.trim()).not.toBe("");
    expect(q.sourcePage).toBeNull();
  }
  expect(new Set(SECTIONAL_QUESTIONS.map((q) => q.question)).size).toBe(SECTIONAL_QUESTIONS.length);
});
