import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_A_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_XII_TASK_A_SOURCE,
  resolveCurrentAreaXIITaskAAktrCode,
} from "./currentAcsAreaXIITaskACatalog";

describe("Private Pilot Airplane ACS 6C Area XII Task A (PA.XII.A) catalog slice", () => {
  const expectedCodes = [
    "PA.XII.A.K1",
    "PA.XII.A.K2",
    "PA.XII.A.R1",
    "PA.XII.A.R3",
    "PA.XII.A.R4",
    "PA.XII.A.S2",
    "PA.XII.A.S3",
    "PA.XII.A.S4",
    "PA.XII.A.S5",
  ] as const;

  it("contains exactly the 9 verified Area XII Task A codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_A_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(9);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_A_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("XII");
      expect(entry.task).toBe("A");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_XII_TASK_A_SOURCE);
    }
  });

  it("excludes archived codes PA.XII.A.R2 and PA.XII.A.S1", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_A_CODES.map(({ code }) => code);
    expect(codes).not.toContain("PA.XII.A.R2");
    expect(codes).not.toContain("PA.XII.A.S1");
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.XII.A coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_XII_TASK_A_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "64–65",
      pdfPages: "72–73",
      areaOfOperation: "Area of Operation XII: Postflight Procedures",
      task: "Task A. After Landing, Parking, and Securing",
      coverageLabel: "PA.XII.A",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.XII.A.K1": "Airplane shutdown, securing, and postflight inspection.",
      "PA.XII.A.K2": "Documenting in-flight/postflight discrepancies.",
      "PA.XII.A.R1": "Activities and distractions.",
      "PA.XII.A.R3": "Airport specific security procedures.",
      "PA.XII.A.R4":
        "Disembarking passengers safely on the ramp and monitoring passenger movement while on the ramp.",
      "PA.XII.A.S2":
        "Park in an appropriate area, considering the safety of nearby persons and property.",
      "PA.XII.A.S3": "Complete the appropriate checklist(s).",
      "PA.XII.A.S4":
        "Conduct a postflight inspection and document discrepancies and servicing requirements, if any.",
      "PA.XII.A.S5": "Secure the airplane.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_A_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area XII Task A code with case-insensitive ASCII matching", () => {
    // Knowledge codes
    const resK1 = resolveCurrentAreaXIITaskAAktrCode("pa.xii.a.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.XII.A.K1",
        description: "Airplane shutdown, securing, and postflight inspection.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "XII",
        task: "A",
      },
    });

    const resK2Upper = resolveCurrentAreaXIITaskAAktrCode("PA.XII.A.K2");
    expect(resK2Upper).toMatchObject({
      status: "current",
      entry: {
        code: "PA.XII.A.K2",
        description: "Documenting in-flight/postflight discrepancies.",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaXIITaskAAktrCode("pa.xii.a.r1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.XII.A.R1",
        description: "Activities and distractions.",
      },
    });

    const resR4 = resolveCurrentAreaXIITaskAAktrCode("PA.XII.A.R4");
    expect(resR4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.XII.A.R4",
        description:
          "Disembarking passengers safely on the ramp and monitoring passenger movement while on the ramp.",
      },
    });

    // Skill codes
    const resS2 = resolveCurrentAreaXIITaskAAktrCode("pa.xii.a.s2");
    expect(resS2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.XII.A.S2",
        description:
          "Park in an appropriate area, considering the safety of nearby persons and property.",
      },
    });

    const resS5 = resolveCurrentAreaXIITaskAAktrCode("PA.XII.A.S5");
    expect(resS5).toMatchObject({
      status: "current",
      entry: {
        code: "PA.XII.A.S5",
        description: "Secure the airplane.",
      },
    });
  });

  it("leaves archived codes unresolved", () => {
    expect(resolveCurrentAreaXIITaskAAktrCode("PA.XII.A.R2")).toEqual({
      status: "unresolved",
      code: "PA.XII.A.R2",
    });
    expect(resolveCurrentAreaXIITaskAAktrCode("pa.xii.a.r2")).toEqual({
      status: "unresolved",
      code: "PA.XII.A.R2",
    });
    expect(resolveCurrentAreaXIITaskAAktrCode("PA.XII.A.S1")).toEqual({
      status: "unresolved",
      code: "PA.XII.A.S1",
    });
    expect(resolveCurrentAreaXIITaskAAktrCode("pa.xii.a.s1")).toEqual({
      status: "unresolved",
      code: "PA.XII.A.S1",
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area XI Task A
    expect(resolveCurrentAreaXIITaskAAktrCode("PA.XI.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.XI.A.K1",
    });

    // Area X Task D
    expect(resolveCurrentAreaXIITaskAAktrCode("PA.X.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.X.D.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaXIITaskAAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves non-existent sub-elements unresolved", () => {
    expect(resolveCurrentAreaXIITaskAAktrCode("PA.XII.A.K3")).toEqual({
      status: "unresolved",
      code: "PA.XII.A.K3",
    });
    expect(resolveCurrentAreaXIITaskAAktrCode("PA.XII.A.R5")).toEqual({
      status: "unresolved",
      code: "PA.XII.A.R5",
    });
    expect(resolveCurrentAreaXIITaskAAktrCode("PA.XII.A.S6")).toEqual({
      status: "unresolved",
      code: "PA.XII.A.S6",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaXIITaskAAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaXIITaskAAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
    expect(resolveCurrentAreaXIITaskAAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
