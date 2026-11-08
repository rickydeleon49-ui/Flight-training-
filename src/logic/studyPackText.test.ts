import { describe, expect, it } from "vitest";

import type { StudyPackPreview, StudyPackResult } from "@/data/studyPack";
import { addedLine, packAlreadyHaveLine, packContentsLine, resultLines } from "./studyPackText";

const base: StudyPackResult = {
  operationId: "op", packId: "p", added: 0, addedGuides: 0, addedDocuments: 0, addedPictures: 0, addedPractice: 0,
  skipped: 0, newVersions: 0, readded: 0, cardsLeftOut: 0, cardsLeftOutRemoved: 0, committedAt: "2026-11-07T00:00:00Z",
};
const result = (patch: Partial<StudyPackResult>): StudyPackResult => ({ ...base, ...patch });

describe("study pack sentences", () => {
  it("counts only what the pack holds", () => {
    const p: StudyPackPreview = { guides: 14, cards: 280, questions: 140, videos: 31, documents: 14, alreadyInLibrary: 0 };
    expect(packContentsLine(p)).toBe("14 guides · 280 cards · 140 practice questions · 31 videos · 14 PDFs");
    expect(packContentsLine({ ...p, guides: 1, cards: 0, questions: 0, videos: 0, documents: 1 })).toBe("1 guide · 1 PDF");
  });

  it("says 'already in your library' only when non-zero", () => {
    expect(packAlreadyHaveLine({ guides: 1, cards: 0, questions: 0, videos: 0, documents: 0, alreadyInLibrary: 0 })).toBeNull();
    expect(packAlreadyHaveLine({ guides: 1, cards: 0, questions: 0, videos: 0, documents: 0, alreadyInLibrary: 3 })).toBe("3 are already in your library.");
    expect(packAlreadyHaveLine({ guides: 1, cards: 0, questions: 0, videos: 0, documents: 0, alreadyInLibrary: 1 })).toBe("1 is already in your library.");
  });

  it("builds the Added line from guides and PDFs only, dropping a zero part, never naming pictures", () => {
    expect(addedLine(result({ added: 20, addedGuides: 11, addedDocuments: 3, addedPictures: 6 }))).toBe("Added 11 guides and 3 PDFs. Your own work wasn't changed.");
    expect(addedLine(result({ added: 4, addedGuides: 1, addedPictures: 3 }))).toBe("Added 1 guide. Your own work wasn't changed.");
    expect(addedLine(result({ added: 2, addedDocuments: 2 }))).toBe("Added 2 PDFs. Your own work wasn't changed.");
    expect(addedLine(result({ added: 3, addedPictures: 3 }))).not.toMatch(/picture/i);
  });

  it("shows added-back, another-version and left-out lines only when non-zero", () => {
    expect(resultLines(result({ addedGuides: 2 }))).toHaveLength(1);
    expect(resultLines(result({ addedGuides: 2, newVersions: 2 }))[1]).toBe("2 are other versions of guides you have, added next to yours (marked “updated”).");
    expect(resultLines(result({ addedGuides: 2, newVersions: 1 }))[1]).toBe("1 is another version of a guide you have, added next to yours (marked “updated”).");
    expect(resultLines(result({ addedGuides: 2, readded: 1 }))[1]).toBe("1 you had removed was added back.");
    expect(resultLines(result({ addedGuides: 2, readded: 3 }))[1]).toBe("3 you had removed were added back.");
  });

  it("words each reason for left-out cards separately", () => {
    const lines = resultLines(result({ addedGuides: 1, cardsLeftOut: 7, cardsLeftOutRemoved: 4 }));
    expect(lines).toContain("4 picture cards were left out because you removed their picture.");
    expect(lines).toContain("3 picture cards were left out because their picture couldn't be used.");
    expect(resultLines(result({ addedGuides: 1, cardsLeftOut: 1, cardsLeftOutRemoved: 1 }))[1]).toBe("1 picture card was left out because you removed its picture.");
    expect(resultLines(result({ addedGuides: 1, cardsLeftOut: 4, cardsLeftOutRemoved: 4 }))).toHaveLength(2);
  });

  it("says nothing was changed when everything was already there", () => {
    expect(resultLines(result({ skipped: 5 }))).toEqual(["Everything in this study pack was already in your library. Nothing was changed."]);
  });

  it("never says 'newer' in any result sentence", () => {
    const all = resultLines(result({ addedGuides: 3, addedDocuments: 2, newVersions: 2, readded: 2, cardsLeftOut: 5, cardsLeftOutRemoved: 2 }));
    for (const line of all) expect(line.toLowerCase()).not.toContain("newer");
  });
});
