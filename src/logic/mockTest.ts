import type { MockTestRun, PracticeQuestion, PracticeTest, StudyMaterial } from "@/domain/types";
import { PRIVATE_AIRPLANE_ACS_AREAS } from "./acsAreaMaterialCoverage";
import { normalizeAcsTask } from "./acsTaskCatalog";
import { PASS_PERCENT } from "./practiceWeakAreas";

export const MOCK_MAX_QUESTIONS = 60;
/** Owner decision: 150 minutes for 60 questions = 2.5 minutes per question. */
export const MOCK_SECONDS_PER_QUESTION = 150;
export const MOCK_UNTAGGED_KEY = "untagged";

/** One frozen mock question. `id` is the logical id when stored, else material plus text. */
export interface MockQuestion {
  id: string;
  materialId: string;
  materialTitle: string;
  question: PracticeQuestion;
}

export interface MockAreaRow {
  /** Roman numeral of the ACS area, or "untagged". */
  key: string;
  label: string;
  correct: number;
  total: number;
  percent: number;
}

export interface MockScore {
  correct: number;
  total: number;
  percent: number;
  /** Practice pass line (not a prediction). */
  passLine: number;
  atOrAbovePassLine: boolean;
  rows: MockAreaRow[];
  missedIds: string[];
}

/** The answer key stored in `MockTestRun.answers` for a chosen option. */
export const answerKey = (optionIndex: number): string => String(optionIndex);

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

const questionId = (materialId: string, q: PracticeQuestion): string =>
  (q as { logicalId?: string }).logicalId ?? `${materialId}:${q.question.trim().toLowerCase()}`;

const percentOf = (correct: number, total: number): number =>
  total > 0 ? Math.round((correct / total) * 100) : 0;

/**
 * Up to `cap` questions of the whole bank: no repeats, dealt round-robin across
 * materials (each pool shuffled first), then shuffled. Questions without a usable
 * answer are skipped.
 */
export function buildMockTest(
  tests: readonly PracticeTest[],
  materials: readonly StudyMaterial[],
  random: () => number = Math.random,
  cap = MOCK_MAX_QUESTIONS,
): MockQuestion[] {
  const seen = new Set<string>();
  const pools: MockQuestion[][] = [];
  for (const material of materials) {
    const pool: MockQuestion[] = [];
    for (const test of tests.filter((t) => t.sourceMaterialId === material.id)) {
      for (const question of test.questions) {
        const id = questionId(material.id, question);
        const ok = question.options.length >= 2 && question.correctIndex >= 0 && question.correctIndex < question.options.length;
        if (!ok || seen.has(id)) continue;
        seen.add(id);
        pool.push({ id, materialId: material.id, materialTitle: material.title, question });
      }
    }
    if (pool.length) pools.push(shuffle(pool, random));
  }
  const picked: MockQuestion[] = [];
  for (let round = 0; picked.length < cap; round++) {
    let any = false;
    for (const pool of pools) {
      const item = pool[round];
      if (item && picked.length < cap) { picked.push(item); any = true; }
    }
    if (!any) break;
  }
  return shuffle(picked, random);
}

export const mockSeconds = (count: number): number => Math.max(0, Math.floor(count)) * MOCK_SECONDS_PER_QUESTION;

/** h:mm:ss, never negative. */
export function formatLongClock(ms: number): string {
  const total = Math.max(0, Math.ceil((Number.isFinite(ms) ? ms : 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Area key of a question: roman numeral from its ACS task code, else "untagged". */
function areaKey(question: PracticeQuestion): string {
  const code = normalizeAcsTask(question.acsTask);
  const roman = code?.split(".")[1];
  return roman && (PRIVATE_AIRPLANE_ACS_AREAS as readonly string[]).includes(roman) ? roman : MOCK_UNTAGGED_KEY;
}

/**
 * Practice score of a run. Questions are counted in the run's frozen order;
 * unanswered counts as missed. Rows: ACS areas I..XII that have questions, then
 * "Not tagged yet".
 */
export function scoreMock(
  run: Pick<MockTestRun, "questionIds" | "answers">,
  questions: readonly MockQuestion[],
): MockScore {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const groups = new Map<string, { correct: number; total: number }>();
  const missedIds: string[] = [];
  let correct = 0;
  let total = 0;
  for (const id of run.questionIds) {
    const item = byId.get(id);
    if (!item) continue;
    total += 1;
    const hit = run.answers[id] === answerKey(item.question.correctIndex);
    const key = areaKey(item.question);
    const group = groups.get(key) ?? { correct: 0, total: 0 };
    group.total += 1;
    if (hit) { correct += 1; group.correct += 1; } else missedIds.push(id);
    groups.set(key, group);
  }
  const rows: MockAreaRow[] = [...PRIVATE_AIRPLANE_ACS_AREAS, MOCK_UNTAGGED_KEY].flatMap((key) => {
    const g = groups.get(key);
    return g ? [{
      key,
      label: key === MOCK_UNTAGGED_KEY ? "Not tagged yet" : `Area ${key}`,
      correct: g.correct, total: g.total, percent: percentOf(g.correct, g.total),
    }] : [];
  });
  const percent = percentOf(correct, total);
  return { correct, total, percent, passLine: PASS_PERCENT, atOrAbovePassLine: total > 0 && percent >= PASS_PERCENT, rows, missedIds };
}
