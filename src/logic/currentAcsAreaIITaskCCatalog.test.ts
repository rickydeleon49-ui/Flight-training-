import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_C_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_C_SOURCE,
  resolveCurrentAreaIITaskCAktrCode,
} from "./currentAcsAreaIITaskCCatalog";

describe("Private Pilot Airplane ACS 6C Area II Task C (PA.II.C) catalog slice", () => {
  const expectedCodes = [
    "PA.II.C.K1",
    "PA.II.C.K2",
    "PA.II.C.K3",
    "PA.II.C.K4",
    "PA.II.C.R1",
    "PA.II.C.S1",
    "PA.II.C.S2",
  ] as const;

  it("contains exactly the 7 verified Area II Task C codes once each with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_C_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(7);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_C_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("II");
      expect(entry.task).toBe("C");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_C_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.II.C coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_C_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPage: 12,
      pdfPage: 20,
      areaOfOperation: "Area of Operation II: Preflight Procedures",
      task: "Task C. Engine Starting",
      coverageLabel: "PA.II.C",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.II.C.K1": "Starting under various conditions.",
      "PA.II.C.K2": "Starting the engine(s) by use of external power.",
      "PA.II.C.K3": "Limitations associated with starting.",
      "PA.II.C.K4": "Conditions leading to and procedures for an aborted start.",
      "PA.II.C.R1": "Propeller safety.",
      "PA.II.C.S1": "Position the airplane properly considering structures, other aircraft, wind, and the safety of nearby persons and property.",
      "PA.II.C.S2": "Complete the appropriate checklist(s).",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_C_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area II Task C code with case-insensitive ASCII matching", () => {
    const res = resolveCurrentAreaIITaskCAktrCode("pa.ii.c.k1");
    expect(res).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.C.K1",
        description: "Starting under various conditions.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "II",
        task: "C",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_C_SOURCE,
      },
    });

    const resRisk = resolveCurrentAreaIITaskCAktrCode("PA.II.C.R1");
    expect(resRisk).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.C.R1",
        description: "Propeller safety.",
      },
    });

    const resSkill1 = resolveCurrentAreaIITaskCAktrCode("pa.ii.c.s1");
    expect(resSkill1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.C.S1",
        description: "Position the airplane properly considering structures, other aircraft, wind, and the safety of nearby persons and property.",
      },
    });

    const resSkill2 = resolveCurrentAreaIITaskCAktrCode("PA.II.C.S2");
    expect(resSkill2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.C.S2",
        description: "Complete the appropriate checklist(s).",
      },
    });
  });

  it("leaves out-of-slice current codes unresolved (including Area I Task A–I and Area II Task A-B)", () => {
    // Area I Task A
    expect(resolveCurrentAreaIITaskCAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
    // Area I Task B
    expect(resolveCurrentAreaIITaskCAktrCode("PA.I.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.B.K1",
    });
    // Area I Task C
    expect(resolveCurrentAreaIITaskCAktrCode("PA.I.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.C.K1",
    });
    // Area I Task D
    expect(resolveCurrentAreaIITaskCAktrCode("PA.I.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.D.K1",
    });
    // Area I Task E
    expect(resolveCurrentAreaIITaskCAktrCode("PA.I.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.E.K1",
    });
    // Area I Task F
    expect(resolveCurrentAreaIITaskCAktrCode("PA.I.F.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.F.K1",
    });
    // Area I Task G
    expect(resolveCurrentAreaIITaskCAktrCode("PA.I.G.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.G.K1",
    });
    // Area I Task H
    expect(resolveCurrentAreaIITaskCAktrCode("PA.I.H.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.H.K1",
    });
    // Area I Task I
    expect(resolveCurrentAreaIITaskCAktrCode("PA.I.I.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.I.K1",
    });
    // Area II Task A
    expect(resolveCurrentAreaIITaskCAktrCode("PA.II.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.A.K1",
    });
    // Area II Task B
    expect(resolveCurrentAreaIITaskCAktrCode("PA.II.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.B.K1",
    });
    // Area II Task D (future task)
    expect(resolveCurrentAreaIITaskCAktrCode("PA.II.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.D.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    expect(resolveCurrentAreaIITaskCAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIITaskCAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIITaskCAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
