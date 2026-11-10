import { describe, expect, it } from "vitest";

import { makeMaterial } from "@/testing/factories";
import { sortMaterials } from "./library";

const material = (
  title: string,
  priority: "next_up" | "important" | "later",
  createdAt: string,
) => makeMaterial({ title, priority, createdAt });

describe("sortMaterials", () => {
  const older = material(
    "Airspace handout",
    "later",
    "2026-01-01T00:00:00.000Z",
  );
  const newer = material(
    "Crosswind notes",
    "later",
    "2026-06-01T00:00:00.000Z",
  );
  const urgent = material(
    "Weather briefing",
    "next_up",
    "2026-02-01T00:00:00.000Z",
  );

  it("puts the most recently added first by default", () => {
    expect(
      sortMaterials([older, newer, urgent], "recent").map((m) => m.title),
    ).toEqual(["Crosswind notes", "Weather briefing", "Airspace handout"]);
  });

  it("puts what matters most first when sorting by priority", () => {
    const important = material(
      "Radio calls",
      "important",
      "2026-01-05T00:00:00.000Z",
    );
    expect(
      sortMaterials([older, important, urgent], "priority").map((m) => m.title),
    ).toEqual(["Weather briefing", "Radio calls", "Airspace handout"]);
  });

  it("breaks a priority tie with the newer material", () => {
    expect(
      sortMaterials([older, newer], "priority").map((m) => m.title),
    ).toEqual(["Crosswind notes", "Airspace handout"]);
  });

  it("sorts by title without regard to when it was added", () => {
    expect(
      sortMaterials([newer, urgent, older], "title").map((m) => m.title),
    ).toEqual(["Airspace handout", "Crosswind notes", "Weather briefing"]);
  });

  it("leaves the caller's list untouched", () => {
    const list = [newer, older];
    sortMaterials(list, "title");
    expect(list.map((m) => m.title)).toEqual([
      "Crosswind notes",
      "Airspace handout",
    ]);
  });

  it("sorts by recently studied, never studied last, ties by newest added", () => {
    const a = makeMaterial({
      title: "A",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastReviewedAt: "2026-07-01T00:00:00.000Z",
    });
    const b = makeMaterial({
      title: "B",
      createdAt: "2026-02-01T00:00:00.000Z",
      lastReviewedAt: "2026-08-01T00:00:00.000Z",
    });
    const c = makeMaterial({
      title: "C",
      createdAt: "2026-03-01T00:00:00.000Z",
      lastReviewedAt: "2026-07-01T00:00:00.000Z",
    });
    const n1 = makeMaterial({
      title: "N1",
      createdAt: "2026-04-01T00:00:00.000Z",
      lastReviewedAt: null,
    });
    const n2 = makeMaterial({
      title: "N2",
      createdAt: "2026-05-01T00:00:00.000Z",
      lastReviewedAt: null,
    });
    expect(
      sortMaterials([n1, a, n2, b, c], "studied").map((m) => m.title),
    ).toEqual(["B", "C", "A", "N2", "N1"]);
  });
});
