import { describe, expect, it } from "vitest";

import type { SavedCoverage } from "@/services/offlineContent";

import { checkSavedHit, itemDigest, savedCoverageSentence, savedDestination, savedFields } from "./savedSearch";

// Shared vectors, computed outside both implementations; the native tests use the same.
const VECTORS: Array<[string[], string]> = [
  [["a", "b"], "facdde7abf1eac5b301273ab2e282f79bab0100f058833a7b8bdf9f80741e149"],
  [["é"], "2f23c71856587c2a6ffdb64f0e11e9940b35da318947308f6a02ee01898e6107"],
  [["a\u0000b", "c"], "0f45d85bef43c532705b8e59087cb895ab148782c674d20610e5975f46a84334"],
  [["a", "b\u0000c"], "948d2b0c65c70f1736d40043f14736a059763420fe3c8c71c8ea646bbf05c964"],
  [["Crosswind landings", "Use the wing-low method."], "247767ba8b30e060aed68c6d6ffde318a8ff2015ea49bac365d799aa044f9011"],
  [["✈️ fly", "日本語"], "4549eb77598f1c0f00e7ffe55a5490e1e78be88ebba40113d2ede078c768291a"],
];

const set = {
  sourceMaterialId: "m1",
  summary: "Summary",
  sections: [{ heading: "Crosswind landings", body: "Use the wing-low method." }],
  flashcards: [{ front: "a", back: "b", sourcePage: null }],
};

describe("itemDigest", () => {
  it("matches the shared vectors, including embedded NULs", async () => {
    for (const [fields, hex] of VECTORS) expect(await itemDigest(fields)).toBe(hex);
  });
});

describe("savedDestination", () => {
  it("opens the actual item, with its digest for guides and cards", () => {
    expect(savedDestination({ kind: "guide", recordId: "0", rev: "abc", snippet: "" }, "m 1")).toBe("/study/m%201?guide=0&rev=abc");
    expect(savedDestination({ kind: "summary", recordId: "summary", rev: "d", snippet: "" }, "m1")).toBe("/study/m1?guide=summary&rev=d");
    expect(savedDestination({ kind: "card", recordId: "3", rev: "e", snippet: "" }, "m1")).toBe("/study/m1?card=3&rev=e");
    expect(savedDestination({ kind: "practice", recordId: "q1", rev: null, snippet: "" }, "m1")).toBe("/study/m1?question=q1");
    expect(savedDestination({ kind: "note", recordId: "n/1", rev: null, snippet: "" }, null)).toBe("/notes?note=n%2F1");
    expect(savedDestination({ kind: "question", recordId: "q2", rev: null, snippet: "" }, null)).toBe("/questions?question=q2");
  });
});

describe("checkSavedHit", () => {
  const data = { aiStudySets: [set] as never, notes: [{ id: "n1" }] as never, questions: [{ id: "q1" }] as never };

  it("opens an unchanged guide section or card", async () => {
    const rev = await itemDigest(["Crosswind landings", "Use the wing-low method."]);
    expect(await checkSavedHit(data, { kind: "guide", recordId: "0", rev, snippet: "" }, "m1")).toBe("ok");
    expect(await checkSavedHit(data, { kind: "card", recordId: "0", rev: await itemDigest(["a", "b"]), snippet: "" }, "m1")).toBe("ok");
  });

  it("refuses different text at the same index, even with the same timestamp", async () => {
    const rev = await itemDigest(["Old heading", "Old body"]);
    expect(await checkSavedHit(data, { kind: "guide", recordId: "0", rev, snippet: "" }, "m1")).toBe("changed");
    expect(await checkSavedHit(data, { kind: "guide", recordId: "5", rev, snippet: "" }, "m1")).toBe("changed");
    expect(await checkSavedHit(data, { kind: "guide", recordId: "0", rev, snippet: "" }, "gone")).toBe("gone");
  });

  it("checks notes and questions by id", async () => {
    expect(await checkSavedHit(data, { kind: "note", recordId: "n1", rev: null, snippet: "" }, null)).toBe("ok");
    expect(await checkSavedHit(data, { kind: "note", recordId: "n9", rev: null, snippet: "" }, null)).toBe("gone");
    expect(await checkSavedHit(data, { kind: "question", recordId: "q9", rev: null, snippet: "" }, null)).toBe("gone");
  });

  it("never treats a malformed index as a real item", () => {
    expect(savedFields(set, { kind: "card", recordId: "-1" })).toBeNull();
    expect(savedFields(set, { kind: "card", recordId: "1.5" })).toBeNull();
    expect(savedFields(set, { kind: "card", recordId: "x" })).toBeNull();
  });
});

describe("savedCoverageSentence", () => {
  const c: SavedCoverage = { studySets: 3, practiceVersions: 1, notes: 12, questions: 0, tooLargeItems: 2 };
  it("says what was searched and what was too large", () => {
    expect(savedCoverageSentence("ok", c, 0)).toBe(
      "No matches in your saved study content (3 study guides, 1 practice test, 12 notes). 2 items are too large to search.",
    );
    expect(savedCoverageSentence("too_large", c, 0)).toMatch(/too large to search offline/);
    expect(savedCoverageSentence("unavailable", c, 0)).toMatch(/can't be searched just now/);
  });
});
