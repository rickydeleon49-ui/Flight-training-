import type { PracticeResponse, PracticeTestItem } from "@/domain/types";
import { ACS_TASK_CATALOG } from "./acsTaskCatalog";

/** The FAA knowledge test pass mark; a practice area under it is "weak". */
export const PASS_PERCENT = 70;

export interface WeakArea {
  /** ACS task code, or "" for questions without one. */
  code: string;
  title: string;
  correct: number;
  total: number;
  percent: number;
  weak: boolean;
}

/**
 * Groups a finished test's questions by their ACS task, weakest first (ties by
 * code, "Other" last). Unanswered and "don't know" count as not correct.
 */
export function practiceWeakAreas(
  items: readonly PracticeTestItem[],
  responses: readonly Pick<PracticeResponse, "itemId" | "isCorrect">[],
): WeakArea[] {
  const correctIds = new Set(responses.filter((r) => r.isCorrect).map((r) => r.itemId));
  const groups = new Map<string, { correct: number; total: number }>();
  for (const item of items) {
    const code = ACS_TASK_CATALOG.some((t) => t.code === item.acsTask) ? item.acsTask! : "";
    const group = groups.get(code) ?? { correct: 0, total: 0 };
    group.total += 1;
    if (correctIds.has(item.id)) group.correct += 1;
    groups.set(code, group);
  }
  return [...groups].map(([code, { correct, total }]) => {
    const percent = Math.round((correct / total) * 100);
    return {
      code,
      title: code ? ACS_TASK_CATALOG.find((t) => t.code === code)!.title : "Other",
      correct, total, percent, weak: percent < PASS_PERCENT,
    };
  }).sort((a, b) =>
    Number(a.code === "") - Number(b.code === "") || a.percent - b.percent || a.code.localeCompare(b.code));
}
