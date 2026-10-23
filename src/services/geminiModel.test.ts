import { describe, expect, it } from "vitest";

import { GEMINI_MODEL_CHOICES, geminiModelName } from "@/services/gemini";

describe("geminiModelName", () => {
  it("reads model IDs the way she would say them", () => {
    expect(geminiModelName("gemini-4-argon")).toBe("Gemini 4 Argon");
    expect(geminiModelName("gemini-3.5-flash")).toBe("Gemini 3.5 Flash");
    expect(geminiModelName("gemini-3.8-flash")).toBe("Gemini 3.8 Flash");
    expect(geminiModelName("gemini-3.5-flash-lite")).toBe("Gemini Flash-Lite");
  });

  it("shows an unknown ID as it is, and never throws on a missing one", () => {
    expect(geminiModelName("gemini-9-future")).toBe("gemini-9-future");
    expect(geminiModelName("")).toBe("Gemini");
    expect(geminiModelName(null as never)).toBe("Gemini");
  });
});

describe("GEMINI_MODEL_CHOICES", () => {
  it("describes both current models without requiring billing", () => {
    expect(GEMINI_MODEL_CHOICES.standard.detail).toContain("free");
    expect(GEMINI_MODEL_CHOICES["most-capable"].label).toContain("Gemini 3.8 Flash");
    expect(GEMINI_MODEL_CHOICES["most-capable"].detail).toContain("may use slightly more of your Google credits");
    expect(JSON.stringify(GEMINI_MODEL_CHOICES)).not.toMatch(/Argon|billing|costs more per document/);
  });
});
