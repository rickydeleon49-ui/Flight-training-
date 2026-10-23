import { describe, expect, it } from "vitest";

import { EMPTY_DATA, type AppData } from "@/state/AppDataContext";
import {
  makeEvent,
  makeGoal,
  makeJournalEntry,
  makeMaterial,
  makeNote,
  makeQuestion,
} from "@/testing/factories";
import { quickFind } from "./quickFind";

const TODAY = "2026-09-06";

const data: AppData = {
  ...EMPTY_DATA,
  materials: [
    makeMaterial({ id: "m1", title: "Crosswind landing handout", notes: "gusty conditions" }),
    makeMaterial({ id: "m2", title: "Airspace review", tags: ["charts"] }),
  ],
  events: [makeEvent({ id: "e1", title: "Lesson 12 — crosswinds", date: "2026-09-08" })],
  journalEntries: [makeJournalEntry({ id: "j1", title: "First solo", date: "2026-08-30" })],
  goals: [makeGoal({ id: "g1", title: "Land confidently in wind" })],
  questions: [makeQuestion({ id: "q1", text: "When do I use a forward slip?" })],
  notes: [
    makeNote({ id: "n1", title: "Schools to call", body: "the one on the north field" }),
    makeNote({ id: "n2", title: "", body: "Bring the headset receipt to the next lesson" }),
  ],
};

const labels = (query: string) => quickFind(data, query, TODAY).map((result) => result.label);

describe("quickFind", () => {
  it.each(["-", "–", "—", "−"])("matches page-range dashes in Quick Find and preserves the %s title", (storedDash) => {
    const title = `00_afh_full — Pages 120${storedDash}150`;
    const material = makeMaterial({ id: "range", title, notes: `More pages 160${storedDash}180` });
    const records = { ...EMPTY_DATA, materials: [material] };
    for (const queryDash of ["-", "–", "—", "−"]) {
      expect(quickFind(records, `Pages 120${queryDash}150`, TODAY)).toMatchObject([{ label: title, to: "/study/range" }]);
      expect(quickFind(records, `pages 160${queryDash}180`, TODAY)).toMatchObject([{ label: title }]);
    }
    expect(material.title).toBe(title);
  });

  it("offers the sections before anything is typed", () => {
    const results = quickFind(data, "", TODAY);
    expect(results.every((result) => result.section === "Go to")).toBe(true);
    expect(results.map((result) => result.label)).toContain("Finances");
  });

  it("finds records across every section", () => {
    expect(labels("crosswind")).toEqual(
      expect.arrayContaining(["Crosswind landing handout", "Lesson 12 — crosswinds"]),
    );
    expect(labels("solo")).toContain("First solo");
    expect(labels("slip")).toContain("When do I use a forward slip?");
    expect(labels("land confidently")).toContain("Land confidently in wind");
    expect(labels("schools")).toContain("Schools to call");
  });

  it("finds an untitled note by the line it starts with", () => {
    expect(labels("headset")).toContain("Bring the headset receipt to the next lesson");
  });

  it("ranks a title that starts with the query above one that merely contains it", () => {
    const results = labels("crosswind");
    expect(results[0]).toBe("Crosswind landing handout");
  });

  it("ranks a title match above a match in a record's other text", () => {
    const results = labels("gusty");
    expect(results).toEqual(["Crosswind landing handout"]);
  });

  it("matches a tag without showing it as the label", () => {
    expect(labels("charts")).toContain("Airspace review");
  });

  it("still reaches a section by name", () => {
    expect(labels("fin")).toContain("Finances");
  });

  it("gives every result somewhere to go", () => {
    for (const result of quickFind(data, "a", TODAY)) {
      expect(result.to.startsWith("/")).toBe(true);
    }
  });

  it("returns nothing rather than everything for an unmatched query", () => {
    expect(labels("zzzzz")).toEqual([]);
  });

  it("is not confused by regular-expression characters", () => {
    expect(() => labels("what? (really)")).not.toThrow();
  });

  it("keeps the list short enough to read", () => {
    const many: AppData = {
      ...EMPTY_DATA,
      materials: Array.from({ length: 40 }, (_, index) =>
        makeMaterial({ id: `m${index}`, title: `Weather briefing ${index}` }),
      ),
    };
    expect(quickFind(many, "weather", TODAY)).toHaveLength(12);
  });
});
