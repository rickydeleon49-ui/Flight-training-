import type { AiStudySet, CompletedHistoryItem, PracticeTest, Question, ScheduleEvent, StudyMaterial } from "@/domain/types";
import { CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES, resolvePrivateAirplaneAcsCode } from "./currentPrivateAirplaneAcsCatalog";
import { attemptReviewPath } from "./practiceAttemptReview";
import { savedDestination } from "./savedSearch";

export type RelatedStudyRead<T> =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; value: T };

/** Only destinations on other pages; the guide and cards keep their Jump to chips. */
export interface RelatedStudyRow {
  kind: "review" | "question" | "lesson";
  id: string;
  label: string;
  reason: "From this material" | "Linked by you";
  target: { path: string };
}

export interface RelatedStudyInput {
  material: StudyMaterial | null;
  questions: readonly Question[];
  events: readonly ScheduleEvent[];
  recentReviews: RelatedStudyRead<readonly CompletedHistoryItem[]>;
  limit?: number;
}

/** Deliberate links only. No inference or writes. */
export function selectRelatedStudy(input: RelatedStudyInput) {
  const { material, questions, events, recentReviews } = input;
  const rows: RelatedStudyRow[] = [];
  if (!material) return { rows, hasMore: false, status: "ready" as const };
  if (recentReviews.status === "ready") {
    const review = [...recentReviews.value]
      .filter(r => r.historyKey === material.id)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.attemptId.localeCompare(a.attemptId))
      .slice(0, 10)
      .find(r => r.incorrectCount > 0 || r.dontKnowCount > 0 || r.unansweredCount > 0);
    if (review) rows.push({ kind: "review", id: review.attemptId, label: `Recent saved review: ${review.sourceMaterialTitle}`, reason: "From this material", target: { path: attemptReviewPath(review.historyKey, review.attemptId, "missed") } });
  }
  const question = questions.find(q => q.materialId === material.id && q.text.trim());
  if (question) rows.push({ kind: "question", id: question.id, label: `Instructor question: ${question.text}`, reason: "Linked by you", target: { path: savedDestination({ kind: "question", recordId: question.id, rev: null, snippet: "" }, null)! } });
  const lesson = events.find(e => e.eventType === "flight_lesson" && (e.id === material.eventId || e.materialIds.includes(material.id)));
  if (lesson) rows.push({ kind: "lesson", id: lesson.id, label: `Lesson preparation: ${lesson.title}`, reason: "Linked by you", target: { path: `/schedule/${encodeURIComponent(lesson.id)}` } });
  const limit = Number.isSafeInteger(input.limit) && input.limit! > 0 ? Math.min(input.limit!, 5) : 3;
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit, status: recentReviews.status };
}

// ACS lookup (HUB-02c): only explicit, exact material tags. A task code also
// lists materials tagged with its element codes from the catalog's own
// area/task fields — never a string-prefix match, title, note or topic.
export interface AcsRelatedStudyRow {
  kind: "material";
  id: string;
  label: string;
  reason: `Tagged: ${string}` | `From element ${string}`;
  /** Saved study counts for the material, shown quietly. */
  detail: string;
  target: { path: string };
}

export interface AcsRelatedStudyIndexInput {
  materials: readonly StudyMaterial[];
  aiStudySets?: readonly Pick<AiStudySet, "sourceMaterialId">[];
  practiceTests?: readonly Pick<PracticeTest, "sourceMaterialId">[];
  questions?: readonly Question[];
}

export type AcsRelatedStudyIndex =
  | { status: "ready"; byTag: Map<string, StudyMaterial[]>; details: Map<string, string> }
  | { status: "failed" };

export type AcsRelatedStudyGroup = {
  code: string;
  title: string | null;
  rows: AcsRelatedStudyRow[];
  hasMore: boolean;
  status: "current" | "task" | "archived" | "unresolved" | "failed";
};

const upper = (s: string) => s.replace(/[a-z]/g, c => c.toUpperCase());

const ACS_TASKS = (() => {
  const tasks = new Map<string, { title: string; elements: string[] }>();
  for (const entry of CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES) {
    const key = `PA.${entry.areaOfOperation}.${entry.task}`;
    const task = tasks.get(key) ?? { title: entry.source.task, elements: [] };
    task.elements.push(upper(entry.code));
    tasks.set(key, task);
  }
  return tasks;
})();

function plural(n: number, one: string, many: string) { return `${n} ${n === 1 ? one : many}`; }

/** One pass over the library per lookup; each code then reads only its own tags. */
export function indexAcsRelatedStudy(input: AcsRelatedStudyIndexInput): AcsRelatedStudyIndex {
  try {
    const byTag = new Map<string, StudyMaterial[]>();
    for (const material of input.materials) {
      for (const tag of new Set(material.tags.map(t => upper(t.trim())))) {
        const list = byTag.get(tag);
        if (list) list.push(material); else if (tag) byTag.set(tag, [material]);
      }
    }
    const count = (ids: (string | null)[]) => {
      const counts = new Map<string, number>();
      for (const id of ids) if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      return counts;
    };
    const sets = count((input.aiStudySets ?? []).map(s => s.sourceMaterialId));
    const tests = count((input.practiceTests ?? []).map(t => t.sourceMaterialId));
    const questions = count((input.questions ?? []).map(q => q.materialId));
    const details = new Map<string, string>();
    for (const id of new Set([...sets.keys(), ...tests.keys(), ...questions.keys()])) {
      const parts: string[] = [];
      if (sets.get(id)) parts.push(plural(sets.get(id)!, "study guide/set", "study guides/sets"));
      if (tests.get(id)) parts.push(plural(tests.get(id)!, "practice test", "practice tests"));
      if (questions.get(id)) parts.push(plural(questions.get(id)!, "instructor question", "instructor questions"));
      details.set(id, parts.join(", "));
    }
    return { status: "ready", byTag, details };
  } catch {
    return { status: "failed" };
  }
}

/**
 * Rows for one entered code; three first, then every match after Show more —
 * the lookup has always listed every tagged material. No inference or writes.
 */
export function selectAcsRelatedStudy(enteredCode: string, index: AcsRelatedStudyIndex, all = false): AcsRelatedStudyGroup {
  const max = all ? Infinity : 3;
  const resolution = resolvePrivateAirplaneAcsCode(enteredCode);
  const code = upper(enteredCode);
  const task = resolution.status === "current" ? undefined : ACS_TASKS.get(code);
  if (resolution.status !== "current" && !task) {
    return resolution.status === "archived"
      ? { status: "archived", code: resolution.entry.code, title: resolution.entry.description ?? null, rows: [], hasMore: false }
      : { status: "unresolved", code: resolution.code, title: null, rows: [], hasMore: false };
  }
  const title = task ? task.title : resolution.status === "current" ? resolution.entry.description : null;
  const shown = resolution.status === "current" ? resolution.entry.code : code;
  if (index.status === "failed") return { status: "failed", code: shown, title, rows: [], hasMore: false };
  const rows: AcsRelatedStudyRow[] = [];
  const seen = new Set<string>();
  const sources: [string, AcsRelatedStudyRow["reason"]][] = [[upper(shown), `Tagged: ${shown}`],
    ...(task?.elements ?? []).map((element): [string, AcsRelatedStudyRow["reason"]] => [element, `From element ${element}`])];
  // The first view stops once one row past three shows that more exist.
  for (const [tag, reason] of sources) {
    if (rows.length > max) break;
    for (const material of index.byTag.get(tag) ?? []) {
      if (rows.length > max) break;
      if (seen.has(material.id)) continue;
      seen.add(material.id);
      rows.push({ kind: "material", id: material.id, label: material.title, reason, detail: index.details.get(material.id) ?? "",
        target: { path: `/study/${encodeURIComponent(material.id)}` } });
    }
  }
  return { status: task ? "task" : "current", code: shown, title, rows: rows.slice(0, max), hasMore: rows.length > max };
}
