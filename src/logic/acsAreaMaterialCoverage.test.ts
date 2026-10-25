import { describe, expect, it } from "vitest";
import type { StudyMaterial } from "@/domain/types";
import {
  summarizeAcsAreaMaterialCoverage,
  PRIVATE_AIRPLANE_ACS_AREAS,
} from "./acsAreaMaterialCoverage";
import { CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES } from "./currentPrivateAirplaneAcsCatalog";

function createMockMaterial(id: string, tags: string[]): StudyMaterial {
  return {
    id,
    title: `Material ${id}`,
    materialType: "study_guide",
    topic: "general",
    reviewStatus: "needs_review",
    priority: "later",
    goalId: null,
    eventId: null,
    notes: "",
    filePath: null,
    originalFileName: null,
    fileSize: null,
    createdAt: "2026-10-20T00:00:00.000Z",
    updatedAt: "2026-10-20T00:00:00.000Z",
    lastReviewedAt: null,
    tags,
  };
}

describe("summarizeAcsAreaMaterialCoverage", () => {
  it("returns all twelve canonical areas in exact I-to-XII order with authoritative area labels and exact code counts", () => {
    const summary = summarizeAcsAreaMaterialCoverage();

    expect(summary).toHaveLength(12);
    expect(summary.map((s) => s.area)).toEqual(PRIVATE_AIRPLANE_ACS_AREAS);

    const expectedLabels: Record<string, string> = {
      I: "Area of Operation I: Preflight Preparation",
      II: "Area of Operation II: Preflight Procedures",
      III: "Area of Operation III: Airport and Seaplane Base Operations",
      IV: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
      V: "Area of Operation V: Performance Maneuvers and Ground Reference Maneuvers",
      VI: "Area of Operation VI: Navigation",
      VII: "Area of Operation VII: Slow Flight and Stalls",
      VIII: "Area of Operation VIII: Basic Instrument Maneuvers",
      IX: "Area of Operation IX: Emergency Operations",
      X: "Area of Operation X: Multiengine Operations",
      XI: "Area of Operation XI: Night Operations",
      XII: "Area of Operation XII: Postflight Procedures",
    };

    let totalSum = 0;
    for (const row of summary) {
      expect(row.areaLabel).toBe(expectedLabels[row.area]);
      expect(row.totalCodeCount).toBeGreaterThan(0);
      expect(row.matchedCodeCount).toBe(0);
      expect(row.unmatchedCodeCount).toBe(row.totalCodeCount);
      expect(row.distinctMaterialCount).toBe(0);
      totalSum += row.totalCodeCount;
    }

    expect(totalSum).toBe(1170);
    expect(totalSum).toBe(CURRENT_PRIVATE_AIRPLANE_ACS_6C_CODES.length);
  });

  it("handles empty materials array or undefined input producing twelve zero-matched rows", () => {
    const summaryUndefined = summarizeAcsAreaMaterialCoverage();
    const summaryEmpty = summarizeAcsAreaMaterialCoverage({ materials: [] });

    for (const row of summaryUndefined) {
      expect(row.matchedCodeCount).toBe(0);
      expect(row.unmatchedCodeCount).toBe(row.totalCodeCount);
      expect(row.distinctMaterialCount).toBe(0);
    }

    for (const row of summaryEmpty) {
      expect(row.matchedCodeCount).toBe(0);
      expect(row.unmatchedCodeCount).toBe(row.totalCodeCount);
      expect(row.distinctMaterialCount).toBe(0);
    }
  });

  it("accurately computes matched, unmatched, and distinct material counts for single exact tag match", () => {
    // PA.I.A.K1 is in Area I
    const mat = createMockMaterial("mat-1", ["PA.I.A.K1"]);
    const summary = summarizeAcsAreaMaterialCoverage({ materials: [mat] });

    const areaI = summary.find((s) => s.area === "I")!;
    expect(areaI.matchedCodeCount).toBe(1);
    expect(areaI.unmatchedCodeCount).toBe(areaI.totalCodeCount - 1);
    expect(areaI.distinctMaterialCount).toBe(1);

    // Other areas remain unaffected
    for (const row of summary) {
      if (row.area !== "I") {
        expect(row.matchedCodeCount).toBe(0);
        expect(row.unmatchedCodeCount).toBe(row.totalCodeCount);
        expect(row.distinctMaterialCount).toBe(0);
      }
    }
  });

  it("performs exact matching with case insensitivity and whitespace trimming, while ignoring partial/topic text", () => {
    // " pa.i.a.k1 " matches PA.I.A.K1
    // "PA.I.A" or "Weather" or substrings should NOT match
    const matExactCaseWhitespace = createMockMaterial("mat-1", ["  pa.i.a.k1  "]);
    const matNonMatching = createMockMaterial("mat-2", ["PA.I.A", "Pilot Qualifications", "PA.I.A.K1.extra"]);

    const summary = summarizeAcsAreaMaterialCoverage({
      materials: [matExactCaseWhitespace, matNonMatching],
    });

    const areaI = summary.find((s) => s.area === "I")!;
    expect(areaI.matchedCodeCount).toBe(1);
    expect(areaI.distinctMaterialCount).toBe(1);
  });

  it("counts a code as matched once even with duplicate or case-variant tags", () => {
    // mat1 has "PA.I.A.K1" twice and "pa.i.a.k1"
    // mat2 also has "PA.I.A.K1"
    const mat1 = createMockMaterial("mat-1", ["PA.I.A.K1", "PA.I.A.K1", "pa.i.a.k1"]);
    const mat2 = createMockMaterial("mat-2", ["PA.I.A.K1"]);

    const summary = summarizeAcsAreaMaterialCoverage({ materials: [mat1, mat2] });

    const areaI = summary.find((s) => s.area === "I")!;
    // Still only 1 code matched (PA.I.A.K1)
    expect(areaI.matchedCodeCount).toBe(1);
    expect(areaI.unmatchedCodeCount).toBe(areaI.totalCodeCount - 1);
    // But 2 distinct materials match that code in Area I
    expect(areaI.distinctMaterialCount).toBe(2);
  });

  it("counts a material once per area even if it matches multiple codes in that area", () => {
    // mat1 matches two different codes in Area I: PA.I.A.K1 and PA.I.A.K2
    const mat1 = createMockMaterial("mat-1", ["PA.I.A.K1", "PA.I.A.K2"]);
    const summary = summarizeAcsAreaMaterialCoverage({ materials: [mat1] });

    const areaI = summary.find((s) => s.area === "I")!;
    expect(areaI.matchedCodeCount).toBe(2);
    expect(areaI.unmatchedCodeCount).toBe(areaI.totalCodeCount - 2);
    // Distinct material count in Area I must be 1, not 2
    expect(areaI.distinctMaterialCount).toBe(1);
  });

  it("isolates distinct material counts per area when a material spans multiple areas", () => {
    // matMulti spans Area I (PA.I.A.K1) and Area XII (PA.XII.A.K1)
    // matArea1Only matches Area I (PA.I.A.K2)
    const matMulti = createMockMaterial("mat-multi", ["PA.I.A.K1", "PA.XII.A.K1"]);
    const matArea1Only = createMockMaterial("mat-area1", ["PA.I.A.K2"]);

    const summary = summarizeAcsAreaMaterialCoverage({
      materials: [matMulti, matArea1Only],
    });

    const areaI = summary.find((s) => s.area === "I")!;
    expect(areaI.matchedCodeCount).toBe(2);
    expect(areaI.distinctMaterialCount).toBe(2);

    const areaXII = summary.find((s) => s.area === "XII")!;
    expect(areaXII.matchedCodeCount).toBe(1);
    expect(areaXII.distinctMaterialCount).toBe(1);

    // Area II has no matches
    const areaII = summary.find((s) => s.area === "II")!;
    expect(areaII.matchedCodeCount).toBe(0);
    expect(areaII.distinctMaterialCount).toBe(0);
  });

  it("does not mutate inputs", () => {
    const rawTags = Object.freeze(["PA.I.A.K1"]);
    const mat = Object.freeze(createMockMaterial("mat-1", rawTags as unknown as string[]));
    const materials = Object.freeze([mat]);

    const summary = summarizeAcsAreaMaterialCoverage({ materials });
    expect(summary).toBeDefined();
    expect(rawTags).toEqual(["PA.I.A.K1"]);
    expect(materials).toHaveLength(1);
  });
});
