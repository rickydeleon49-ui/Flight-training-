import { describe, expect, it } from "vitest";
import type { AiStudySet } from "@/domain/types";
import { prepareStudyEdit, resolveRegeneration, StudyAuthoringError } from "./studyAuthoring";
import {
  authoringStateOf,
  emptyManualSet,
  frameOf,
  itemAuthorLabel,
  mergeRegeneration,
  needsRegenerationReview,
  nextSetOf,
  regenerationPreview,
} from "./studySetEditing";
import { validateNextSet } from "@/data/studySetTransaction";

const generated = (overrides: Partial<AiStudySet> = {}): AiStudySet => ({
  sourceMaterialId: "mat-a",
  title: "Crosswind landings",
  summary: "Keep the upwind wing low.",
  summaryOrigin: null,
  sections: [{ heading: "Crab", body: "Point the nose into the wind." }],
  flashcards: [
    { front: "Which wing is lowered?", back: "The upwind wing.", sourcePage: 4 },
    { front: "What does the rudder do?", back: "Aligns the nose with the runway.", sourcePage: null },
  ],
  sourceNotes: "Synthetic notes.",
  provider: "gemini",
  retired: [],
  model: "gemini-3.5-flash",
  generatedAt: "2026-10-19T12:00:00.000Z",
  updatedAt: "2026-10-19T12:00:00.000Z",
  ...overrides,
});

let n = 0;
const ids = () => `id-${++n}`;

describe("reading a saved set", () => {
  it("gives legacy items ids on first edit and keeps the summary material-scoped", () => {
    const state = authoringStateOf(generated());
    expect(state.items.map((item) => item.kind)).toEqual(["summary", "section", "card", "card"]);
    expect(state.items[0]!.itemId).toBe("summary");
    expect(new Set(state.items.map((item) => item.itemId)).size).toBe(4);
    expect(state.items[2]!.sourcePage).toBe(4);
  });

  it("keeps stored ids, origins and corrections exactly", () => {
    const set = generated({
      summaryOrigin: "user",
      flashcards: [{ front: "F", back: "B", sourcePage: 2, itemId: "c-2", origin: "instructor", replaces: "c-1" }],
    });
    const state = authoringStateOf(set);
    expect(state.items[0]).toMatchObject({ itemId: "summary", origin: "user" });
    expect(state.items[2]).toEqual({ kind: "card", itemId: "c-2", fields: ["F", "B"], sourcePage: 2, origin: "instructor", replaces: "c-1" });
  });

  it("refuses content it can't represent instead of dropping it", () => {
    expect(() => authoringStateOf(generated({ flashcards: [{ front: "", back: "B", sourcePage: null }] }))).toThrow(StudyAuthoringError);
  });
});

describe("writing a set back", () => {
  it("round-trips an untouched legacy set except for the new ids", () => {
    const set = generated();
    const next = nextSetOf(frameOf(set), authoringStateOf(set));
    expect(validateNextSet(next)).toEqual(next);
    expect(next.provider).toBe("gemini");
    expect(next.summaryOrigin).toBeNull();
    expect(next.flashcards.map(({ front, back, sourcePage }) => ({ front, back, sourcePage }))).toEqual(set.flashcards);
    expect(next.flashcards.every((card) => card.origin === undefined && typeof card.itemId === "string")).toBe(true);
  });

  it("marks an edited Gemini card as hers and keeps everything else generated", async () => {
    const set = generated();
    const state = authoringStateOf(set);
    const target = state.items[2]!;
    const edit = await prepareStudyEdit(state, { kind: "edit", itemId: target.itemId, fields: ["Which wing is lowered?", "The upwind wing, into the wind."], origin: "user" });
    const next = nextSetOf(frameOf(set), edit.next);
    expect(next.flashcards[0]).toMatchObject({ origin: "user", sourcePage: 4, itemId: target.itemId });
    expect(next.flashcards[1]!.origin).toBeUndefined();
    expect(next.sections[0]!.origin).toBeUndefined();
    expect(next.retired).toHaveLength(1);
    expect(validateNextSet(next)).toEqual(next);
  });

  it("stores a corrected summary with its origin and a deleted summary as empty", async () => {
    const set = generated();
    const corrected = await prepareStudyEdit(authoringStateOf(set), { kind: "correct", itemId: "summary", fields: ["Lower the upwind wing; hold the centerline."], origin: "instructor" });
    expect(nextSetOf(frameOf(set), corrected.next)).toMatchObject({ summary: "Lower the upwind wing; hold the centerline.", summaryOrigin: "instructor" });
    const deleted = await prepareStudyEdit(authoringStateOf(set), { kind: "delete", itemId: "summary" });
    expect(nextSetOf(frameOf(set), deleted.next)).toMatchObject({ summary: "", summaryOrigin: null });
  });

  it("creates a wholly manual set with no provider wording", async () => {
    const { frame, state } = emptyManualSet("My notes");
    const added = await prepareStudyEdit(state, { kind: "add", item: { kind: "card", fields: ["Q", "A"], sourcePage: null }, origin: "user" }, ids);
    const next = nextSetOf(frame, added.next);
    expect(next).toMatchObject({ provider: "manual", model: "", summary: "", summaryOrigin: null });
    expect(next.flashcards).toEqual([{ front: "Q", back: "A", sourcePage: null, itemId: added.next.items[1]!.itemId, origin: "user" }]);
    expect(validateNextSet(next)).toEqual(next);
  });
});

describe("regenerating a set that holds her items", () => {
  it("needs her review only when she has items or retirements", () => {
    expect(needsRegenerationReview(undefined)).toBe(false);
    expect(needsRegenerationReview(generated())).toBe(false);
    expect(needsRegenerationReview(generated({ provider: "manual" }))).toBe(true);
    expect(needsRegenerationReview(generated({ summaryOrigin: "user" }))).toBe(true);
    expect(needsRegenerationReview(generated({ flashcards: [{ front: "F", back: "B", sourcePage: null, origin: "user" }] }))).toBe(true);
    expect(needsRegenerationReview(generated({ retired: [{ kind: "card", itemId: "x", reason: "deleted", textKey: "0".repeat(64), terms: [] }] }))).toBe(true);
  });

  async function correctedSet() {
    const set = generated();
    const state = authoringStateOf(set);
    const wrong = state.items[3]!;
    const corrected = await prepareStudyEdit(state, { kind: "correct", itemId: wrong.itemId, fields: ["What does the rudder do?", "Keeps the longitudinal axis aligned with the runway."], origin: "instructor" }, ids);
    const removed = await prepareStudyEdit(corrected.next, { kind: "delete", itemId: state.items[1]!.itemId });
    return { set, state: removed.next };
  }

  it("holds back a repeated wrong answer and a repeated deleted section; keeps her correction", async () => {
    const { set, state } = await correctedSet();
    const preview = await regenerationPreview(state, {
      summary: "A brand new summary.",
      sections: [{ heading: "Crab", body: "Point the nose into the wind." }, { heading: "Slip", body: "Wing down, opposite rudder." }],
      flashcards: [
        { front: "What does the rudder do?", back: "Aligns the nose with the runway.", sourcePage: null },
        { front: "When do you flare?", back: "About ten feet above the runway.", sourcePage: 7 },
      ],
    });
    expect(preview.map((entry) => entry.status)).toEqual(["new", "held", "new", "held", "new"]);
    const resolved = resolveRegeneration(preview, new Map());
    const merged = mergeRegeneration(state, resolved, "keep", true);
    const next = nextSetOf({ ...frameOf(set), provider: "gemini", model: "gemini-3.5-flash" }, merged);
    expect(next.sections.map((section) => section.heading)).toEqual(["Slip"]);
    expect(next.flashcards.map((card) => [card.front, card.origin ?? null])).toEqual([
      ["When do you flare?", null],
      ["What does the rudder do?", "instructor"],
    ]);
    expect(next.summary).toBe("A brand new summary.");
    expect(next.retired).toHaveLength(2);
    expect(validateNextSet(next)).toEqual(next);
  });

  it("blocks a reworded repeat until she chooses, and keeps her summary by default", async () => {
    const { state: base } = await correctedSet();
    const mineSummary = await prepareStudyEdit(base, { kind: "edit", itemId: "summary", fields: ["My own summary."], origin: "user" });
    const preview = await regenerationPreview(mineSummary.next, {
      summary: "Generated summary.",
      sections: [],
      flashcards: [{ front: "What does the rudder do?", back: "It aligns the nose with runway.", sourcePage: null }],
    });
    expect(preview[1]!.status).toBe("unresolved");
    expect(() => resolveRegeneration(preview, new Map())).toThrow(StudyAuthoringError);
    const resolved = resolveRegeneration(preview, new Map([[preview[1]!.item.itemId, "omit"]]));
    const kept = mergeRegeneration(mineSummary.next, resolved, "keep", true);
    expect(kept.items[0]).toMatchObject({ fields: ["My own summary."], origin: "user" });
    const replacedSummary = mergeRegeneration(mineSummary.next, resolved, "keep", false);
    expect(replacedSummary.items[0]).toMatchObject({ fields: ["Generated summary."] });
    expect(replacedSummary.items[0]!.origin).toBeUndefined();
  });

  it("replace everything keeps only the new items but carries the retirement list", async () => {
    const { state } = await correctedSet();
    const preview = await regenerationPreview(state, { summary: "", sections: [], flashcards: [{ front: "Brand new?", back: "Yes.", sourcePage: null }] });
    const merged = mergeRegeneration(state, resolveRegeneration(preview, new Map()), "replace", true);
    expect(merged.items.map((item) => item.kind)).toEqual(["summary", "card"]);
    expect(merged.items[0]!.fields).toEqual([""]);
    expect(merged.retired).toEqual(state.retired);
  });
});

it("labels authors truthfully and never as Gemini", () => {
  expect(itemAuthorLabel(undefined)).toBeNull();
  expect(itemAuthorLabel("user")).toBe("Written by you");
  expect(itemAuthorLabel("instructor")).toBe("Instructor correction");
  expect(itemAuthorLabel("gemini")).toBe("Author unknown");
});
