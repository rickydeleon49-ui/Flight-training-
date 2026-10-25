import { describe, expect, it } from "vitest";

import { DEFAULT_TOOLKIT_STATE } from "@/logic/toolkit";
import { EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import {
  makeAction,
  makeChecklistItem,
  makeGoal,
  makeMaterial,
  makeQuestion,
} from "@/testing/factories";
import { hidePending } from "./pendingDeletes";

const data: AppData = {
  ...EMPTY_DATA,
  materials: [makeMaterial({ id: "m1" }), makeMaterial({ id: "m2" })],
  goals: [makeGoal({ id: "g1" })],
  checklistItems: [makeChecklistItem({ id: "c1", goalId: "g1" })],
  actions: [makeAction({ id: "a1" })],
  questions: [makeQuestion({ id: "q1" })],
  aiStudySets: [
    {
      sourceMaterialId: "m1",
      title: "Crosswinds",
      summary: "",
      sections: [],
      flashcards: [],
      sourceNotes: "",
      provider: "gemini",
      model: "gemini-2.5-flash",
      generatedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  ],
  toolkit: {
    ...DEFAULT_TOOLKIT_STATE,
    credentials: [
      {
        id: "r1",
        type: "medical",
        title: "Third class medical",
        identifier: "",
        issuedOn: null,
        expiresOn: null,
        notes: "",
        materialId: null,
      },
    ],
  },
  flightSchools: [
    {
      id: "fs1",
      name: "Alpha Aviation",
      hourlyCostCents: 20000,
      aircraftDescription: null,
      trainingTrack: "Part 61",
      availabilityDescription: null,
      discoveryFlightReflection: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    {
      id: "fs2",
      name: "Bravo Flight",
      hourlyCostCents: null,
      aircraftDescription: null,
      trainingTrack: null,
      availabilityDescription: null,
      discoveryFlightReflection: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  ],
};

describe("hidePending", () => {
  it("returns the very same object when nothing is pending", () => {
    expect(hidePending(data, new Set())).toBe(data);
  });

  it("hides a record without touching the rest", () => {
    const next = hidePending(data, new Set(["m1"]));
    expect(next.materials.map((m) => m.id)).toEqual(["m2"]);
    expect(next.goals).toBe(data.goals);
    expect(next.actions).toBe(data.actions);
  });

  it("takes a material's study aid with it", () => {
    expect(hidePending(data, new Set(["m1"])).aiStudySets).toEqual([]);
  });

  it("hides a goal and its checklist together", () => {
    const next = hidePending(data, new Set(["g1", "c1"]));
    expect(next.goals).toEqual([]);
    expect(next.checklistItems).toEqual([]);
  });

  it("reaches records inside the toolkit", () => {
    expect(hidePending(data, new Set(["r1"])).toolkit.credentials).toEqual([]);
  });

  it("ignores ids that match nothing", () => {
    const next = hidePending(data, new Set(["nothing"]));
    expect(next.materials).toBe(data.materials);
    expect(next.questions).toBe(data.questions);
  });

  it("hides flight schools when pending delete", () => {
    const next = hidePending(data, new Set(["fs1"]));
    expect(next.flightSchools.map((s) => s.id)).toEqual(["fs2"]);
    expect(next.actions).toBe(data.actions);
  });

  it("never changes the data it was given", () => {
    hidePending(data, new Set(["m1", "g1", "r1"]));
    expect(data.materials).toHaveLength(2);
    expect(data.toolkit.credentials).toHaveLength(1);
  });
});
