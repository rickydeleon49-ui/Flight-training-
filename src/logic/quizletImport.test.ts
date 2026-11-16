import { describe, expect, it } from "vitest";
import { parseQuizletText } from "./quizletImport";

describe("parseQuizletText", () => {
  it("splits on tabs", () => {
    const r = parseQuizletText("Lift\tUpward force\nDrag\tResists motion", []);
    expect(r.cards).toEqual([{ front: "Lift", back: "Upward force" }, { front: "Drag", back: "Resists motion" }]);
  });
  it("keeps commas inside the definition when a tab is present", () => {
    expect(parseQuizletText("A\tone, two", []).cards).toEqual([{ front: "A", back: "one, two" }]);
  });
  it("splits on the first comma when there is no tab", () => {
    expect(parseQuizletText("Lift, upward force, yes", []).cards).toEqual([{ front: "Lift", back: "upward force, yes" }]);
  });
  it("splits on a dash separator", () => {
    expect(parseQuizletText("Lift - upward force", []).cards).toEqual([{ front: "Lift", back: "upward force" }]);
  });
  it("uses semicolons as row separators on a single line", () => {
    const r = parseQuizletText("A\t1;B\t2;C\t3", []);
    expect(r.cards.map((c) => c.front)).toEqual(["A", "B", "C"]);
  });
  it("does not use semicolons when there are several lines", () => {
    expect(parseQuizletText("A\tx; y\nB\t2", []).cards).toEqual([{ front: "A", back: "x; y" }, { front: "B", back: "2" }]);
  });
  it("handles CRLF and a BOM", () => {
    const r = parseQuizletText("﻿A\t1\r\nB\t2\r\n", []);
    expect(r.cards).toEqual([{ front: "A", back: "1" }, { front: "B", back: "2" }]);
  });
  it("counts rows missing a side and ignores empty lines", () => {
    const r = parseQuizletText("A\t\n\n\tB\nOnlyTerm\nC\t3", []);
    expect(r.cards).toEqual([{ front: "C", back: "3" }]);
    expect(r.skippedBlank).toBe(3);
  });
  it("skips duplicates of existing and earlier pasted fronts", () => {
    const r = parseQuizletText("Lift\t1\n  lift  \t2\nDrag\t3\ndrag\t4", ["LIFT"]);
    expect(r.cards).toEqual([{ front: "Drag", back: "3" }]);
    expect(r.skippedDuplicates).toBe(3);
  });
  it("caps at 500 cards", () => {
    const text = Array.from({ length: 520 }, (_, i) => `t${i}\td${i}`).join("\n");
    const r = parseQuizletText(text, []);
    expect(r.cards).toHaveLength(500);
    expect(r.cut).toBe(true);
  });
});
