import { describe, expect, it } from "vitest";
import type { AiStudySet, CompletedHistoryItem } from "@/domain/types";
import type { PdfItemProvenance } from "@/data/pdfKitSources";
import { makeEvent, makeMaterial, makeQuestion } from "@/testing/factories";
import { selectRelatedStudy, type RelatedStudyInput } from "./relatedStudy";

const material = makeMaterial({ id: "material /1", eventId: null, tags: ["PA.I.A.K1"], topic: "weather" });
const set: AiStudySet = { sourceMaterialId: material.id, title: "Synthetic guide", summary: "Saved summary", sections: [], flashcards: [{ front: "Fictional front", back: "Fictional back", sourcePage: null }], sourceNotes: "", model: "", provider: "manual", generatedAt: "2026-10-28", updatedAt: "2026-10-28" };
const review = (overrides: Partial<CompletedHistoryItem> = {}): CompletedHistoryItem => ({ attemptId: "attempt /1", versionId: "old-version", versionNumber: 1, historyKey: material.id, sourceMaterialTitle: "Frozen original title", startedAt: "2026-10-27", completedAt: "2026-10-28", totalQuestions: 3, answeredCount: 3, correctCount: 2, incorrectCount: 1, dontKnowCount: 0, unansweredCount: 0, scorePercent: 67, ...overrides });
function input(overrides: Partial<RelatedStudyInput> = {}): RelatedStudyInput {
  return { material, studySets: [set], recentReviews: { status: "ready", value: [review()] },
    questions: [makeQuestion({ id: "q /1", materialId: material.id, text: "Fictional question" })],
    events: [makeEvent({ id: "lesson /1", materialIds: [material.id] })], ...overrides };
}

describe("material Related study", () => {
  it("shows three initially, then the five kinds in approved order with named destinations and reasons", () => {
    const initial = selectRelatedStudy(input());
    expect(initial.rows.map(r => r.kind)).toEqual(["guide", "cards", "review"]);
    expect(initial.hasMore).toBe(true);
    const full = selectRelatedStudy(input({ limit: 5 }));
    expect(full.rows.map(r => r.kind)).toEqual(["guide", "cards", "review", "question", "lesson"]);
    expect(full.rows.map(r => r.reason)).toEqual(["From this material", "From this material", "From this material", "Linked by you", "Linked by you"]);
    expect(full.rows.map(r => r.label)).toEqual(["Study guide: Synthetic guide", "Cards: Synthetic guide", "Recent saved review: Frozen original title", "Instructor question: Fictional question", "Lesson preparation: Crosswind Landings"]);
    expect(full.rows.map(r => r.target)).toEqual([{ heading: "material-guide-heading" }, { heading: "material-cards-heading" }, { path: "/study/history/material%20%2F1/attempt%20%2F1?review=missed" }, { path: "/questions?question=q%20%2F1" }, { path: "/schedule/lesson%20%2F1#lesson-preparation" }]);
    expect(full.hasMore).toBe(false);
  });

  it("never exceeds five or duplicates a kind despite many explicit links and repeated titles", () => {
    const result = selectRelatedStudy(input({ limit: 999,
      studySets: [set, { ...set }],
      questions: Array.from({ length: 12 }, (_, i) => makeQuestion({ id: `q${i}`, materialId: material.id, text: "Same title" })),
      events: Array.from({ length: 12 }, (_, i) => makeEvent({ id: `e${i}`, materialIds: [material.id], title: "Same title" })),
      recentReviews: { status: "ready", value: Array.from({ length: 12 }, (_, i) => review({ attemptId: `a${i}` })) } }));
    expect(result.rows).toHaveLength(5);
    expect(new Set(result.rows.map(r => r.kind)).size).toBe(5);
  });

  it.each([undefined, -1, 0, 1.5, NaN, Infinity])("uses three for an invalid/default limit %s", limit => {
    expect(selectRelatedStudy(input({ limit })).rows).toHaveLength(3);
  });

  it("uses explicit material ownership, never matching tags, topics, titles, provenance or event-only questions", () => {
    const result = selectRelatedStudy(input({ studySets: [{ ...set, sourceMaterialId: "other" }],
      questions: [makeQuestion({ materialId: "other", topic: "weather" }), makeQuestion({ sourceMaterialId: material.id }), makeQuestion({ eventId: "lesson" })],
      events: [makeEvent({ id: "lesson", materialIds: ["other"] })],
      recentReviews: { status: "ready", value: [review({ historyKey: "other" })] } }));
    expect(result.rows).toEqual([]);
    expect(result.status).toBe("ready");
  });

  it("supports either explicit lesson link without an instructor or enrolment and excludes non-lessons", () => {
    const lesson = makeEvent({ id: "direct", instructor: "" });
    const result = selectRelatedStudy(input({ material: { ...material, eventId: lesson.id }, events: [makeEvent({ materialIds: [material.id], eventType: "medical" }), lesson], limit: 5 }));
    expect(result.rows.at(-1)?.id).toBe("direct");
  });

  it("has no generated placeholders for empty sets, drafts, missing links or deleted materials", () => {
    const empty = input({ studySets: [{ ...set, summary: "  ", sections: [{ heading: "Empty", body: " " }], flashcards: [] }], questions: [], events: [], recentReviews: { status: "ready", value: [] } });
    expect(selectRelatedStudy(empty).rows).toEqual([]);
    expect(selectRelatedStudy({ ...input(), material: null }).rows).toEqual([]);
    expect(selectRelatedStudy(input({ studySets: [{ ...set, summary: "", sections: [{ heading: "Saved", body: "Body" }], flashcards: [] }] })).rows[0]?.kind).toBe("guide");
  });

  it("includes picture cards under the one Cards row, preserving saved picture identity", () => {
    const pictureSet = { ...set, summary: "", flashcards: [{ ...set.flashcards[0]!, visualRegionId: "saved-picture-region" }] };
    const before = structuredClone(pictureSet);
    const result = selectRelatedStudy(input({ studySets: [pictureSet], questions: [], events: [], recentReviews: { status: "ready", value: [] } }));
    expect(result.rows.map(r => r.kind)).toEqual(["cards"]);
    expect(pictureSet).toEqual(before);
  });

  it("opens the existing saved kit for kit-only guide/cards, including unavailable source details", () => {
    const pdfProvenance: PdfItemProvenance = { status: "invalid", label: "PDF source details unavailable", sources: [] };
    const kitSet = { ...set, summary: "", sections: [{ heading: "Fictional kit", body: "Saved kit text", pdfProvenance }], flashcards: [{ ...set.flashcards[0]!, pdfProvenance }] };
    const result = selectRelatedStudy(input({ material: { ...material, filePath: "documents/synthetic.pdf" }, studySets: [kitSet], questions: [], events: [], recentReviews: { status: "ready", value: [] } }));
    expect(result.rows.map(r => r.target)).toEqual([{ heading: "material-saved-pdf-kit" }, { heading: "material-saved-pdf-kit" }]);
    const detached = selectRelatedStudy(input({ material: { ...material, filePath: null, originalFileName: "synthetic.pdf" }, studySets: [kitSet] }));
    expect(detached.rows.slice(0, 2).map(r => r.target)).toEqual([{ heading: "material-saved-pdf-kit" }, { heading: "material-saved-pdf-kit" }]);
    // Ordinary saved content still uses the existing top-level destinations.
    const mixed = selectRelatedStudy(input({ studySets: [{ ...kitSet, summary: "Saved summary", flashcards: [...kitSet.flashcards, set.flashcards[0]!] }] }));
    expect(mixed.rows.slice(0, 2).map(r => r.target)).toEqual([{ heading: "material-guide-heading" }, { heading: "material-cards-heading" }]);
  });

  it.each(["incorrectCount", "dontKnowCount", "unansweredCount"] as const)("finds recent saved %s and keeps frozen attempt identity after regeneration", field => {
    const candidate = review({ incorrectCount: 0, [field]: 1 });
    const result = selectRelatedStudy(input({ studySets: [], recentReviews: { status: "ready", value: [candidate, review({ attemptId: "new-correct", completedAt: "2026-10-29", incorrectCount: 0 })] } }));
    expect(result.rows[0]).toMatchObject({ kind: "review", id: candidate.attemptId, label: "Recent saved review: Frozen original title" });
  });

  it("checks only the newest ten summaries and never calls correct-only history no mistakes", () => {
    const correct = Array.from({ length: 10 }, (_, i) => review({ attemptId: `correct${i}`, completedAt: `2026-10-${String(15 + i).padStart(2, "0")}`, incorrectCount: 0 }));
    const result = selectRelatedStudy(input({ recentReviews: { status: "ready", value: [review({ completedAt: "2026-10-01" }), ...correct.reverse()] } }));
    expect(result.rows.some(r => r.kind === "review")).toBe(false);
  });

  it.each(["failed", "loading"] as const)("preserves %s separately from empty and still offers saved destinations", status => {
    const result = selectRelatedStudy(input({ studySets: [], questions: [], events: [], recentReviews: { status } }));
    expect(result.rows).toEqual([]);
    expect(result.status).toBe(status);
    expect(selectRelatedStudy(input({ recentReviews: { status } })).rows.map(r => r.kind)).toEqual(["guide", "cards", "question"]);
  });

  it("is deterministic, read-only and recomputes removal/undo from authoritative data", () => {
    const source = input(); const before = structuredClone(source);
    expect(selectRelatedStudy(source)).toEqual(selectRelatedStudy(source));
    expect(source).toEqual(before);
    expect(selectRelatedStudy({ ...source, studySets: [], questions: [], events: [], recentReviews: { status: "ready", value: [] } }).rows).toEqual([]);
    expect(selectRelatedStudy(source).rows).toHaveLength(3);
  });
});
