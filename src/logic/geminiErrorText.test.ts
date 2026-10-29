import { describe, expect, it } from "vitest";

import { splitGeminiError } from "./geminiErrorText";

describe("splitGeminiError", () => {
  it("keeps the plain sentence and moves the trace into details", () => {
    const result = splitGeminiError(
      "Gemini didn't return any flashcards from this file. Nothing was saved — try again, or try a smaller part of the PDF.\nDetails: invalid or incomplete output; stage: checking Gemini's answer; generation attempts: 2; time: 0m 16s; last status: 200.",
    );
    expect(result.text).toBe(
      "Gemini didn't return any flashcards from this file. Nothing was saved — try again, or try a smaller part of the PDF.",
    );
    expect(result.details).toBe(
      "invalid or incomplete output; stage: checking Gemini's answer; generation attempts: 2; time: 0m 16s; last status: 200.",
    );
  });

  it("leaves a message without a trace untouched", () => {
    expect(splitGeminiError("Gemini is busy. Try again in a minute.")).toEqual({
      text: "Gemini is busy. Try again in a minute.",
      details: null,
    });
  });

  it("never hides a message that is only a trace", () => {
    expect(splitGeminiError("Details: stage: sending.")).toEqual({ text: "Details: stage: sending.", details: null });
  });
});
