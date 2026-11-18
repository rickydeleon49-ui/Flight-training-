import { expect, it } from "vitest";

import { explainMetar, NOT_EXPLAINED } from "./metarExplain";
import { explainTaf } from "./tafExplain";
import { WEATHER_PRACTICE } from "./weatherPractice";

function decode(s: (typeof WEATHER_PRACTICE)[number]) {
  if (s.kind === "taf") {
    const taf = explainTaf(s.raw);
    const first = taf.periods[0]!;
    return { tokens: [...taf.header, ...taf.periods.flatMap((p) => p.tokens)], note: first.categoryNote, wind: first.tokens };
  }
  const m = explainMetar(s.raw);
  return { tokens: m.tokens, note: m.categoryNote, wind: m.tokens };
}

it("has at least 8 scenarios with unique ids and questions", () => {
  expect(WEATHER_PRACTICE.length).toBeGreaterThanOrEqual(8);
  expect(new Set(WEATHER_PRACTICE.map((s) => s.id)).size).toBe(WEATHER_PRACTICE.length);
  for (const s of WEATHER_PRACTICE) {
    expect(s.questions.length).toBeGreaterThanOrEqual(1);
    expect(s.questions.length).toBeLessThanOrEqual(2);
  }
});

it("every scenario decodes fully and its fields match the decoder", () => {
  for (const s of WEATHER_PRACTICE) {
    const d = decode(s);
    expect(d.tokens.length).toBeGreaterThan(0);
    expect(d.tokens.filter((t) => t.meaning.includes(NOT_EXPLAINED)), s.id).toEqual([]);
    const ceil = s.ceilingFt === undefined ? "no ceiling" : `ceiling ${s.ceilingFt.toLocaleString("en-US")} ft`;
    expect(d.note, s.id).toContain(ceil);
    if (s.visibilitySm !== undefined) expect(d.note, s.id).toContain(`visibility ${s.visibilitySm} SM`);
    const windMeaning = d.wind.find((t) => /wind/i.test(t.meaning))?.meaning ?? "";
    const speeds = [...windMeaning.matchAll(/(\d+) knots/g)].map((m) => Number(m[1]));
    const expected = speeds.length ? Math.max(...speeds) : 0;
    expect(s.windKt ?? 0, s.id).toBe(expected);
  }
});
