import { expect, it } from "vitest";

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
