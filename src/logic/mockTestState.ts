import type { MockTestRun, MockTestState, QuestionBookmark } from "@/domain/types";

/** Finished mock runs kept (newest first). */
export const MOCK_LAST_CAP = 5;
export const MOCK_QUESTION_CAP = 100;
export const BOOKMARK_CAP = 100;

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const validTime = (v: unknown): v is string => nonEmpty(v) && Number.isFinite(Date.parse(v));

/** A run, or null when it is unusable. Answers and flags only for frozen questions. */
export function normalizeMockRun(value: unknown): MockTestRun | null {
  if (!isObject(value)) return null;
  if (!Array.isArray(value.questionIds) || !validTime(value.startedAt) || !validTime(value.deadline)) {
    return null;
  }
  const questionIds = [...new Set(value.questionIds.filter(nonEmpty))].slice(0, MOCK_QUESTION_CAP);
  if (questionIds.length === 0) return null;
  const known = new Set(questionIds);
  const answers: Record<string, string> = {};
  if (isObject(value.answers)) {
    for (const [id, choice] of Object.entries(value.answers)) {
      if (known.has(id) && nonEmpty(choice)) answers[id] = choice;
    }
  }
  const flags = Array.isArray(value.flags)
    ? [...new Set(value.flags.filter((id): id is string => nonEmpty(id) && known.has(id)))]
    : [];
  const rawIndex = Number(value.index);
  const index = Number.isInteger(rawIndex) ? Math.min(questionIds.length - 1, Math.max(0, rawIndex)) : 0;
  return {
    questionIds,
    answers,
    flags,
    index,
    startedAt: value.startedAt,
    deadline: value.deadline,
    ...(validTime(value.finishedAt) ? { finishedAt: value.finishedAt } : {}),
  };
}

/** Undefined when there is nothing usable, so the field is left out. */
export function normalizeMockTest(value: unknown): MockTestState | undefined {
  if (!isObject(value)) return undefined;
  const current = normalizeMockRun(value.current);
  const last = (Array.isArray(value.last) ? value.last : [])
    .map(normalizeMockRun)
    .filter((run): run is MockTestRun => run !== null && !!run.finishedAt)
    .slice(0, MOCK_LAST_CAP);
  if (!current && last.length === 0) return undefined;
  // A current run that already has finishedAt is history, not in progress.
  return {
    ...(current && !current.finishedAt ? { current } : {}),
    last,
  };
}

export function normalizeQuestionBookmarks(value: unknown): QuestionBookmark[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const out: QuestionBookmark[] = [];
  for (const item of value) {
    if (!isObject(item) || !nonEmpty(item.questionId) || !nonEmpty(item.materialId)) continue;
    const key = `${item.materialId}\u0000${item.questionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ questionId: item.questionId, materialId: item.materialId });
    if (out.length >= BOOKMARK_CAP) break;
  }
  return out.length ? out : undefined;
}

/** Adds or removes a bookmark. `full` is true when an add was refused by the cap. */
export function toggleBookmark(
  list: readonly QuestionBookmark[], mark: QuestionBookmark,
): { list: QuestionBookmark[]; full: boolean } {
  const same = (b: QuestionBookmark) => b.questionId === mark.questionId && b.materialId === mark.materialId;
  if (list.some(same)) return { list: list.filter((b) => !same(b)), full: false };
  if (list.length >= BOOKMARK_CAP) return { list: [...list], full: true };
  return { list: [...list, mark], full: false };
}
