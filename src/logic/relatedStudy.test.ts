import { describe, expect, it } from "vitest";
import type { CompletedHistoryItem } from "@/domain/types";
import { makeEvent, makeMaterial, makeQuestion } from "@/testing/factories";
import { selectRelatedStudy, type RelatedStudyInput } from "./relatedStudy";

const material = makeMaterial({ id: "material /1", eventId: null, tags: ["PA.I.A.K1"], topic: "weather" });
const review = (overrides: Partial<CompletedHistoryItem> = {}): CompletedHistoryItem => ({ attemptId: "attempt /1", versionId: "old-version", versionNumber: 1, historyKey: material.id, sourceMaterialTitle: "Frozen original title", startedAt: "2026-10-27", completedAt: "2026-10-28", totalQuestions: 3, answeredCount: 3, correctCount: 2, incorrectCount: 1, dontKnowCount: 0, unansweredCount: 0, scorePercent: 67, ...overrides });
function input(overrides: Partial<RelatedStudyInput> = {}): RelatedStudyInput {
  return { material, recentReviews: { status: "ready", value: [review()] },
    questions: [makeQuestion({ id: "q /1", materialId: material.id, text: "Fictional question" })],
    events: [makeEvent({ id: "lesson /1", materialIds: [material.id] })], ...overrides };
}

describe("material Related study", () => {
  it("lists only off-page destinations in approved order with named destinations and reasons", () => {
    const full = selectRelatedStudy(input());
    expect(full.rows.map(r => r.kind)).toEqual(["review", "question", "lesson"]);
    expect(full.rows.map(r => r.reason)).toEqual(["From this material", "Linked by you", "Linked by you"]);
    expect(full.rows.map(r => r.label)).toEqual(["Recent saved review: Frozen original title", "Instructor question: Fictional question", "Lesson preparation: Crosswind Landings"]);
    expect(full.rows.map(r => r.target)).toEqual([{ path: "/study/history/material%20%2F1/attempt%20%2F1?review=missed" }, { path: "/questions?question=q%20%2F1" }, { path: "/schedule/lesson%20%2F1" }]);
    expect(full.hasMore).toBe(false);
    // The Show more mechanism still caps the first view.
    expect(selectRelatedStudy(input({ limit: 2 }))).toMatchObject({ hasMore: true, rows: [{ kind: "review" }, { kind: "question" }] });
  });

  it("never lists the material's own guide or cards; those keep their Jump to chips", () => {
    const studySets = [{ sourceMaterialId: material.id, title: "Synthetic guide", summary: "Saved summary", sections: [], flashcards: [{ front: "F", back: "B", sourcePage: null }] }];
    const result = selectRelatedStudy({ ...input({ questions: [], events: [], recentReviews: { status: "ready", value: [] } }), studySets } as RelatedStudyInput);
    expect(result.rows).toEqual([]);
  });

  it("never exceeds one row per kind despite many explicit links and repeated titles", () => {
    const result = selectRelatedStudy(input({ limit: 999,
      questions: Array.from({ length: 12 }, (_, i) => makeQuestion({ id: `q${i}`, materialId: material.id, text: "Same title" })),
      events: Array.from({ length: 12 }, (_, i) => makeEvent({ id: `e${i}`, materialIds: [material.id], title: "Same title" })),
      recentReviews: { status: "ready", value: Array.from({ length: 12 }, (_, i) => review({ attemptId: `a${i}` })) } }));
    expect(result.rows).toHaveLength(3);
    expect(new Set(result.rows.map(r => r.kind)).size).toBe(3);
  });

  it.each([undefined, -1, 0, 1.5, NaN, Infinity])("uses three for an invalid/default limit %s", limit => {
    expect(selectRelatedStudy(input({ limit }))).toMatchObject({ hasMore: false });
    expect(selectRelatedStudy(input({ limit })).rows).toHaveLength(3);
    expect(selectRelatedStudy(input({ limit: 1 })).rows).toHaveLength(1);
  });

  it("uses explicit material ownership, never matching tags, topics, titles, provenance or event-only questions", () => {
    const result = selectRelatedStudy(input({
      questions: [makeQuestion({ materialId: "other", topic: "weather" }), makeQuestion({ sourceMaterialId: material.id }), makeQuestion({ eventId: "lesson" })],
      events: [makeEvent({ id: "lesson", materialIds: ["other"] })],
      recentReviews: { status: "ready", value: [review({ historyKey: "other" })] } }));
    expect(result.rows).toEqual([]);
    expect(result.status).toBe("ready");
  });

  it("supports either explicit lesson link without an instructor or enrolment and excludes non-lessons", () => {
    const lesson = makeEvent({ id: "direct", instructor: "" });
    const result = selectRelatedStudy(input({ material: { ...material, eventId: lesson.id }, events: [makeEvent({ materialIds: [material.id], eventType: "medical" }), lesson] }));
    expect(result.rows.at(-1)?.id).toBe("direct");
  });

  it("has no generated placeholders for missing links or deleted materials", () => {
    const empty = input({ questions: [makeQuestion({ materialId: material.id, text: "  " })], events: [], recentReviews: { status: "ready", value: [] } });
    expect(selectRelatedStudy(empty).rows).toEqual([]);
    expect(selectRelatedStudy({ ...input(), material: null }).rows).toEqual([]);
  });

  it.each(["incorrectCount", "dontKnowCount", "unansweredCount"] as const)("finds recent saved %s and keeps frozen attempt identity after regeneration", field => {
    const candidate = review({ incorrectCount: 0, [field]: 1 });
    const result = selectRelatedStudy(input({ recentReviews: { status: "ready", value: [candidate, review({ attemptId: "new-correct", completedAt: "2026-10-29", incorrectCount: 0 })] } }));
    expect(result.rows[0]).toMatchObject({ kind: "review", id: candidate.attemptId, label: "Recent saved review: Frozen original title" });
  });

  it("checks only the newest ten summaries and never calls correct-only history no mistakes", () => {
    const correct = Array.from({ length: 10 }, (_, i) => review({ attemptId: `correct${i}`, completedAt: `2026-10-${String(15 + i).padStart(2, "0")}`, incorrectCount: 0 }));
    const result = selectRelatedStudy(input({ recentReviews: { status: "ready", value: [review({ completedAt: "2026-10-01" }), ...correct.reverse()] } }));
    expect(result.rows.some(r => r.kind === "review")).toBe(false);
  });

  it.each(["failed", "loading"] as const)("preserves %s separately from empty and still offers saved destinations", status => {
    const result = selectRelatedStudy(input({ questions: [], events: [], recentReviews: { status } }));
    expect(result.rows).toEqual([]);
    expect(result.status).toBe(status);
    expect(selectRelatedStudy(input({ recentReviews: { status } })).rows.map(r => r.kind)).toEqual(["question", "lesson"]);
  });

  it("is deterministic, read-only and recomputes removal/undo from authoritative data", () => {
    const source = input(); const before = structuredClone(source);
    expect(selectRelatedStudy(source)).toEqual(selectRelatedStudy(source));
    expect(source).toEqual(before);
    expect(selectRelatedStudy({ ...source, questions: [], events: [], recentReviews: { status: "ready", value: [] } }).rows).toEqual([]);
    expect(selectRelatedStudy(source).rows).toHaveLength(3);
  });
});
