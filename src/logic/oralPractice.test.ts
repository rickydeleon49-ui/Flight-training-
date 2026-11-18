import { describe, expect, it } from "vitest";

import { oralAnswerFirstLine } from "@/data/oralAnswers";
import { clipText, missedPointCards, oralNoteDraft } from "@/logic/oralPractice";

const brokenPair = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

describe("oral practice text cutting", () => {
  it("never splits an emoji when cutting", () => {
    expect(clipText("ab😀cd", 3)).toBe("ab😀");
    expect(clipText("ab😀cd", 2)).toBe("ab");
    expect(clipText("short", 10)).toBe("short");
  });

  it("keeps a long scenario card front whole and within 1,000 characters", () => {
    const [card] = missedPointCards("😀".repeat(1200), ["Point"], [false]);
    expect(card!.front).toBe(`${"😀".repeat(959)}… Key point?`);
    expect(brokenPair.test(card!.front)).toBe(false);
    expect(Array.from(card!.front).length).toBeLessThanOrEqual(1000);
  });

  it("does not shorten a scenario of 960 emoji (1,920 code units)", () => {
    const [card] = missedPointCards("😀".repeat(960), ["Point"], [false]);
    expect(card!.front).toBe(`${"😀".repeat(960)} Key point?`);
  });

  it("keeps note titles and earlier-answer lines whole", () => {
    const draft = oralNoteDraft({ scenario: "x".repeat(56) + "😀😀😀", assumptions: "", answer: "", coveredPoints: [] });
    expect(brokenPair.test(draft.title)).toBe(false);
    expect(brokenPair.test(oralAnswerFirstLine("😀".repeat(200)))).toBe(false);
  });
});
