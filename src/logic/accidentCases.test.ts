import { expect, it } from "vitest";

import { ACCIDENT_CASES } from "./accidentCases";

it("has 15 to 25 cases with unique, well-formed NTSB numbers", () => {
  expect(ACCIDENT_CASES.length).toBeGreaterThanOrEqual(15);
  expect(ACCIDENT_CASES.length).toBeLessThanOrEqual(25);
  const numbers = ACCIDENT_CASES.map((c) => c.ntsbNumber);
  expect(new Set(numbers).size).toBe(numbers.length);
  for (const n of numbers) expect(n).toMatch(/^[A-Z]{3}\d{2}[A-Z]{2}\d{3}$/);
});

it("fills every field", () => {
  for (const c of ACCIDENT_CASES) {
    for (const v of [c.aircraft, c.phase, c.whatHappened, c.probableCause, c.lesson, c.question]) {
      expect(v.trim().length).toBeGreaterThan(0);
    }
    expect(c.year).toBeGreaterThanOrEqual(2008);
  }
});
