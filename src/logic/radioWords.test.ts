// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RadioWords } from "@/pages/PilotToolkit/RadioWords";
import { RADIO_WORDS, RADIO_WORD_MAX_WORDS, filterRadioWords, wordCount } from "./radioWords";

afterEach(cleanup);

describe("radio words data", () => {
  it("has 60-80 unique terms with short non-empty meanings", () => {
    expect(RADIO_WORDS.length).toBeGreaterThanOrEqual(60);
    expect(RADIO_WORDS.length).toBeLessThanOrEqual(80);
    const terms = RADIO_WORDS.map((w) => w.term.toLowerCase());
    expect(new Set(terms).size).toBe(terms.length);
    for (const w of RADIO_WORDS) {
      expect(w.meaning.trim().length).toBeGreaterThan(0);
      expect(wordCount(w.meaning)).toBeLessThanOrEqual(RADIO_WORD_MAX_WORDS);
    }
  });
  it("filters by search", () => {
    expect(filterRadioWords("")).toHaveLength(RADIO_WORDS.length);
    expect(filterRadioWords("WILCO").map((w) => w.term)).toContain("Wilco");
    expect(filterRadioWords("zzzzqq")).toHaveLength(0);
  });
});

describe("RadioWords component", () => {
  it("searches and quizzes", () => {
    render(h(RadioWords));
    fireEvent.change(screen.getByLabelText("Search radio words"), { target: { value: "zzzzqq" } });
    expect(screen.getByText("0 of " + RADIO_WORDS.length + " terms")).toBeTruthy();
    fireEvent.click(screen.getByText("Quiz me"));
    expect(screen.queryByText(RADIO_WORDS[0]!.meaning)).toBeNull();
    fireEvent.click(screen.getByText("Reveal"));
    expect(screen.getByText(RADIO_WORDS[0]!.meaning)).toBeTruthy();
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Reveal")).toBeTruthy();
  });
});
