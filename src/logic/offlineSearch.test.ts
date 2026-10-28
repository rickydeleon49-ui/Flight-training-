import { describe, expect, it } from "vitest";

import type { SearchCoverage } from "@/services/offlineContent";

import { coverageSentence, destinationProblem, pagePlace, searchProblem, snippetPieces } from "./offlineSearch";

const none: SearchCoverage = {
  searchedDocuments: 0,
  searchedPages: 0,
  imagePages: 0,
  otherUnsearchablePages: 0,
  notPrepared: 0,
  notChecked: 0,
  preparing: 0,
  couldNotPrepare: 0,
  missing: 0,
  notPdf: 0,
};

describe("snippetPieces", () => {
  it("splits on markers and keeps everything else as text", () => {
    expect(snippetPieces("a \u{E000}crosswind\u{E001} landing <b>x</b>")).toEqual([
      { text: "a ", mark: false },
      { text: "crosswind", mark: true },
      { text: " landing <b>x</b>", mark: false },
    ]);
  });

  it("ignores stray and nested markers", () => {
    expect(snippetPieces("\u{E001}a\u{E000}\u{E000}b\u{E001}\u{E001}c")).toEqual([
      { text: "a", mark: false },
      { text: "b", mark: true },
      { text: "c", mark: false },
    ]);
  });
});

describe("coverageSentence", () => {
  it("acknowledges saved content only when it was searched", () => {
    expect(coverageSentence(none, 0, true, true)).toBe("PDF text isn’t ready to search yet — your saved study content and homework were searched.");
    expect(coverageSentence(none, 0, false)).not.toContain("were searched");
    expect(coverageSentence(none, 0, true)).toBe("PDF text isn’t ready to search yet — your saved study content was searched.");
  });
  it("separates no match from not searched", () => {
    expect(coverageSentence({ ...none, searchedDocuments: 12, searchedPages: 3041, notPrepared: 4 }, 0)).toBe(
      "No matches in 12 documents (3,041 pages). 4 PDFs aren't ready to search yet.",
    );
    expect(coverageSentence({ ...none, notPrepared: 1 }, 0)).toBe(
      "1 PDF isn't ready to search yet.",
    );
  });

  it("PACKS-06 gives one preparation notice when no PDFs could be searched", () => {
    expect(coverageSentence({ ...none, notPrepared: 1 }, 0, true)).toBe("Your saved study content was searched. 1 PDF isn't ready to search yet.");
    expect(coverageSentence({ ...none, notPrepared: 2 }, 0, true, true)).toBe("Your saved study content and homework were searched. 2 PDFs aren't ready to search yet.");
  });

  it("reports every exclusion with singulars and no guesses", () => {
    const text = coverageSentence(
      { ...none, searchedDocuments: 1, searchedPages: 1, notChecked: 1, preparing: 2, couldNotPrepare: 1, missing: 1, imagePages: 1, otherUnsearchablePages: 25 },
      1,
    );
    expect(text).toBe(
      "Searched 1 document (1 page). 1 document is still being checked. 2 documents are being prepared. 1 document couldn't be prepared. 1 file is missing from this Mac. 1 page is an image, so text recognition would be needed to search it. 25 pages couldn't be read.",
    );
    expect(text).not.toMatch(/scan/i);
  });
});

describe("searchProblem", () => {
  it("stays quiet for superseded and empty searches, and never shows a code", () => {
    expect(searchProblem("superseded")).toBeNull();
    expect(searchProblem("empty_query")).toBeNull();
    for (const code of ["query_too_long", "too_many_terms", "term_too_long", "timeout", "offset_too_deep", "too_many_materials", "index_unavailable", "worker_failed:x"]) {
      const text = searchProblem(code);
      expect(text).toBeTruthy();
      expect(text).not.toContain(code);
    }
  });
});

describe("destinations and pages", () => {
  it("explains a changed or missing file", () => {
    expect(destinationProblem("changed")).toMatch(/changed since you searched/);
    expect(destinationProblem("missing")).toMatch(/isn't on this Mac/);
  });

  it("adds the original's page for a split part, only within the part", () => {
    const lineage = { sourcePageStart: 101, childPageCount: 10, sourceTitle: "Pilot's Handbook" };
    expect(pagePlace(3, null)).toBe("PDF page 3");
    expect(pagePlace(3, lineage)).toBe("PDF page 3 (page 103 of Pilot's Handbook)");
    expect(pagePlace(11, lineage)).toBe("PDF page 11");
  });
});
