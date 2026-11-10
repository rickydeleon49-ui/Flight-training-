import { describe, expect, it } from "vitest";

import { makeMaterial } from "@/testing/factories";
import {
  appendPositions,
  moveWithin,
  placeBefore,
  positionsFor,
  sectionsByFolder,
  sectionsByTopic,
  sectionsByType,
  validateFolderName,
  type LibraryFolder,
  type LibraryPlacement,
} from "./libraryFolders";

const T = "2026-01-01T00:00:00.000Z";
const folder = (id: string, name: string, position: number): LibraryFolder => ({
  id,
  name,
  position,
  createdAt: T,
  updatedAt: T,
});
const place = (
  materialId: string,
  folderId: string | null,
  position: number | null = null,
): LibraryPlacement => ({
  materialId,
  folderId,
  position,
  updatedAt: T,
});

describe("validateFolderName", () => {
  const existing = [folder("f1", "Weather", 1)];
  it("trims and accepts", () => {
    expect(validateFolderName("  Radio  ", existing)).toEqual({
      ok: true,
      name: "Radio",
    });
  });
  it("rejects empty, long, reserved and duplicate names", () => {
    expect(validateFolderName("   ", existing)).toEqual({
      ok: false,
      message: "Give the folder a name.",
    });
    expect(validateFolderName("x".repeat(41), existing)).toEqual({
      ok: false,
      message: "Use 40 characters or fewer.",
    });
    expect(validateFolderName("NOT IN A FOLDER", existing)).toEqual({
      ok: false,
      message: "That name is used by the app.",
    });
    expect(validateFolderName("weather", existing)).toEqual({
      ok: false,
      message: "You already have a folder called weather.",
    });
  });
  it("counts characters, not UTF-16 units", () => {
    expect(validateFolderName("\u{1F600}".repeat(40), existing).ok).toBe(true);
    expect(validateFolderName("\u{1F600}".repeat(41), existing).ok).toBe(false);
  });
  it("lets a rename keep its own name", () => {
    expect(validateFolderName("Weather", existing, "f1")).toEqual({
      ok: true,
      name: "Weather",
    });
  });
});

describe("sectionsByFolder", () => {
  const a = makeMaterial({
    id: "a",
    title: "A",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  const b = makeMaterial({
    id: "b",
    title: "B",
    createdAt: "2026-02-01T00:00:00.000Z",
  });
  const c = makeMaterial({
    id: "c",
    title: "C",
    createdAt: "2026-03-01T00:00:00.000Z",
  });
  const d = makeMaterial({
    id: "d",
    title: "D",
    createdAt: "2026-04-01T00:00:00.000Z",
  });

  it("shows every material exactly once, even with dangling placements", () => {
    const folders = [folder("f2", "Second", 2), folder("f1", "First", 1)];
    const placements = [
      place("a", "f1"),
      place("b", "gone"), // unknown folder
      place("c", null),
      place("ghost", "f1"), // material not in the list
      place("a", "f2"), // duplicate row: last one wins, still once
    ];
    const sections = sectionsByFolder(
      [a, b, c, d],
      folders,
      placements,
      "recent",
    );
    expect(sections.map((s) => s.title)).toEqual([
      "First",
      "Second",
      "Not in a folder",
    ]);
    const all = sections.flatMap((s) => s?.items.map((m) => m.id)).sort();
    expect(all).toEqual(["a", "b", "c", "d"]);
    expect(sections[1]?.items.map((m) => m.id)).toEqual(["a"]);
    expect(sections[2]?.key).toBe("none");
    expect(sections[2]?.items.map((m) => m.id)).toEqual(["d", "c", "b"]);
  });

  it("keeps empty folders and orders them with a deterministic tiebreak", () => {
    const folders = [
      folder("z", "Same", 1),
      folder("y", "Same", 1),
      folder("x", "Alpha", 1),
    ];
    const sections = sectionsByFolder([], folders, [], "title");
    expect(sections.map((s) => s.folderId)).toEqual(["x", "y", "z", null]);
  });

  it("manual order: positioned first by position, then the rest by recent", () => {
    const folders = [folder("f1", "F", 1)];
    const placements = [
      place("a", "f1", 2),
      place("b", "f1", 1),
      place("c", "f1", null),
      place("d", "f1", null),
    ];
    const [s] = sectionsByFolder([a, b, c, d], folders, placements, "manual");
    expect(s?.items.map((m) => m.id)).toEqual(["b", "a", "d", "c"]);
  });

  it("manual order breaks duplicate positions by title then id", () => {
    const folders = [folder("f1", "F", 1)];
    const placements = [place("a", "f1", 1), place("b", "f1", 1)];
    const [s] = sectionsByFolder([b, a], folders, placements, "manual");
    expect(s?.items.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("other sorts use sortMaterials", () => {
    const [s] = sectionsByFolder([a, b], [], [], "title");
    expect(s?.items.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("sectionsByTopic / sectionsByType", () => {
  const w = makeMaterial({
    id: "w",
    topic: "weather",
    materialType: "checklist",
  });
  const n = makeMaterial({
    id: "n",
    topic: "navigation",
    materialType: "reference",
  });
  it("skips empty sections and keeps option order", () => {
    expect(sectionsByTopic([n, w], "recent").map((s) => s.title)).toEqual([
      "Weather",
      "Navigation",
    ]);
    expect(sectionsByType([n, w], "recent").map((s) => s.title)).toEqual([
      "Checklist",
      "Reference",
    ]);
    expect(sectionsByTopic([], "recent")).toEqual([]);
  });
});

describe("ordering helpers", () => {
  it("moveWithin swaps and stops at the edges", () => {
    expect(moveWithin(["a", "b", "c"], "b", "up")).toEqual(["b", "a", "c"]);
    expect(moveWithin(["a", "b", "c"], "b", "down")).toEqual(["a", "c", "b"]);
    expect(moveWithin(["a", "b"], "a", "up")).toEqual(["a", "b"]);
    expect(moveWithin(["a", "b"], "b", "down")).toEqual(["a", "b"]);
  });
  it("placeBefore moves before a target or to the end", () => {
    expect(placeBefore(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(placeBefore(["a", "b", "c"], "a", null)).toEqual(["b", "c", "a"]);
    expect(placeBefore(["a", "b", "c"], "a", "a")).toEqual(["b", "c", "a"]);
  });
  it("positionsFor and appendPositions", () => {
    expect(positionsFor(["a", "b"])).toEqual([
      { materialId: "a", position: 1 },
      { materialId: "b", position: 2 },
    ]);
    expect(appendPositions(5, ["x", "y"])).toEqual([
      { materialId: "x", position: 6 },
      { materialId: "y", position: 7 },
    ]);
    expect(appendPositions(null, ["x"])).toEqual([
      { materialId: "x", position: 1 },
    ]);
  });
});
