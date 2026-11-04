import type {
  PracticeQuestion,
  PracticeResponse,
  PracticeTest,
  PracticeTestItem,
  StudyMaterial,
} from "@/domain/types";
import { buildAttemptReview } from "./practiceAttemptReview";

export const MIXED_MIN_MATERIALS = 2;
export const MIXED_MAX_QUESTIONS = 20;

export interface MixedQuestion { question: PracticeQuestion; materialId: string; materialTitle: string }
export interface MixedChoice { materialId: string; title: string; questionCount: number }

/** Materials the student owns that already have practice questions. */
export function mixedChoices(tests: readonly PracticeTest[], materials: readonly StudyMaterial[]): MixedChoice[] {
  const out: MixedChoice[] = [];
  for (const material of materials) {
    const count = tests.filter((t) => t.sourceMaterialId === material.id)
      .reduce((sum, t) => sum + t.questions.length, 0);
    if (count > 0) out.push({ materialId: material.id, title: material.title, questionCount: count });
  }
  return out;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/**
 * Takes the existing saved questions of the chosen materials only, deals them
 * round-robin so each material is spread evenly, caps the total, then shuffles.
 * Returns [] when fewer than two materials are chosen.
 */
export function buildMixedTest(
  tests: readonly PracticeTest[],
  materials: readonly StudyMaterial[],
  chosenIds: readonly string[],
  random: () => number = Math.random,
  cap = MIXED_MAX_QUESTIONS,
): MixedQuestion[] {
  const ids = [...new Set(chosenIds)];
  if (ids.length < MIXED_MIN_MATERIALS) return [];
  const pools = ids.flatMap((id) => {
    const material = materials.find((m) => m.id === id);
    if (!material) return [];
    const list = tests.filter((t) => t.sourceMaterialId === id).flatMap((t) => t.questions)
      .map((question) => ({ question, materialId: id, materialTitle: material.title }));
    return list.length ? [shuffle(list, random)] : [];
  });
  if (pools.length < MIXED_MIN_MATERIALS) return [];
  const picked: MixedQuestion[] = [];
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

/**
 * MISSED-AGAIN-01: the questions of one finished attempt that the student answered
 * wrong or marked "don't know", in the test's own order, ready for a quick
 * unsaved retry. Correct and unanswered questions are left out, and so is any
 * frozen item whose correct answer is not one of its own options.
 */
export function missedAgainQuestions(
  attemptId: string,
  items: readonly PracticeTestItem[],
  responses: readonly PracticeResponse[],
  materialId: string,
  materialTitle: string,
): MixedQuestion[] {
  return buildAttemptReview(attemptId, items, responses)
    .filter((entry) => entry.outcome === "incorrect" || entry.outcome === "dont_know")
    .filter(({ item }) => item.options.length >= 2
      && Number.isInteger(item.correctIndex) && item.correctIndex >= 0 && item.correctIndex < item.options.length)
    .map(({ item }) => ({
      question: {
        question: item.questionText,
        options: [...item.options],
        correctIndex: item.correctIndex,
        explanation: item.explanation,
        sourcePage: item.sourcePage,
      },
      materialId,
      materialTitle,
    }));
}
