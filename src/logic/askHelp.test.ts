import { describe, expect, it } from "vitest";

import { guideTopics, isVagueQuestion, notAnsweredMessage, pageRangeLabel, vagueQuestionReply } from "./askHelp";

describe("guideTopics", () => {
  it("takes the topic headings inside a saved guide, then topic section headings, up to five", () => {
    const sections = [
      { heading: "Pages 1–32", body: "Overview.\n\n### Magnetic compass\n- a\n### **Compass errors**\n- b\n### Magnetic compass\n" },
      { heading: "Study guide", body: "## Gyroscopic instruments\n### Attitude indicator\n### Heading indicator\n### Turn coordinator" },
      { heading: "Pitot-static system", body: "Plain text." },
    ];
    expect(guideTopics(sections)).toEqual([
      "Magnetic compass",
      "Compass errors",
      "Gyroscopic instruments",
      "Attitude indicator",
      "Heading indicator",
    ]);
    expect(guideTopics(sections, 10)).toContain("Pitot-static system");
    expect(guideTopics(sections, 10)).not.toContain("Pages 1–32");
    expect(guideTopics(sections, 10)).not.toContain("Study guide");
    expect(guideTopics(undefined)).toEqual([]);
  });
});

describe("notAnsweredMessage", () => {
  it("names the pages, what the PDF covers and where to go next, without naming a provider", () => {
    expect(notAnsweredMessage("pages 1–32", ["Magnetic compass", "Compass errors"])).toBe(
      "That isn't in these pages (pages 1–32). This PDF covers: Magnetic compass; Compass errors. Try another chapter, or ask your instructor.",
    );
    expect(notAnsweredMessage(null, [])).toBe("That isn't in these pages. Try another chapter, or ask your instructor.");
    const message = notAnsweredMessage(null, ["a", "b", "c", "d", "e", "f"]);
    expect(message).toContain("a; b; c; d; e.");
    expect(message).not.toMatch(/Gemini|Claude/);
  });

  it("labels a known page count", () => {
    expect(pageRangeLabel(32)).toBe("pages 1–32");
    expect(pageRangeLabel(1)).toBe("page 1");
    expect(pageRangeLabel(null)).toBeNull();
    expect(pageRangeLabel(0)).toBeNull();
  });
});

describe("vague questions", () => {
  it.each(["why?", "Why", "?", "  ", "explain", "Explain this.", "huh??", "I don’t understand"])("%j names no topic", (q) => {
    expect(isVagueQuestion(q)).toBe(true);
  });
  it.each(["Why does the compass lag in a turn?", "explain acceleration error", "why 1,000 feet?", "What is precession?"])("%j is a real question", (q) => {
    expect(isVagueQuestion(q)).toBe(false);
  });
  it("asks which part, with up to three topic examples", () => {
    expect(vagueQuestionReply(["Magnetic compass", "Compass errors", "Attitude indicator", "Extra"])).toBe(
      "Which part do you mean? For example: “Magnetic compass”, “Compass errors” and “Attitude indicator”.",
    );
    expect(vagueQuestionReply(["Magnetic compass"])).toBe("Which part do you mean? For example: “Magnetic compass”.");
    expect(vagueQuestionReply([])).toBe("Which part do you mean? For example, name a topic or a page from this PDF.");
  });
});

import { citedPdfPage, sentLine } from "./askHelp";

describe("card Why? page text", () => {
  it("maps a card's source page to a page of this PDF", () => {
    expect(citedPdfPage(16, null)).toBe(16);
    expect(citedPdfPage(null, null)).toBeNull();
    expect(citedPdfPage(0, null)).toBeNull();
    // A part holding pages 200–240 of the handbook: page 214 is its 15th page.
    const part = { sourcePageStart: 200, sourcePageEnd: 240, childPageCount: 41 };
    expect(citedPdfPage(214, part)).toBe(15);
    expect(citedPdfPage(15, part)).toBe(15);
    expect(citedPdfPage(500, part)).toBeNull();
  });

  it("says truthfully what was sent", () => {
    expect(sentLine("card", [14, 15, 16, 17, 18])).toBe("Sent: this card and the text of pages 14–18");
    expect(sentLine("question", [3])).toBe("Sent: this question and the text of page 3");
    expect(sentLine("card", [])).toBe("Sent: this card only");
    expect(sentLine("card", undefined)).toBe("Sent: this card only");
  });
});
