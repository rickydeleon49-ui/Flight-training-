import { describe, expect, it } from "vitest";

import { WORD_DIFF_MAX_CHARS, wordDiff, type TextDiffPart } from "./textDiff";

const after = (parts: TextDiffPart[]) => parts.filter((part) => part.kind !== "removed").map((part) => part.text).join("");
const changed = (parts: TextDiffPart[], kind: TextDiffPart["kind"]) => parts.filter((part) => part.kind === kind).map((part) => part.text);

describe("wordDiff", () => {
  it("reports identical text as one unchanged part", () => {
    expect(wordDiff("Stall speed is 48 knots.", "Stall speed is 48 knots.")).toEqual([{ kind: "same", text: "Stall speed is 48 knots." }]);
    expect(wordDiff("", "")).toEqual([]);
  });

  it("marks a pure insertion as added", () => {
    const parts = wordDiff("Check the fuel.", "Check the fuel quantity.")!;
    expect(changed(parts, "added")).toEqual(["quantity"]);
    expect(changed(parts, "removed")).toEqual([]);
    expect(after(parts)).toBe("Check the fuel quantity.");
  });

  it("marks a pure deletion as removed", () => {
    const parts = wordDiff("Check the fuel quantity.", "Check the fuel.")!;
    expect(changed(parts, "removed")).toEqual([" quantity"]);
    expect(changed(parts, "added")).toEqual([]);
    expect(after(parts)).toBe("Check the fuel.");
  });

  it("marks a replaced word as removed then added", () => {
    const parts = wordDiff("Vso is 50 knots", "Vso is 48 knots")!;
    expect(parts).toEqual([
      { kind: "same", text: "Vso is " },
      { kind: "removed", text: "50" },
      { kind: "added", text: "48" },
      { kind: "same", text: " knots" },
    ]);
  });

  it("keeps emoji and accented words whole", () => {
    const parts = wordDiff("fly 🛩️ high over the café", "fly ✈️ high over the cafe")!;
    expect(changed(parts, "removed")).toEqual(["🛩️", "café"]);
    expect(changed(parts, "added")).toEqual(["✈️", "cafe"]);
    expect(after(parts)).toBe("fly ✈️ high over the cafe");
  });

  it("does not report a whitespace-only change, and keeps the new spacing", () => {
    const parts = wordDiff("one two\nthree", "one  two three")!;
    expect(parts).toEqual([{ kind: "same", text: "one  two three" }]);
  });

  it("returns plain text characters, never markup", () => {
    const parts = wordDiff("<b>old</b>", "<b>new</b> & more")!;
    expect(after(parts)).toBe("<b>new</b> & more");
  });

  it("falls back (null) when either side is over the cap", () => {
    const long = "word ".repeat(WORD_DIFF_MAX_CHARS / 5 + 1);
    expect(long.length).toBeGreaterThan(WORD_DIFF_MAX_CHARS);
    expect(wordDiff(long, "short")).toBeNull();
    expect(wordDiff("short", long)).toBeNull();
    const atCap = "a".repeat(WORD_DIFF_MAX_CHARS);
    expect(wordDiff(atCap, atCap)).toEqual([{ kind: "same", text: atCap }]);
  });
});
