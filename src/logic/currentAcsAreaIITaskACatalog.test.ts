import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_A_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_A_SOURCE,
  resolveCurrentAreaIITaskAAktrCode,
} from "./currentAcsAreaIITaskACatalog";

describe("Private Pilot Airplane ACS 6C Area II Task A (PA.II.A) catalog slice", () => {
  const expectedCodes = [
    "PA.II.A.K1",
    "PA.II.A.K2",
    "PA.II.A.K3",
    "PA.II.A.K3a",
    "PA.II.A.K3b",
    "PA.II.A.K3c",
    "PA.II.A.K3d",
    "PA.II.A.K4",
    "PA.II.A.R1",
    "PA.II.A.R2",
    "PA.II.A.R3",
    "PA.II.A.R4",
    "PA.II.A.R5",
    "PA.II.A.S1",
    "PA.II.A.S2",
    "PA.II.A.S3",
    "PA.II.A.S4",
  ] as const;

  it("contains exactly the 17 verified Area II Task A codes once each with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_A_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(17);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_A_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("II");
      expect(entry.task).toBe("A");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_A_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.II.A coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_A_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPage: 11,
      pdfPage: 19,
      areaOfOperation: "Area of Operation II: Preflight Procedures",
      task: "Task A. Preflight Assessment",
      coverageLabel: "PA.II.A",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.II.A.K1": "Pilot self-assessment.",
      "PA.II.A.K2": "Determining that the airplane to be used is appropriate and airworthy.",
      "PA.II.A.K3": "Airplane preflight inspection, including:",
      "PA.II.A.K3a": "Which items should be inspected",
      "PA.II.A.K3b": "The reasons for checking each item",
      "PA.II.A.K3c": "How to detect possible defects",
      "PA.II.A.K3d": "The associated regulations",
      "PA.II.A.K4": "Environmental factors, including weather, terrain, route selection, and obstructions.",
      "PA.II.A.R1": "Pilot.",
      "PA.II.A.R2": "Aircraft.",
      "PA.II.A.R3": "Environment (e.g., weather, airports, airspace, terrain, obstacles).",
      "PA.II.A.R4": "External pressures.",
      "PA.II.A.R5": "Aviation security concerns.",
      "PA.II.A.S1": "Inspect the airplane with reference to an appropriate checklist.",
      "PA.II.A.S2": "Verify the airplane is in condition for safe flight and conforms to its type design.",
      "PA.II.A.S3": "Perform self-assessment.",
      "PA.II.A.S4": "Continue to assess the environment for safe flight.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_A_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area II Task A code with case-insensitive ASCII matching", () => {
    const res = resolveCurrentAreaIITaskAAktrCode("pa.ii.a.k1");
    expect(res).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.A.K1",
        description: "Pilot self-assessment.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "II",
        task: "A",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_A_SOURCE,
      },
    });

    const resLowerSub = resolveCurrentAreaIITaskAAktrCode("pa.ii.a.k3a");
    expect(resLowerSub).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.A.K3a",
        description: "Which items should be inspected",
      },
    });

    const resUpper = resolveCurrentAreaIITaskAAktrCode("PA.II.A.R4");
    expect(resUpper).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.A.R4",
        description: "External pressures.",
      },
    });

    const resSkill = resolveCurrentAreaIITaskAAktrCode("PA.II.A.S2");
    expect(resSkill).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.A.S2",
        description: "Verify the airplane is in condition for safe flight and conforms to its type design.",
      },
    });
  });

  it("leaves out-of-slice current codes unresolved (including Area I Task A–I)", () => {
    // Area I Task A
    expect(resolveCurrentAreaIITaskAAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
    // Area I Task B
    expect(resolveCurrentAreaIITaskAAktrCode("PA.I.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.B.K1",
    });
    // Area I Task C
    expect(resolveCurrentAreaIITaskAAktrCode("PA.I.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.C.K1",
    });
    // Area I Task D
    expect(resolveCurrentAreaIITaskAAktrCode("PA.I.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.D.K1",
    });
    // Area I Task E
    expect(resolveCurrentAreaIITaskAAktrCode("PA.I.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.E.K1",
    });
    // Area I Task F
    expect(resolveCurrentAreaIITaskAAktrCode("PA.I.F.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.F.K1",
    });
    // Area I Task G
    expect(resolveCurrentAreaIITaskAAktrCode("PA.I.G.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.G.K1",
    });
    // Area I Task H
    expect(resolveCurrentAreaIITaskAAktrCode("PA.I.H.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.H.K1",
    });
    // Area I Task I
    expect(resolveCurrentAreaIITaskAAktrCode("PA.I.I.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.I.K1",
    });
    // Area II Task B (unimplemented)
    expect(resolveCurrentAreaIITaskAAktrCode("PA.II.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.B.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    expect(resolveCurrentAreaIITaskAAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIITaskAAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIITaskAAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
