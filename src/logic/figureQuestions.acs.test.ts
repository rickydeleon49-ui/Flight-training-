import { describe, expect, it } from "vitest";
import { ACS_TASK_CATALOG, normalizeAcsTask } from "./acsTaskCatalog";
import { FIGURE_QUESTIONS } from "./figureQuestions";

describe("figure question ACS tags", () => {
  it("every tag is a catalog task", () => {
    for (const q of FIGURE_QUESTIONS) {
      if (!q.acsTask) continue;
      expect(normalizeAcsTask(q.acsTask)).toBe(q.acsTask);
      expect(ACS_TASK_CATALOG.some(t => t.code === q.acsTask)).toBe(true);
    }
  });
  it("at least 90 percent are tagged", () => {
    const tagged = FIGURE_QUESTIONS.filter(q => q.acsTask).length;
    expect(tagged / FIGURE_QUESTIONS.length).toBeGreaterThanOrEqual(0.9);
  });
});
