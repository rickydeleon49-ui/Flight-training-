import { expect, it } from "vitest";
import { pickMockOral } from "./oralPractice";

const list = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}` }));

it("gives nothing below 3 scenarios", () => {
  expect(pickMockOral(list(2), new Map())).toEqual([]);
});
it("never-practised first in list order, capped at 5", () => {
  expect(pickMockOral(list(7), new Map()).map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4", "s5"]);
  expect(pickMockOral(list(3), new Map())).toHaveLength(3);
});
it("then least recently practised first", () => {
  const last = new Map([["s1", "2026-11-05T10:00:00Z"], ["s2", "2026-11-01T10:00:00Z"], ["s3", "2026-11-09T10:00:00Z"], ["s4", "2026-11-03T10:00:00Z"]]);
  expect(pickMockOral(list(4), last).map((s) => s.id)).toEqual(["s2", "s4", "s1", "s3"]);
  const some = new Map([["s1", "2026-11-05T10:00:00Z"]]);
  expect(pickMockOral(list(4), some).map((s) => s.id)).toEqual(["s2", "s3", "s4", "s1"]);
});
