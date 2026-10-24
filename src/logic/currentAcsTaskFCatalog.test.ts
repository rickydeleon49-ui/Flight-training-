import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_TASK_F_CODES,
  PRIVATE_AIRPLANE_ACS_6C_TASK_F_SOURCE,
  resolveCurrentTaskFAktrCode,
} from "./currentAcsTaskFCatalog";

describe("Private Pilot Airplane ACS 6C Task F (PA.I.F) catalog slice", () => {
  const expectedCodes = [
    "PA.I.F.K1",
    "PA.I.F.K2",
    "PA.I.F.K2a",
    "PA.I.F.K2b",
    "PA.I.F.K2c",
    "PA.I.F.K2d",
    "PA.I.F.K2e",
    "PA.I.F.K2f",
    "PA.I.F.K3",
    "PA.I.F.R1",
    "PA.I.F.R2",
    "PA.I.F.R3",
    "PA.I.F.S1",
    "PA.I.F.S2",
  ] as const;

  it("contains exactly the 14 verified Task F codes once each with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_TASK_F_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(14);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_F_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("I");
      expect(entry.task).toBe("F");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_TASK_F_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.I.F coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_TASK_F_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "6–7",
      pdfPages: "14–15",
      areaOfOperation: "Area of Operation I: Preflight Preparation",
      task: "Task F. Performance and Limitations",
      coverageLabel: "PA.I.F",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.I.F.K1": "Elements related to performance and limitations by explaining the use of charts, tables, and data to determine performance.",
      "PA.I.F.K2": "Factors affecting performance, including:",
      "PA.I.F.K2a": "Atmospheric conditions",
      "PA.I.F.K2b": "Pilot technique",
      "PA.I.F.K2c": "Airplane configuration",
      "PA.I.F.K2d": "Airport environment",
      "PA.I.F.K2e": "Loading [e.g., center of gravity (CG)]",
      "PA.I.F.K2f": "Weight and balance",
      "PA.I.F.K3": "Aerodynamics.",
      "PA.I.F.R1": "Use of performance charts, tables, and data.",
      "PA.I.F.R2": "Airplane limitations.",
      "PA.I.F.R3": "Possible differences between calculated performance and actual performance.",
      "PA.I.F.S1": "Compute the weight and balance, correct out-of-CG loading errors and determine if the weight and balance remains within limits during all phases of flight.",
      "PA.I.F.S2": "Use the appropriate airplane performance charts, tables, and data.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_F_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Task F code with case-insensitive ASCII matching", () => {
    const res = resolveCurrentTaskFAktrCode("pa.i.f.k1");
    expect(res).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.F.K1",
        description: "Elements related to performance and limitations by explaining the use of charts, tables, and data to determine performance.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        source: PRIVATE_AIRPLANE_ACS_6C_TASK_F_SOURCE,
      },
    });

    const resUpper = resolveCurrentTaskFAktrCode("PA.I.F.S2");
    expect(resUpper).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.F.S2",
        description: "Use the appropriate airplane performance charts, tables, and data.",
      },
    });

    const resSub = resolveCurrentTaskFAktrCode("pa.i.f.k2e");
    expect(resSub).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.F.K2e",
        description: "Loading [e.g., center of gravity (CG)]",
      },
    });
  });

  it("leaves out-of-slice current codes unresolved (including Tasks A, B, C, D, and E)", () => {
    // PA.I.A.K1 is Task A
    expect(resolveCurrentTaskFAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });

    // PA.I.B.K1 is Task B
    expect(resolveCurrentTaskFAktrCode("PA.I.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.B.K1",
    });

    // PA.I.C.K1 is Task C
    expect(resolveCurrentTaskFAktrCode("PA.I.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.C.K1",
    });

    // PA.I.D.K1 is Task D
    expect(resolveCurrentTaskFAktrCode("PA.I.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.D.K1",
    });

    // PA.I.E.K1 is Task E
    expect(resolveCurrentTaskFAktrCode("PA.I.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.E.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    // PA.III.A.R3 is an archived code in the archived catalog
    expect(resolveCurrentTaskFAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentTaskFAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentTaskFAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
