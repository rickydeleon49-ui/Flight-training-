import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatStudyContentProvenance } from "./studyContentProvenance";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Runs a test block under an explicitly controlled time zone, restoring
 * the exact prior process.env.TZ value (or deleting it if absent) afterwards.
 */
function withTimezone<T>(tz: string, fn: () => T): T {
  const originalTz = process.env.TZ;
  try {
    process.env.TZ = tz;
    return fn();
  } finally {
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
  }
}

describe("studyContentProvenance pure helper", () => {
  describe("Gemini content provenance", () => {
    it("formats Gemini content with stored model and ISO 8601 UTC timestamp", () => {
      withTimezone("UTC", () => {
        const result = formatStudyContentProvenance("Aerodynamics Manual", {
          provider: "gemini",
          model: "gemini-1.5-flash",
          generatedAt: "2026-10-03T12:00:00.000Z",
        });

        expect(result.sourceMaterialTitle).toBe("Aerodynamics Manual");
        expect(result.isImported).toBe(false);
        expect(result.originLabel).toBe("Gemini");
        expect(result.modelLabel).toBe("gemini-1.5-flash");
        expect(result.dateText).toBe("Generated Saturday, October 3");
        expect(result.summaryText).toBe(
          "Source material: Aerodynamics Manual · Origin: Gemini · Model: gemini-1.5-flash · Generated Saturday, October 3",
        );
      });
    });

    it("formats Gemini content with SQLite space-separated UTC timestamp", () => {
      withTimezone("UTC", () => {
        const result = formatStudyContentProvenance("Crosswind Approaches", {
          provider: "gemini",
          model: "gemini-2.0-flash",
          generatedAt: "2026-10-03 12:00:00",
        });

        expect(result.sourceMaterialTitle).toBe("Crosswind Approaches");
        expect(result.originLabel).toBe("Gemini");
        expect(result.modelLabel).toBe("gemini-2.0-flash");
        expect(result.dateText).toBe("Generated Saturday, October 3");
      });
    });

    it("formats Gemini content with timezone offset in ISO 8601 string", () => {
      withTimezone("UTC", () => {
        const result = formatStudyContentProvenance("Weather Theory", {
          provider: "gemini",
          model: "gemini-1.5-pro",
          generatedAt: "2026-10-03T15:00:00+02:00",
        });

        expect(result.sourceMaterialTitle).toBe("Weather Theory");
        expect(result.dateText).toBe("Generated Saturday, October 3");
      });
    });

    it("produces 'Model unavailable' when model is empty, whitespace, or missing", () => {
      withTimezone("UTC", () => {
        const emptyModel = formatStudyContentProvenance("Sectional Chart", {
          provider: "gemini",
          model: "",
          generatedAt: "2026-10-03T12:00:00Z",
        });
        expect(emptyModel.modelLabel).toBe("Model unavailable");
        expect(emptyModel.summaryText).toContain("Model: Model unavailable");

        const whitespaceModel = formatStudyContentProvenance("Sectional Chart", {
          provider: "gemini",
          model: "   ",
          generatedAt: "2026-10-03T12:00:00Z",
        });
        expect(whitespaceModel.modelLabel).toBe("Model unavailable");

        const missingModel = formatStudyContentProvenance("Sectional Chart", {
          provider: "gemini",
          model: null,
          generatedAt: "2026-10-03T12:00:00Z",
        });
        expect(missingModel.modelLabel).toBe("Model unavailable");
      });
    });

    it("produces 'Generated date unavailable' when timestamp is invalid or missing", () => {
      withTimezone("UTC", () => {
        const badTimestamp = formatStudyContentProvenance("Weight and Balance", {
          provider: "gemini",
          model: "gemini-1.5-flash",
          generatedAt: "not-a-timestamp",
        });
        expect(badTimestamp.dateText).toBe("Generated date unavailable");
        expect(badTimestamp.summaryText).toContain("Generated date unavailable");

        const emptyTimestamp = formatStudyContentProvenance("Weight and Balance", {
          provider: "gemini",
          model: "gemini-1.5-flash",
          generatedAt: "",
        });
        expect(emptyTimestamp.dateText).toBe("Generated date unavailable");

        const nullTimestamp = formatStudyContentProvenance("Weight and Balance", {
          provider: "gemini",
          model: "gemini-1.5-flash",
          generatedAt: null,
        });
        expect(nullTimestamp.dateText).toBe("Generated date unavailable");

        const invalidCalendarDay = formatStudyContentProvenance("Weight and Balance", {
          provider: "gemini",
          model: "gemini-1.5-flash",
          generatedAt: "2026-02-31T12:00:00Z",
        });
        expect(invalidCalendarDay.dateText).toBe("Generated date unavailable");
      });
    });
  });

  describe("Imported content provenance", () => {
    it("formats imported packets with 'Imported study packet' and 'Imported <date>'", () => {
      withTimezone("UTC", () => {
        const result = formatStudyContentProvenance("Instructor Syllabus", {
          provider: "import",
          model: "",
          generatedAt: "2026-10-03T12:00:00Z",
        });

        expect(result.sourceMaterialTitle).toBe("Instructor Syllabus");
        expect(result.isImported).toBe(true);
        expect(result.originLabel).toBe("Imported study packet");
        // Must NOT suggest an external model:
        expect(result.modelLabel).toBeNull();
        expect(result.dateText).toBe("Imported Saturday, October 3");
        expect(result.summaryText).toBe(
          "Source material: Instructor Syllabus · Origin: Imported study packet · Imported Saturday, October 3",
        );
        expect(result.summaryText).not.toContain("Model");
      });
    });

    it("ignores any stored model string for imported content to avoid inventing external model provenance", () => {
      withTimezone("UTC", () => {
        const result = formatStudyContentProvenance("Third Party Notes", {
          provider: "import",
          model: "claude-or-gpt-or-gemini",
          generatedAt: "2026-10-03T12:00:00Z",
        });

        expect(result.isImported).toBe(true);
        expect(result.modelLabel).toBeNull();
        expect(result.summaryText).not.toContain("claude-or-gpt-or-gemini");
        expect(result.summaryText).not.toContain("Model");
      });
    });

    it("produces 'Imported date unavailable' when imported timestamp is invalid or missing", () => {
      withTimezone("UTC", () => {
        const result = formatStudyContentProvenance("Handout Packet", {
          provider: "import",
          generatedAt: "bad-date",
        });

        expect(result.dateText).toBe("Imported date unavailable");
        expect(result.summaryText).toContain("Imported date unavailable");
      });
    });
  });

  describe("Source material title and missing content", () => {
    it("handles missing or whitespace source material title gracefully", () => {
      withTimezone("UTC", () => {
        const emptyTitle = formatStudyContentProvenance("", {
          provider: "gemini",
          model: "gemini-1.5-flash",
          generatedAt: "2026-10-03T12:00:00Z",
        });
        expect(emptyTitle.sourceMaterialTitle).toBe("Source material unavailable");

        const nullTitle = formatStudyContentProvenance(null, {
          provider: "gemini",
          model: "gemini-1.5-flash",
          generatedAt: "2026-10-03T12:00:00Z",
        });
        expect(nullTitle.sourceMaterialTitle).toBe("Source material unavailable");
      });
    });

    it("handles null or undefined content input without throwing", () => {
      const result = formatStudyContentProvenance("PHAK Chapter 1", null);
      expect(result.sourceMaterialTitle).toBe("PHAK Chapter 1");
      expect(result.originLabel).toBe("Origin unavailable");
      expect(result.modelLabel).toBe("Model unavailable");
      expect(result.dateText).toBe("Date unavailable");
    });
  });

  describe("Timezone boundaries and local calendar day calculation", () => {
    it("correctly shifts date across UTC/local-day boundary in America/Los_Angeles (UTC-7)", () => {
      // 02:00 UTC on Oct 3 is 19:00 on Oct 2 in PDT (UTC-7).
      const lateNightUtc = "2026-10-03T02:00:00.000Z";

      withTimezone("UTC", () => {
        const utcResult = formatStudyContentProvenance("Night VFR Guide", {
          provider: "gemini",
          model: "gemini-1.5-flash",
          generatedAt: lateNightUtc,
        });
        expect(utcResult.dateText).toBe("Generated Saturday, October 3");
      });

      withTimezone("America/Los_Angeles", () => {
        const laResult = formatStudyContentProvenance("Night VFR Guide", {
          provider: "gemini",
          model: "gemini-1.5-flash",
          generatedAt: lateNightUtc,
        });
        expect(laResult.dateText).toBe("Generated Friday, October 2");
      });
    });

    it("correctly shifts date across UTC/local-day boundary in Pacific/Kiritimati (UTC+14)", () => {
      // 23:30 UTC on Oct 3 is 13:30 on Oct 4 in Kiritimati (UTC+14).
      const eveningUtc = "2026-10-03T23:30:00.000Z";

      withTimezone("UTC", () => {
        const utcResult = formatStudyContentProvenance("Island Hopping", {
          provider: "import",
          generatedAt: eveningUtc,
        });
        expect(utcResult.dateText).toBe("Imported Saturday, October 3");
      });

      withTimezone("Pacific/Kiritimati", () => {
        const kiritimatiResult = formatStudyContentProvenance("Island Hopping", {
          provider: "import",
          generatedAt: eveningUtc,
        });
        expect(kiritimatiResult.dateText).toBe("Imported Sunday, October 4");
      });
    });
  });

  describe("PDF kit provenance and mixed sets", () => {
    it("mixed_gemini_set_header_keeps_gemini_label_and_model", () => {
      withTimezone("UTC", () => {
        const validPdf = { status: "valid" as const, label: "Pulled from your PDF on this Mac" as const, sources: [] };
        const result = formatStudyContentProvenance("Crosswind Theory", {
          provider: "gemini",
          model: "gemini-1.5-flash",
          generatedAt: "2026-10-03T12:00:00Z",
          sections: [{ heading: "Section 1", body: "Text 1" }],
          flashcards: [{ front: "Q1", back: "A1", pdfProvenance: validPdf }],
        });

        expect(result.originLabel).toBe("Gemini");
        expect(result.modelLabel).toBe("gemini-1.5-flash");
        expect(result.dateText).toBe("Generated Saturday, October 3");
        expect(result.summaryText).toContain("Origin: Gemini");
        expect(result.summaryText).toContain("Model: gemini-1.5-flash");
        expect(result.summaryText).toContain("Some items pulled from your PDF on this Mac");
      });
    });

    it("all_kit_set_header_is_pdf_label_never_written_by_you", () => {
      withTimezone("UTC", () => {
        const validPdf = { status: "valid" as const, label: "Pulled from your PDF on this Mac" as const, sources: [] };
        const result = formatStudyContentProvenance("Crosswind Theory", {
          provider: "manual",
          model: "",
          generatedAt: "2026-10-03T12:00:00Z",
          sections: [{ heading: "Section 1", body: "Text 1", pdfProvenance: validPdf }],
          flashcards: [{ front: "Q1", back: "A1", pdfProvenance: validPdf }],
        });

        expect(result.originLabel).toBe("Pulled from your PDF on this Mac");
        expect(result.originLabel).not.toBe("Written by you");
        expect(result.modelLabel).toBeNull();
        expect(result.summaryText).toContain("Pulled from your PDF on this Mac");
        expect(result.summaryText).not.toContain("Written by you");
      });
    });

    it("invalid_item_source_never_changes_set_header", () => {
      withTimezone("UTC", () => {
        const invalidPdf = { status: "invalid" as const, label: "PDF source details unavailable" as const, sources: [] };
        const geminiResult = formatStudyContentProvenance("Crosswind Theory", {
          provider: "gemini",
          model: "gemini-1.5-flash",
          generatedAt: "2026-10-03T12:00:00Z",
          sections: [{ heading: "Section 1", body: "Text 1" }],
          flashcards: [{ front: "Q1", back: "A1", pdfProvenance: invalidPdf }],
        });

        expect(geminiResult.originLabel).toBe("Gemini");
        expect(geminiResult.modelLabel).toBe("gemini-1.5-flash");
        expect(geminiResult.dateText).toBe("Generated Saturday, October 3");
        expect(geminiResult.summaryText).toBe(
          "Source material: Crosswind Theory · Origin: Gemini · Model: gemini-1.5-flash · Generated Saturday, October 3",
        );
        expect(geminiResult.summaryText).not.toContain("Source details unavailable");

        const manualResult = formatStudyContentProvenance("Manual Notes", {
          provider: "manual",
          model: "",
          generatedAt: "2026-10-03T12:00:00Z",
          questions: [{ pdfProvenance: invalidPdf }],
        });

        expect(manualResult.originLabel).toBe("Pulled from your PDF on this Mac");
        expect(manualResult.summaryText).not.toContain("Written by you");
        expect(manualResult.pdfNote).toBe("Some source details are unavailable");
      });
    });
  });
});

it.each([false, true])("all_kit_manual_set_with_invalid_source_never_written_by_you (all invalid: %s)", allInvalid => {
  const invalid = { status: "invalid" as const, label: "PDF source details unavailable" as const, sources: [] };
  const valid = { status: "valid" as const, label: "Pulled from your PDF on this Mac" as const, sources: [] };
  const result = formatStudyContentProvenance("Synthetic PDF", {
    provider: "manual", model: "", summary: "Kit summary", summaryPdfProvenance: invalid,
    sections: [{ heading: "Kit section", body: "Kit text", pdfProvenance: allInvalid ? invalid : valid }],
    flashcards: [{ front: "Kit question", back: "Kit answer", pdfProvenance: invalid }],
  });
  expect(result.originLabel).toBe("Pulled from your PDF on this Mac");
  expect(result.pdfNote).toBe("Some source details are unavailable");
  expect(result.summaryText).toContain("Some source details are unavailable");
  expect(result.summaryText).not.toMatch(/Written by you|Some items pulled/);
  expect(result.modelLabel).toBeNull();
});

it.each(["gemini", "import"] as const)("invalid PDF sources preserve the %s provider header", provider => {
  const pdfProvenance = { status: "invalid" as const, label: "PDF source details unavailable" as const, sources: [] };
  const base = { provider, model: "stored-model", generatedAt: "2026-10-03T12:00:00Z" };
  expect(formatStudyContentProvenance("Synthetic PDF", { ...base, questions: [{ pdfProvenance }] }))
    .toEqual(formatStudyContentProvenance("Synthetic PDF", base));
});

it.each([{}, { summary: "My summary" }, { questions: [{}] }])("manual content without PDF provenance keeps human authorship (%j)", items => {
  const pdfProvenance = { status: "invalid" as const, label: "PDF source details unavailable" as const, sources: [] };
  const result = formatStudyContentProvenance("Synthetic PDF", {
    provider: "manual", ...items,
    sections: [{ pdfProvenance }, ...(Object.keys(items).length ? [] : [{}])],
  });
  expect(result.originLabel).toBe("Written by you");
});
