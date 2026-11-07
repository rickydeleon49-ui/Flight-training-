import { describe, expect, it } from "vitest";
import { newestJob, usesSectionGuide, type GeminiJob } from "./GeminiJobs";

const job = (extra: Partial<GeminiJob>): GeminiJob =>
  ({ key: "k", materialId: "m1", kind: "flashcards", phase: "failed", ...extra }) as GeminiJob;

describe("DRAFT-CARRY-01", () => {
  it("a leftover flashcards draft keeps Regenerate on the section guide", () => {
    const stale = job({ key: "a", kind: "flashcards", draft: { target: 20, cards: [] } });
    expect(usesSectionGuide([stale], "m1", "documents/m1.pdf")).toBe(true);
    const studyDraft = job({ key: "b", kind: "study-aid", draft: { target: 20, cards: [] } });
    expect(usesSectionGuide([studyDraft], "m1", "documents/m1.pdf")).toBe(false);
    expect(usesSectionGuide([], "m1", "documents/m1.txt")).toBe(false);
  });

  it("shows the newest flashcards job, not the first", () => {
    const old = job({ key: "old", createdAt: 1 });
    const fresh = job({ key: "new", createdAt: 2, phase: "running" });
    expect(newestJob([old, fresh], "m1", "flashcards")?.key).toBe("new");
    expect(newestJob([fresh, old], "m1", "flashcards")?.key).toBe("new");
    expect(newestJob([old], "m2", "flashcards")).toBeUndefined();
  });

  it("shows the newest practice-test job, not the first", () => {
    const old = job({ key: "old", kind: "practice-test", createdAt: 1 });
    const fresh = job({ key: "new", kind: "practice-test", createdAt: 2, phase: "running" });
    expect(newestJob([old, fresh], "m1", "practice-test")?.key).toBe("new");
  });
});
