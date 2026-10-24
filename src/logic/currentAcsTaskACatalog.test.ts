import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_TASK_A_CODES,
  PRIVATE_AIRPLANE_ACS_6C_TASK_A_SOURCE,
  resolveCurrentTaskAAktrCode,
} from "./currentAcsTaskACatalog";

describe("Private Pilot Airplane ACS 6C Task A (PA.I.A) catalog slice", () => {
  const expectedCodes = [
    "PA.I.A.K1",
    "PA.I.A.K2",
    "PA.I.A.K3",
    "PA.I.A.K4",
    "PA.I.A.K5",
    "PA.I.A.R1",
    "PA.I.A.R2",
    "PA.I.A.S1",
  ] as const;

  it("contains exactly the eight verified Task A codes once each with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_TASK_A_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(8);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_A_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("I");
      expect(entry.task).toBe("A");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_TASK_A_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.I.A coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_TASK_A_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPage: 2,
      pdfPage: 10,
      areaOfOperation: "Area of Operation I: Preflight Preparation",
      task: "Task A. Pilot Qualifications",
      coverageLabel: "PA.I.A",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.I.A.K1": "Certification requirements, recent flight experience, and recordkeeping.",
      "PA.I.A.K2": "Privileges and limitations.",
      "PA.I.A.K3": "Medical certificates: class, expiration, privileges, temporary disqualifications.",
      "PA.I.A.K4": "Documents required to exercise private pilot privileges.",
      "PA.I.A.K5": "Part 68 BasicMed privileges and limitations.",
      "PA.I.A.R1": "Proficiency versus currency.",
      "PA.I.A.R2": "Flying unfamiliar aircraft or operating with unfamiliar flight display systems and avionics.",
      "PA.I.A.S1": "Apply requirements to act as pilot-in-command (PIC) under Visual Flight Rules (VFR) in a scenario given by the evaluator.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_A_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Task A code with case-insensitive ASCII matching", () => {
    const res = resolveCurrentTaskAAktrCode("pa.i.a.k1");
    expect(res).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.A.K1",
        description: "Certification requirements, recent flight experience, and recordkeeping.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        source: PRIVATE_AIRPLANE_ACS_6C_TASK_A_SOURCE,
      },
    });

    const resUpper = resolveCurrentTaskAAktrCode("PA.I.A.R2");
    expect(resUpper).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.A.R2",
        description: "Flying unfamiliar aircraft or operating with unfamiliar flight display systems and avionics.",
      },
    });
  });

  it("leaves out-of-slice current codes unresolved", () => {
    // PA.I.B.K1 is Task B, outside the PA.I.A slice
    expect(resolveCurrentTaskAAktrCode("PA.I.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.B.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    // PA.III.A.R3 is an archived code in the archived catalog
    expect(resolveCurrentTaskAAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentTaskAAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentTaskAAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
