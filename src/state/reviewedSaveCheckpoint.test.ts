import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NextStudySet, StoredSetRow } from "@/data/studySetTransaction";
import {
  forgetReviewedSave,
  rememberReviewedSave,
  reviewedSaveOf,
  type ReviewedRegeneration,
} from "./reviewedSaveCheckpoint";

/**
 * The record of a reviewed regeneration save that is still outstanding
 * (OFFLINE-03a). Its whole job is to survive a restart, so the review can
 * recognise a study-set save the journal has not finished with yet.
 */

class MemoryStorage {
  private items = new Map<string, string>();
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, value); }
  removeItem(key: string) { this.items.delete(key); }
  get keys() { return [...this.items.keys()]; }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
});
afterEach(() => vi.unstubAllGlobals());

const EXPECTED: StoredSetRow = {
  title: "Synthetic guide",
  summary: "Synthetic summary.",
  sections_json: "[]",
  flashcards_json: "[]",
  source_notes: "",
  provider: "gemini",
  model: "gemini-3.5-flash",
  generated_at: "2026-10-19T09:00:00.000Z",
  updated_at: "2026-10-19T09:00:00.000Z",
  summary_origin: null,
  retired_json: "[]",
};

const NEXT: NextStudySet = {
  title: "Synthetic guide",
  summary: "A new summary.",
  summaryOrigin: "user",
  sections: [],
  flashcards: [{ front: "Which wing is lowered?", back: "The upwind wing.", sourcePage: 4, itemId: "item-1", origin: "user" }],
  sourceNotes: "",
  provider: "gemini",
  model: "gemini-3.5-flash",
  retired: [],
};

const reviewed = (operationId: string): ReviewedRegeneration => ({ kind: "study-set", operationId, expected: EXPECTED, next: NEXT });

describe("practice checkpoints and legacy study-set checkpoints", () => {
  it("reads a legacy study-set record without kind", () => {
    window.localStorage.setItem("her-flight-deck.reviewed-regeneration.legacy", JSON.stringify({ operationId: "legacy", expected: EXPECTED, next: NEXT }));
    expect(reviewedSaveOf("legacy")).toEqual({ kind: "study-set", operationId: "legacy", expected: EXPECTED, next: NEXT });
  });
  it("round-trips a practice operation and refuses mismatched ids or unknown kinds", () => {
    const checkpoint: ReviewedRegeneration = { kind: "practice", operationId: "op", operation: {
      operationId: "op", sourceMaterialId: "mat", reason: "regenerate", expected: null, next: null,
    } };
    rememberReviewedSave("practice", checkpoint);
    expect(reviewedSaveOf("practice")).toEqual(checkpoint);
    window.localStorage.setItem("her-flight-deck.reviewed-regeneration.bad", JSON.stringify({ ...checkpoint, operationId: "other" }));
    expect(reviewedSaveOf("bad")).toBeNull();
    window.localStorage.setItem("her-flight-deck.reviewed-regeneration.bad", JSON.stringify({ ...checkpoint, kind: "other" }));
    expect(reviewedSaveOf("bad")).toBeNull();
  });
  it("returns null when storage getItem throws", () => {
    vi.spyOn(storage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => reviewedSaveOf("practice")).not.toThrow();
    expect(reviewedSaveOf("practice")).toBeNull();
  });
});

describe("the reviewed save that is still outstanding", () => {
  it("gives back exactly the operation that was sent, so a retry sends the same one", () => {
    rememberReviewedSave("job-1", reviewed("00000000-0000-4000-8000-000000000001"));
    expect(reviewedSaveOf("job-1")).toEqual({
      kind: "study-set",
      operationId: "00000000-0000-4000-8000-000000000001",
      expected: EXPECTED,
      next: NEXT,
    });
  });

  it("is gone once the journal has acknowledged the answer it was waiting for", () => {
    rememberReviewedSave("job-1", reviewed("00000000-0000-4000-8000-000000000001"));
    forgetReviewedSave("job-1");
    expect(reviewedSaveOf("job-1")).toBeNull();
  });

  it("keeps one answer's acknowledgement from discarding another's save", () => {
    rememberReviewedSave("job-1", reviewed("00000000-0000-4000-8000-000000000001"));
    rememberReviewedSave("job-2", reviewed("00000000-0000-4000-8000-000000000002"));
    forgetReviewedSave("job-1");
    expect(reviewedSaveOf("job-2")!.operationId).toBe("00000000-0000-4000-8000-000000000002");
  });

  it("writes nothing for an answer the journal never recorded, and reads nothing back", () => {
    rememberReviewedSave(null, reviewed("00000000-0000-4000-8000-000000000001"));
    expect(storage.keys).toEqual([]);
    expect(reviewedSaveOf(null)).toBeNull();
  });

  it("treats damaged or half-written storage as no outstanding save", () => {
    window.localStorage.setItem("her-flight-deck.reviewed-regeneration.job-1", "{not json");
    expect(reviewedSaveOf("job-1")).toBeNull();
    window.localStorage.setItem(
      "her-flight-deck.reviewed-regeneration.job-2",
      JSON.stringify({ operationId: "00000000-0000-4000-8000-000000000001" }),
    );
    expect(reviewedSaveOf("job-2")).toBeNull();
  });

  it("survives storage being unavailable or refusing to write", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("blocked");
      },
    });
    expect(() => rememberReviewedSave("job-1", reviewed("00000000-0000-4000-8000-000000000001"))).not.toThrow();
    expect(reviewedSaveOf("job-1")).toBeNull();
    expect(() => forgetReviewedSave("job-1")).not.toThrow();
  });
});
