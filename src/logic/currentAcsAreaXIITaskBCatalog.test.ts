import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_B_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_XII_TASK_B_SOURCE,
  resolveCurrentAreaXIITaskBAktrCode,
} from "./currentAcsAreaXIITaskBCatalog";

describe("Private Pilot Airplane ACS 6C Area XII Task B (PA.XII.B) catalog slice", () => {
  const expectedCodes = [
    "PA.XII.B.K1",
    "PA.XII.B.K2",
    "PA.XII.B.K3",
    "PA.XII.B.K4",
    "PA.XII.B.K5",
    "PA.XII.B.R1",
    "PA.XII.B.R3",
    "PA.XII.B.R4",
    "PA.XII.B.S1",
    "PA.XII.B.S2",
    "PA.XII.B.S3",
    "PA.XII.B.S4",
    "PA.XII.B.S5",
  ] as const;

  it("contains exactly the 13 verified Area XII Task B codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_B_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(13);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_B_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("XII");
      expect(entry.task).toBe("B");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_XII_TASK_B_SOURCE);
    }
  });

  it("excludes archived code PA.XII.B.R2", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_B_CODES.map(({ code }) => code);
    expect(codes).not.toContain("PA.XII.B.R2");
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.XII.B coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_XII_TASK_B_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "64–65",
      pdfPages: "72–73",
      areaOfOperation: "Area of Operation XII: Postflight Procedures",
      task: "Task B. Seaplane Post-Landing Procedures",
      coverageLabel: "PA.XII.B",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.XII.B.K1": "Mooring.",
      "PA.XII.B.K2": "Docking.",
      "PA.XII.B.K3": "Anchoring.",
      "PA.XII.B.K4": "Beaching/ramping.",
      "PA.XII.B.K5":
        "Postflight inspection, recording of in-flight/postflight discrepancies.",
      "PA.XII.B.R1": "Activities and distractions.",
      "PA.XII.B.R3": "Seaplane base specific security procedures, if applicable.",
      "PA.XII.B.R4":
        "Disembarking passengers safely on the ramp and monitoring passenger movement while on the ramp.",
      "PA.XII.B.S1":
        "If anchoring, select a suitable area considering seaplane movement, water depth, tide, wind, and weather changes. Use an adequate number of anchors and lines of sufficient strength and length to ensure the seaplane’s security.",
      "PA.XII.B.S2":
        "If not anchoring, approach the dock/mooring buoy or beach/ramp in the proper direction and at a safe speed, considering water depth, tide, current, and wind.",
      "PA.XII.B.S3": "Complete the appropriate checklist(s).",
      "PA.XII.B.S4":
        "Conduct a postflight inspection and document discrepancies and servicing requirements, if any.",
      "PA.XII.B.S5":
        "Secure the seaplane considering the effect of wind, waves, and changes in water level, or comply with applicable after landing, parking, and securing procedures if operating an amphibious airplane on land.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_XII_TASK_B_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area XII Task B code with case-insensitive ASCII matching", () => {
    // Knowledge codes
    const resK1 = resolveCurrentAreaXIITaskBAktrCode("pa.xii.b.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.XII.B.K1",
        description: "Mooring.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "XII",
        task: "B",
      },
    });

    const resK5 = resolveCurrentAreaXIITaskBAktrCode("PA.XII.B.K5");
    expect(resK5).toMatchObject({
      status: "current",
      entry: {
        code: "PA.XII.B.K5",
        description:
          "Postflight inspection, recording of in-flight/postflight discrepancies.",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaXIITaskBAktrCode("pa.xii.b.r1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.XII.B.R1",
        description: "Activities and distractions.",
      },
    });

    const resR4 = resolveCurrentAreaXIITaskBAktrCode("PA.XII.B.R4");
    expect(resR4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.XII.B.R4",
        description:
          "Disembarking passengers safely on the ramp and monitoring passenger movement while on the ramp.",
      },
    });

    // Skill codes
    const resS1 = resolveCurrentAreaXIITaskBAktrCode("pa.xii.b.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.XII.B.S1",
        description:
          "If anchoring, select a suitable area considering seaplane movement, water depth, tide, wind, and weather changes. Use an adequate number of anchors and lines of sufficient strength and length to ensure the seaplane’s security.",
      },
    });

    const resS5 = resolveCurrentAreaXIITaskBAktrCode("PA.XII.B.S5");
    expect(resS5).toMatchObject({
      status: "current",
      entry: {
        code: "PA.XII.B.S5",
        description:
          "Secure the seaplane considering the effect of wind, waves, and changes in water level, or comply with applicable after landing, parking, and securing procedures if operating an amphibious airplane on land.",
      },
    });
  });

  it("leaves archived codes unresolved", () => {
    expect(resolveCurrentAreaXIITaskBAktrCode("PA.XII.B.R2")).toEqual({
      status: "unresolved",
      code: "PA.XII.B.R2",
    });
    expect(resolveCurrentAreaXIITaskBAktrCode("pa.xii.b.r2")).toEqual({
      status: "unresolved",
      code: "PA.XII.B.R2",
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area XII Task A
    expect(resolveCurrentAreaXIITaskBAktrCode("PA.XII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.XII.A.K1",
    });

    // Area XI Task A
    expect(resolveCurrentAreaXIITaskBAktrCode("PA.XI.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.XI.A.K1",
    });

    // Area X Task D
    expect(resolveCurrentAreaXIITaskBAktrCode("PA.X.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.X.D.K1",
    });
  });

  it("leaves non-existent sub-elements unresolved", () => {
    expect(resolveCurrentAreaXIITaskBAktrCode("PA.XII.B.K6")).toEqual({
      status: "unresolved",
      code: "PA.XII.B.K6",
    });
    expect(resolveCurrentAreaXIITaskBAktrCode("PA.XII.B.R5")).toEqual({
      status: "unresolved",
      code: "PA.XII.B.R5",
    });
    expect(resolveCurrentAreaXIITaskBAktrCode("PA.XII.B.S6")).toEqual({
      status: "unresolved",
      code: "PA.XII.B.S6",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaXIITaskBAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaXIITaskBAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
    expect(resolveCurrentAreaXIITaskBAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
