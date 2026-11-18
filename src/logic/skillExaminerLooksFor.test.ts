import { describe, expect, it } from "vitest";

import { SKILL_ACS_TASKS, examinerLooksFor } from "./skillExaminerLooksFor";

describe("examinerLooksFor", () => {
  it("resolves every mapped skill to non-empty skill lines", () => {
    for (const skillId of Object.keys(SKILL_ACS_TASKS)) {
      const tasks = examinerLooksFor(skillId);
      expect(tasks.length, skillId).toBe(SKILL_ACS_TASKS[skillId]!.length);
      for (const task of tasks) {
        expect(task.lines.length, `${skillId} ${task.code}`).toBeGreaterThan(0);
        for (const line of task.lines) {
          expect(line.code.startsWith(`${task.code}.S`), line.code).toBe(true);
          expect(line.code.slice(task.code.length + 2)).toMatch(/^\d/);
        }
      }
    }
  });

  it("reads the existing catalog lines and labels the task", () => {
    const [task] = examinerLooksFor("builtin.steep_turns");
    expect(task!.label).toBe("Area V Task A");
    expect(task!.lines[0]).toEqual({ code: "PA.V.A.S1", text: "Clear the area." });
  });

  it("drops lines meant only for seaplane or multiengine, keeps mixed ones", () => {
    const lines = examinerLooksFor("builtin.normal_takeoff")[0]!.lines;
    expect(lines.some((l) => l.code === "PA.IV.A.S8")).toBe(false);
    expect(lines.some((l) => l.code === "PA.IV.A.S6")).toBe(true);
  });

  it("returns nothing for custom or unmapped skills", () => {
    expect(examinerLooksFor("builtin.checklist_use")).toEqual([]);
    expect(examinerLooksFor("custom.00000000-0000-4000-8000-000000000000")).toEqual([]);
  });
});
