import { describe, it, expect } from "vitest";
import {
  buildFlashcardCsv,
  needsFormulaMitigation,
  sanitizeCellForSpreadsheet,
  formatCsvCell,
  formatSourcePages,
  cardProvenanceLabel,
  type FlashcardCsvItem,
} from "./flashcardCsv";
import type { ExportSource } from "./studyExport";
import type { StudyFlashcard, AiStudySet } from "@/domain/types";
import type { PdfItemProvenance } from "@/data/pdfKitSources";

describe("flashcardCsv", () => {
  const dummySet = (overrides?: Partial<AiStudySet>): AiStudySet => ({
    sourceMaterialId: "mat-1",
    title: "VFR Navigation",
    summary: "Summary text",
    sections: [],
    flashcards: [],
    sourceNotes: "",
    provider: "gemini",
    model: "gemini-2.5-flash",
    generatedAt: "2026-10-20T12:00:00Z",
    updatedAt: "2026-10-20T12:00:00Z",
    ...overrides,
  });

  const dummyCard = (overrides?: Partial<StudyFlashcard>): StudyFlashcard => ({
    itemId: "card-1",
    front: "What is V_so?",
    back: "Stall speed in landing configuration.",
    sourcePage: 12,
    ...overrides,
  });

  describe("CSV Contract: Header, quoting, LF endings, and order", () => {
    it("outputs header row and LF record ending even with no items or no cards", () => {
      const csv = buildFlashcardCsv([]);
      expect(csv).toBe('"Front","Back","Material","Source pages","Source / provenance"\n');
    });

    it("quotes every field and preserves card and material order", () => {
      const item1: FlashcardCsvItem = {
        source: {
          material: { title: "Material 1" },
          studySet: dummySet({
            provider: "gemini",
            model: "gemini-1.5",
            flashcards: [
              dummyCard({ front: "Card 1A", back: "Ans 1A", sourcePage: 10 }),
              dummyCard({ front: "Card 1B", back: "Ans 1B", sourcePage: 20 }),
            ],
          }),
          practiceTest: null,
        },
        selection: { guide: false, flashcards: true, questions: false },
      };

      const item2: FlashcardCsvItem = {
        source: {
          material: { title: "Material 2" },
          studySet: dummySet({
            provider: "gemini",
            model: "gemini-1.5",
            flashcards: [
              dummyCard({ front: "Card 2A", back: "Ans 2A", sourcePage: 30 }),
            ],
          }),
          practiceTest: null,
        },
        selection: { guide: false, flashcards: true, questions: false },
      };

      const csv = buildFlashcardCsv([item1, item2]);
      const lines = csv.split("\n");
      expect(lines).toHaveLength(5); // Header + 3 card rows + trailing empty line from LF
      expect(lines[0]).toBe('"Front","Back","Material","Source pages","Source / provenance"');
      expect(lines[1]).toBe('"Card 1A","Ans 1A","Material 1","10","AI-generated study aid (gemini-1.5)"');
      expect(lines[2]).toBe('"Card 1B","Ans 1B","Material 1","20","AI-generated study aid (gemini-1.5)"');
      expect(lines[3]).toBe('"Card 2A","Ans 2A","Material 2","30","AI-generated study aid (gemini-1.5)"');
      expect(lines[4]).toBe("");
    });

    it("ignores items where selection.flashcards is false", () => {
      const item1: FlashcardCsvItem = {
        source: {
          material: { title: "Material 1" },
          studySet: dummySet({
            flashcards: [dummyCard({ front: "Ignored" })],
          }),
          practiceTest: null,
        },
        selection: { guide: true, flashcards: false, questions: true },
      };

      const csv = buildFlashcardCsv([item1]);
      expect(csv).toBe('"Front","Back","Material","Source pages","Source / provenance"\n');
    });
  });

  describe("Quotes, commas, embedded newlines, and Unicode", () => {
    it("doubles embedded double quotes and preserves commas, newlines, and Unicode", () => {
      const unicodeFront = 'Explain "V-speeds" & \u2708\ufe0f\nLine 2 with comma, and emoji \ud83d\udeeb';
      const unicodeBack = 'Answer includes "quotes", commas, and \n• Bullet points \u2728';

      const item: FlashcardCsvItem = {
        source: {
          material: { title: 'Aerodynamics: "Principles" & Practice' },
          studySet: dummySet({
            provider: "manual",
            model: "",
            flashcards: [
              dummyCard({
                front: unicodeFront,
                back: unicodeBack,
                sourcePage: 5,
              }),
            ],
          }),
          practiceTest: null,
        },
        selection: { guide: false, flashcards: true, questions: false },
      };

      const csv = buildFlashcardCsv([item]);
      // The expected row has escaped quotes `""`
      const expectedFront = '"Explain ""V-speeds"" & \u2708\ufe0f\nLine 2 with comma, and emoji \ud83d\udeeb"';
      const expectedBack = '"Answer includes ""quotes"", commas, and \n• Bullet points \u2728"';
      const expectedMaterial = '"Aerodynamics: ""Principles"" & Practice"';
      const expectedPages = '"5"';
      const expectedProv = '"Written by hand in Her Flight Deck"';

      const expectedRow = `${expectedFront},${expectedBack},${expectedMaterial},${expectedPages},${expectedProv}`;
      expect(csv).toContain(expectedRow);
    });
  });

  describe("Blank optional fields and page union", () => {
    it("renders empty string for missing optional source pages", () => {
      const item: FlashcardCsvItem = {
        source: {
          material: { title: "Rules" },
          studySet: dummySet({
            flashcards: [dummyCard({ sourcePage: null, pdfProvenance: undefined })],
          }),
          practiceTest: null,
        },
        selection: { guide: false, flashcards: true, questions: false },
      };

      const csv = buildFlashcardCsv([item]);
      const lines = csv.split("\n");
      // Column 4 (index 3) is Source pages, should be `""`
      expect(lines[1]).toContain(',"",');
    });

    it("computes the unique sorted union of sourcePage and pdfProvenance sources pages", () => {
      const prov: PdfItemProvenance = {
        status: "valid",
        label: "Pulled from your PDF on this Mac",
        sources: [
          { itemKind: "card", logicalId: "1", contentHash: "hash1", page: 15, startOffset: 0, endOffset: 10, quote: "q1", runId: "run1" },
          { itemKind: "card", logicalId: "1", contentHash: "hash1", page: 3, startOffset: 0, endOffset: 10, quote: "q2", runId: "run1" },
          { itemKind: "card", logicalId: "1", contentHash: "hash1", page: 15, startOffset: 12, endOffset: 20, quote: "q3", runId: "run1" },
        ],
      };

      const card = dummyCard({ sourcePage: 10, pdfProvenance: prov });
      const formatted = formatSourcePages(card);
      // Union of 10, 15, 3, 15 sorted -> 3, 10, 15
      expect(formatted).toBe("3, 10, 15");
    });
  });

  describe("Provenance labels", () => {
    it("handles PDF provenance: valid vs details unavailable", () => {
      const validProv: PdfItemProvenance = {
        status: "valid",
        label: "Pulled from your PDF on this Mac",
        sources: [],
      };
      const invalidProv: PdfItemProvenance = {
        status: "invalid",
        label: "PDF source details unavailable",
        sources: [],
      };

      const source: ExportSource = {
        material: { title: "M" },
        studySet: dummySet(),
        practiceTest: null,
      };

      const cardValid = dummyCard({ pdfProvenance: validProv });
      expect(cardProvenanceLabel(cardValid, source)).toBe("Pulled from your PDF on this Mac");

      const cardInvalid = dummyCard({ pdfProvenance: invalidProv });
      expect(cardProvenanceLabel(cardInvalid, source)).toBe("PDF source details unavailable");
    });

    it("handles non-PDF provenance: manual, import, gemini", () => {
      const manualSource: ExportSource = {
        material: { title: "M" },
        studySet: dummySet({ provider: "manual", model: "" }),
        practiceTest: null,
      };
      expect(cardProvenanceLabel(dummyCard(), manualSource)).toBe("Written by hand in Her Flight Deck");

      const importSource: ExportSource = {
        material: { title: "M" },
        studySet: dummySet({ provider: "import", model: "" }),
        practiceTest: null,
      };
      expect(cardProvenanceLabel(dummyCard(), importSource)).toBe("Imported into Her Flight Deck");

      const aiSourceWithoutModel: ExportSource = {
        material: { title: "M" },
        studySet: dummySet({ provider: "gemini", model: "" }),
        practiceTest: null,
      };
      expect(cardProvenanceLabel(dummyCard(), aiSourceWithoutModel)).toBe("AI-generated study aid");

      const aiSourceWithModel: ExportSource = {
        material: { title: "M" },
        studySet: dummySet({ provider: "gemini", model: "gemini-2.5-flash" }),
        practiceTest: null,
      };
      expect(cardProvenanceLabel(dummyCard(), aiSourceWithModel)).toBe("AI-generated study aid (gemini-2.5-flash)");
    });

    it("labels user edits and instructor edits clearly", () => {
      const source: ExportSource = {
        material: { title: "M" },
        studySet: dummySet({ provider: "manual" }),
        practiceTest: null,
      };

      const userCard = dummyCard({ origin: "user" });
      expect(cardProvenanceLabel(userCard, source)).toBe("Written by hand in Her Flight Deck (Edited by you)");

      const instructorCard = dummyCard({ origin: "instructor" });
      expect(cardProvenanceLabel(instructorCard, source)).toBe("Written by hand in Her Flight Deck (Corrected by your instructor)");

      const validProv: PdfItemProvenance = {
        status: "valid",
        label: "Pulled from your PDF on this Mac",
        sources: [],
      };
      const pdfInstructorCard = dummyCard({ pdfProvenance: validProv, origin: "instructor" });
      expect(cardProvenanceLabel(pdfInstructorCard, source)).toBe("Pulled from your PDF on this Mac (Corrected by your instructor)");
    });
  });

  describe("Instructor corrections opt-in and immutability", () => {
    it("excludes instructor corrections when instructorCorrections is undefined or false, but includes when true", () => {
      const normalCard = dummyCard({ itemId: "c1", front: "Normal" });
      const instructorCard = dummyCard({ itemId: "c2", front: "Instructor Corrected", origin: "instructor" });

      const originalSource: ExportSource = {
        material: { title: "Private Pilot" },
        studySet: dummySet({
          flashcards: [normalCard, instructorCard],
        }),
        practiceTest: null,
      };

      // Case 1: instructorCorrections = false
      const itemWithout: FlashcardCsvItem = {
        source: originalSource,
        selection: { guide: false, flashcards: true, questions: false, instructorCorrections: false },
      };
      const csvWithout = buildFlashcardCsv([itemWithout]);
      expect(csvWithout).toContain("Normal");
      expect(csvWithout).not.toContain("Instructor Corrected");

      // Case 2: instructorCorrections = true
      const itemWith: FlashcardCsvItem = {
        source: originalSource,
        selection: { guide: false, flashcards: true, questions: false, instructorCorrections: true },
      };
      const csvWith = buildFlashcardCsv([itemWith]);
      expect(csvWith).toContain("Normal");
      expect(csvWith).toContain("Instructor Corrected");

      // Verify input source was not mutated
      expect(originalSource.studySet?.flashcards).toHaveLength(2);
      expect(originalSource.studySet?.flashcards[1]?.front).toBe("Instructor Corrected");
    });
  });

  describe("Spreadsheet formula mitigation", () => {
    it("detects formula triggers: =, +, -, @ including after whitespace or control chars", () => {
      expect(needsFormulaMitigation("=SUM(A1:A5)")).toBe(true);
      expect(needsFormulaMitigation("+12345")).toBe(true);
      expect(needsFormulaMitigation("-500")).toBe(true);
      expect(needsFormulaMitigation("@echo")).toBe(true);
      expect(needsFormulaMitigation("   \t\r\n=1+1")).toBe(true);
      expect(needsFormulaMitigation("\x01\x1f -test")).toBe(true);

      expect(needsFormulaMitigation("Normal text")).toBe(false);
      expect(needsFormulaMitigation("1 + 2 = 3")).toBe(false);
      expect(needsFormulaMitigation("")).toBe(false);
      expect(needsFormulaMitigation("   ")).toBe(false);
    });

    it("prefixes a single apostrophe before quoting formula cells", () => {
      expect(sanitizeCellForSpreadsheet("=CMD()")).toBe("'=CMD()");
      expect(sanitizeCellForSpreadsheet("  +calc")).toBe("'  +calc");
      expect(sanitizeCellForSpreadsheet("Safe")).toBe("Safe");

      expect(formatCsvCell("=1+1")).toBe("\"'=1+1\"");
      expect(formatCsvCell("-leading")).toBe("\"'-leading\"");
    });

    it("applies mitigation in full buildFlashcardCsv output", () => {
      const item: FlashcardCsvItem = {
        source: {
          material: { title: "=SUM(1,2)" },
          studySet: dummySet({
            flashcards: [
              dummyCard({
                front: "+Front formula",
                back: "@Back mention",
              }),
            ],
          }),
          practiceTest: null,
        },
        selection: { guide: false, flashcards: true, questions: false },
      };

      const csv = buildFlashcardCsv([item]);
      expect(csv).toContain("\"'+Front formula\"");
      expect(csv).toContain("\"'@Back mention\"");
      expect(csv).toContain("\"'=SUM(1,2)\"");
    });
  });
});
