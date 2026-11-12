import { expect, it } from "vitest";
import type { PracticeResponse, PracticeTestItem } from "@/domain/types";
import { practiceWeakAreas } from "./practiceWeakAreas";

const item = (n: number, acsTask?: string): PracticeTestItem => ({
  id: `i${n}`, versionId: "v", ordinal: n, questionText: "q", options: ["a", "b"], correctIndex: 0,
  explanation: "", sourcePage: null, acsTask,
});
const ok = (n: number): PracticeResponse => ({
  id: `r${n}`, attemptId: "a", itemId: `i${n}`, selectedIndex: 0, isDontKnow: false, isCorrect: true, answeredAt: "2026-11-01T10:00:00Z",
});

it("groups by ACS task, weakest first, uncoded questions last as Other", () => {
  const items = [item(1, "PA.I.C"), item(2, "PA.I.C"), item(3, "PA.I.A"), item(4, "PA.I.A"), item(5), item(6, "bogus")];
  const areas = practiceWeakAreas(items, [ok(1), ok(3), ok(4)]);
  expect(areas.map((a) => [a.code, a.correct, a.total, a.weak])).toEqual([
    ["PA.I.C", 1, 2, true], ["PA.I.A", 2, 2, false], ["", 0, 2, true],
  ]);
  expect(areas[0]!.title).toBe("Weather Information");
  expect(areas[2]!.title).toBe("Other");
});
