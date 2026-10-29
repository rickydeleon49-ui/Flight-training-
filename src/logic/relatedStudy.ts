import type { AiStudySet, CompletedHistoryItem, Question, ScheduleEvent, StudyMaterial } from "@/domain/types";
import { attemptReviewPath } from "./practiceAttemptReview";
import { savedDestination } from "./savedSearch";

export type RelatedStudyRead<T> =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; value: T };

export interface RelatedStudyRow {
  kind: "guide" | "cards" | "review" | "question" | "lesson";
  id: string;
  label: string;
  reason: "From this material" | "Linked by you";
  target: { heading: string } | { path: string };
}

export interface RelatedStudyInput {
  material: StudyMaterial | null;
  studySets: readonly AiStudySet[];
  questions: readonly Question[];
  events: readonly ScheduleEvent[];
  recentReviews: RelatedStudyRead<readonly CompletedHistoryItem[]>;
  limit?: number;
}

/** Material-owned content and deliberate links only. No inference or writes. */
export function selectRelatedStudy(input: RelatedStudyInput) {
  const { material, studySets, questions, events, recentReviews } = input;
  const rows: RelatedStudyRow[] = [];
  if (!material) return { rows, hasMore: false, status: "ready" as const };
  const set = studySets.find(s => s.sourceMaterialId === material.id);
  const hasKitDestination = (material.originalFileName ?? material.filePath ?? "").toLowerCase().endsWith(".pdf");
  if (set && (set.summary.trim() || set.sections.some(s => s.body.trim()))) {
    const heading = !set.summary.trim() && set.sections.every(s => s.pdfProvenance) && hasKitDestination
      ? "material-saved-pdf-kit" : "material-guide-heading";
    rows.push({ kind: "guide", id: material.id, label: `Study guide: ${set.title}`, reason: "From this material", target: { heading } });
  }
  if (set?.flashcards.length) {
    // Text and picture cards use Cards; kit-only cards live in the saved kit.
    const heading = set.flashcards.every(c => c.pdfProvenance && !c.visualRegionId) && hasKitDestination
      ? "material-saved-pdf-kit" : "material-cards-heading";
    rows.push({ kind: "cards", id: material.id, label: `Cards: ${set.title}`, reason: "From this material", target: { heading } });
  }
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
