import { expect, it } from "vitest";

import { DIAGRAMS } from "./diagrams";
import { REG_CARDS } from "./regCards";

it("reg cards are unique and well formed", () => {
  const ids = REG_CARDS.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBeGreaterThanOrEqual(18);
  for (const c of REG_CARDS) {
    expect(c.reg.startsWith("14 CFR")).toBe(true);
    expect(c.prompt.length).toBeGreaterThan(10);
    expect(c.answer.length).toBeGreaterThan(10);
  }
});

it("scenario cards cite a paragraph and point at a real diagram", () => {
  const scenarios = REG_CARDS.filter((c) => c.scenario);
  expect(scenarios.length).toBeGreaterThanOrEqual(10);
  for (const c of scenarios) {
    expect(c.reg).toMatch(/^14 CFR 91\.15[57]/);
    expect(DIAGRAMS.some((d) => d.id === c.diagramId)).toBe(true);
  }
});

it("has the 91.213(d) card", () => {
  expect(REG_CARDS.some((c) => c.id === "inop-equipment" && c.reg === "14 CFR 91.213(d)")).toBe(true);
});
