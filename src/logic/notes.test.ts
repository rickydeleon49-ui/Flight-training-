import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { makeNote } from "@/testing/factories";
import {
  UNTITLED_NOTE,
  noteDateLine,
  noteHeading,
  notePreview,
  searchNotes,
} from "./notes";

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

/**
 * Runs in America/Los_Angeles (UTC-7 in October) so the local day and the UTC
 * day disagree every evening. The app stores toISOString(), which is UTC.
 */
describe("noteDateLine", () => {
  const hadTz = "TZ" in process.env;
  const originalTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "America/Los_Angeles";
  });
  afterAll(() => {
    // Assigning undefined would leave the string "undefined"; remove it instead.
    if (hadTz) process.env.TZ = originalTz;
    else delete process.env.TZ;
  });

  const today = "2026-10-11";

  it("shows the local day a late-evening note was written, not the next UTC day", () => {
    // 9:30 PM Friday, October 2 in California is already October 3 in UTC.
    const stamp = "2026-10-03T04:30:00.000Z";
    expect(stamp.slice(0, 10)).toBe("2026-10-03");
    expect(noteDateLine(makeNote({ createdAt: stamp, updatedAt: stamp }), today))
      .toBe("Friday, October 2");
  });

  it("leaves out \"edited\" when both times fall on the same local day across UTC midnight", () => {
    // 4 PM and 10 PM on October 2 locally; October 2 and October 3 in UTC.
    const note = makeNote({
      createdAt: "2026-10-02T23:00:00.000Z",
      updatedAt: "2026-10-03T05:00:00.000Z",
    });
    expect(noteDateLine(note, today)).toBe("Friday, October 2");
  });

  it("shows \"edited\" when the local days differ even though the UTC day is the same", () => {
    // 11 PM October 2 and 1 AM October 3 locally; both October 3 in UTC.
    const note = makeNote({
      createdAt: "2026-10-03T06:00:00.000Z",
      updatedAt: "2026-10-03T08:00:00.000Z",
    });
    expect(noteDateLine(note, today))
      .toBe("Friday, October 2 · edited Saturday, October 3");
  });

  it("drops a time it can't read instead of showing a broken date", () => {
    const good = "2026-10-03T18:00:00.000Z";
    expect(noteDateLine(makeNote({ createdAt: good, updatedAt: "garbled" }), today))
      .toBe("Saturday, October 3");
    expect(noteDateLine(makeNote({ createdAt: "", updatedAt: good }), today))
      .toBe("Edited Saturday, October 3");
    expect(noteDateLine(makeNote({ createdAt: "", updatedAt: "garbled" }), today)).toBeNull();
  });
});
