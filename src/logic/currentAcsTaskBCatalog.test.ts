import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_TASK_B_CODES,
  PRIVATE_AIRPLANE_ACS_6C_TASK_B_SOURCE,
  resolveCurrentTaskBAktrCode,
} from "./currentAcsTaskBCatalog";

describe("Private Pilot Airplane ACS 6C Task B (PA.I.B) catalog slice", () => {
  const expectedCodes = [
    "PA.I.B.K1",
    "PA.I.B.K1a",
    "PA.I.B.K1b",
    "PA.I.B.K1c",
    "PA.I.B.K1d",
    "PA.I.B.K1e",
    "PA.I.B.K2",
    "PA.I.B.K3",
    "PA.I.B.K3a",
    "PA.I.B.K3b",
    "PA.I.B.K3c",
    "PA.I.B.K3d",
    "PA.I.B.K4",
    "PA.I.B.R1",
    "PA.I.B.S1",
    "PA.I.B.S2",
    "PA.I.B.S3",
  ] as const;

  it("contains exactly the seventeen verified Task B codes once each with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_TASK_B_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(17);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_B_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("I");
      expect(entry.task).toBe("B");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_TASK_B_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.I.B coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_TASK_B_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPage: 3,
      pdfPage: 11,
      areaOfOperation: "Area of Operation I: Preflight Preparation",
      task: "Task B. Airworthiness Requirements",
      coverageLabel: "PA.I.B",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.I.B.K1": "General airworthiness requirements and compliance for airplanes, including:",
      "PA.I.B.K1a": "Location and expiration dates of required aircraft certificates",
      "PA.I.B.K1b": "Required inspections and airplane logbook documentation",
      "PA.I.B.K1c": "Airworthiness Directives and Special Airworthiness Information Bulletins",
      "PA.I.B.K1d": "Purpose and procedure for obtaining a special flight permit",
      "PA.I.B.K1e": "Owner/Operator and pilot-in-command responsibilities",
      "PA.I.B.K2": "Pilot-performed preventive maintenance.",
      "PA.I.B.K3": "Equipment requirements for day and night VFR flight, including:",
      "PA.I.B.K3a": "Flying with inoperative equipment",
      "PA.I.B.K3b": "Using an approved Minimum Equipment List (MEL)",
      "PA.I.B.K3c": "Kinds of Operation Equipment List (KOEL)",
      "PA.I.B.K3d": "Required discrepancy records or placards",
      "PA.I.B.K4": "Standard and special airworthiness certificates and their associated operational limitations.",
      "PA.I.B.R1": "Inoperative equipment discovered prior to flight.",
      "PA.I.B.S1": "Locate and describe airplane airworthiness and registration information.",
      "PA.I.B.S2": "Determine the airplane is airworthy in the scenario given by the evaluator.",
      "PA.I.B.S3": "Apply appropriate procedures for operating with inoperative equipment in the scenario given by the evaluator.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_B_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Task B code with case-insensitive ASCII matching", () => {
    const res = resolveCurrentTaskBAktrCode("pa.i.b.k1a");
    expect(res).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.B.K1a",
        description: "Location and expiration dates of required aircraft certificates",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        source: PRIVATE_AIRPLANE_ACS_6C_TASK_B_SOURCE,
      },
    });

    const resUpper = resolveCurrentTaskBAktrCode("PA.I.B.R1");
    expect(resUpper).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.B.R1",
        description: "Inoperative equipment discovered prior to flight.",
      },
    });
  });

  it("leaves out-of-slice current codes unresolved (including Task A)", () => {
    // PA.I.A.K1 is Task A, outside the PA.I.B slice
    expect(resolveCurrentTaskBAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    // PA.III.A.R3 is an archived code in the archived catalog
    expect(resolveCurrentTaskBAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });
});
