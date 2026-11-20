import type { OralRating, PracticeResponse, PracticeTestItem } from "@/domain/types";
import { PRIVATE_AIRPLANE_ACS_AREAS, summarizeAcsAreaMaterialCoverage } from "./acsAreaMaterialCoverage";
import { practiceWeakAreas } from "./practiceWeakAreas";

/** Practice answers needed in an area before a percent is shown. */
export const MIN_AREA_ANSWERS = 5;
/** Practice answers needed in one task before it can be the "next look". */
export const MIN_TASK_ANSWERS = 3;

/** One finished practice attempt, as practiceSessions getItems / getResponses return it. */
export interface ReadinessAttempt {
  items: readonly PracticeTestItem[];
  responses: readonly Pick<PracticeResponse, "itemId" | "isCorrect">[];
}

/** One answered question of the last finished mock, with its ACS task already looked up. */
export interface ReadinessMockRow {
  acsTask?: string | null;
  correct: boolean;
}

export interface AcsReadinessInput {
  /** The last finished practice attempts (the caller takes the newest 20). */
  attempts: readonly ReadinessAttempt[];
  /** Answered rows of the last finished mock, if any. */
  mockRows?: readonly ReadinessMockRow[];
  oralRatings?: readonly OralRating[];
}

export interface AcsAreaRow {
  /** Area code such as "PA.I". */
  area: string;
  title: string;
  /** Practice percent, or null under MIN_AREA_ANSWERS answers ("Not enough practice yet"). */
  percent: number | null;
  answered: number;
  oralRated: number;
  oralSatisfactory: number;
  /** Weakest task code with at least MIN_TASK_ANSWERS answers, else null. */
  nextLook: string | null;
}

interface Tally { correct: number; total: number }

/** "PA.IV.C" -> "PA.IV"; null when the code does not look like a task code. */
function areaOf(code: string): string | null {
  const parts = code.split(".");
  return parts.length >= 3 ? parts.slice(0, 2).join(".") : null;
}

function addTo(tasks: Map<string, Tally>, code: string, correct: number, total: number): void {
  const t = tasks.get(code) ?? { correct: 0, total: 0 };
  t.correct += correct;
  t.total += total;
  tasks.set(code, t);
}

/** Latest rating per scenario wins: newest date, and for the same date the later list entry. */
function latestOralRatings(ratings: readonly OralRating[]): OralRating[] {
  const latest = new Map<string, OralRating>();
  for (const r of ratings) {
    const prev = latest.get(r.scenarioId);
    if (!prev || r.date >= prev.date) latest.set(r.scenarioId, r);
  }
  return [...latest.values()];
}

/**
 * Per-area practice numbers for the 12 Private Airplane areas. Untagged
 * questions are ignored. These are practice numbers only, not a prediction.
 */
export function acsReadiness(input: AcsReadinessInput): AcsAreaRow[] {
  const tasks = new Map<string, Tally>();
  for (const attempt of input.attempts) {
    for (const g of practiceWeakAreas(attempt.items, attempt.responses)) {
      if (g.code) addTo(tasks, g.code, g.correct, g.total);
    }
  }
  for (const row of input.mockRows ?? []) {
    if (row.acsTask) addTo(tasks, row.acsTask, row.correct ? 1 : 0, 1);
  }
  const oral = latestOralRatings(input.oralRatings ?? []);

  return summarizeAcsAreaMaterialCoverage().map((summary, i) => {
    const area = `PA.${PRIVATE_AIRPLANE_ACS_AREAS[i]}`;
    const inArea = [...tasks].filter(([code]) => areaOf(code) === area);
    const answered = inArea.reduce((n, [, t]) => n + t.total, 0);
    const correct = inArea.reduce((n, [, t]) => n + t.correct, 0);
    const next = inArea
      .filter(([, t]) => t.total >= MIN_TASK_ANSWERS)
      .map(([code, t]) => ({ code, percent: t.correct / t.total }))
      .sort((a, b) => a.percent - b.percent || a.code.localeCompare(b.code))[0];
    const rated = oral.filter((r) => r.area === area);
    return {
      area,
      title: summary.areaLabel.replace(/^Area of Operation [IVX]+:\s*/, ""),
      percent: answered >= MIN_AREA_ANSWERS ? Math.round((correct / answered) * 100) : null,
      answered,
      oralRated: rated.length,
      oralSatisfactory: rated.filter((r) => r.rating === "Satisfactory").length,
      nextLook: next?.code ?? null,
    };
  });
}
