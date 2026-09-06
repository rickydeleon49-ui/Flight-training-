import { describe, expect, it } from "vitest";

import { makeNote } from "@/testing/factories";
import { UNTITLED_NOTE, noteHeading, notePreview, searchNotes } from "./notes";

describe("noteHeading", () => {
  it("uses her title when she wrote one", () => {
    expect(noteHeading(makeNote({ title: "Schools to call", body: "North field" })))
      .toBe("Schools to call");
  });

  it("falls back to the first line she typed", () => {
    expect(noteHeading(makeNote({ title: "", body: "\n  Ask about night flying\nand cost" })))
      .toBe("Ask about night flying");
  });

  it("still has something to show for a note that is only whitespace", () => {
    expect(noteHeading(makeNote({ title: "   ", body: "  \n " }))).toBe(UNTITLED_NOTE);
  });
});

describe("notePreview", () => {
  it("shows the whole note under a title she wrote", () => {
    expect(notePreview(makeNote({ title: "Schools", body: "North field\nSouth field" })))
      .toBe("North field\nSouth field");
  });

  it("does not repeat the line already used as the heading", () => {
    expect(notePreview(makeNote({ title: "", body: "Ask about night flying\nand the cost" })))
      .toBe("and the cost");
  });

  it("is empty when the heading was the whole note", () => {
    expect(notePreview(makeNote({ title: "", body: "Call the north field" }))).toBe("");
  });
});

describe("searchNotes", () => {
  const notes = [
    makeNote({ id: "n1", title: "Schools to call", body: "north field" }),
    makeNote({ id: "n2", title: "", body: "Bring the headset receipt" }),
  ];

  it("returns everything for an empty query", () => {
    expect(searchNotes(notes, "   ")).toEqual(notes);
  });

  it("matches the title and the text, ignoring case", () => {
    expect(searchNotes(notes, "SCHOOLS").map((note) => note.id)).toEqual(["n1"]);
    expect(searchNotes(notes, "headset").map((note) => note.id)).toEqual(["n2"]);
    expect(searchNotes(notes, "helicopter")).toEqual([]);
  });
});
