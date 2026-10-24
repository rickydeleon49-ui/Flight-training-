import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_TASK_E_CODES,
  PRIVATE_AIRPLANE_ACS_6C_TASK_E_SOURCE,
  resolveCurrentTaskEAktrCode,
} from "./currentAcsTaskECatalog";

describe("Private Pilot Airplane ACS 6C Task E (PA.I.E) catalog slice", () => {
  const expectedCodes = [
    "PA.I.E.K1",
    "PA.I.E.K2",
    "PA.I.E.K3",
    "PA.I.E.K4",
    "PA.I.E.R1",
    "PA.I.E.S1",
    "PA.I.E.S2",
    "PA.I.E.S3",
  ] as const;

  it("contains exactly the 8 verified Task E codes once each with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_TASK_E_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(8);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_E_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("I");
      expect(entry.task).toBe("E");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_TASK_E_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.I.E coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_TASK_E_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "6",
      pdfPages: "14",
      areaOfOperation: "Area of Operation I: Preflight Preparation",
      task: "Task E. National Airspace System",
      coverageLabel: "PA.I.E",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.I.E.K1": "Airspace classes and associated requirements and limitations.",
      "PA.I.E.K2": "Chart symbols.",
      "PA.I.E.K3": "Special use airspace (SUA), special flight rules areas (SFRA), temporary flight restrictions (TFR), and other airspace areas.",
      "PA.I.E.K4": "Special visual flight rules (VFR) requirements.",
      "PA.I.E.R1": "Various classes and types of airspace.",
      "PA.I.E.S1": "Identify and comply with the requirements for basic VFR weather minimums and flying in particular classes of airspace.",
      "PA.I.E.S2": "Correctly identify airspace and operate in accordance with associated communication and equipment requirements.",
      "PA.I.E.S3": "Identify the requirements for operating in SUA or within a TFR. Identify and comply with special air traffic rules (SATR) and SFRA operations, if applicable.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_E_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Task E code with case-insensitive ASCII matching", () => {
    const res = resolveCurrentTaskEAktrCode("pa.i.e.k1");
    expect(res).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.E.K1",
        description: "Airspace classes and associated requirements and limitations.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        source: PRIVATE_AIRPLANE_ACS_6C_TASK_E_SOURCE,
      },
    });

    const resUpper = resolveCurrentTaskEAktrCode("PA.I.E.S3");
    expect(resUpper).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.E.S3",
        description: "Identify the requirements for operating in SUA or within a TFR. Identify and comply with special air traffic rules (SATR) and SFRA operations, if applicable.",
      },
    });

    const resMixed = resolveCurrentTaskEAktrCode("Pa.I.e.R1");
    expect(resMixed).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.E.R1",
        description: "Various classes and types of airspace.",
      },
    });
  });

  it("leaves out-of-slice current codes unresolved (including Task A, Task B, Task C, and Task D)", () => {
    // PA.I.A.K1 is Task A
    expect(resolveCurrentTaskEAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });

    // PA.I.B.K1 is Task B
    expect(resolveCurrentTaskEAktrCode("PA.I.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.B.K1",
    });

    // PA.I.C.K1 is Task C
    expect(resolveCurrentTaskEAktrCode("PA.I.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.C.K1",
    });

    // PA.I.D.K1 is Task D
    expect(resolveCurrentTaskEAktrCode("PA.I.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.D.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    // PA.III.A.R3 is an archived code in the archived catalog
    expect(resolveCurrentTaskEAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentTaskEAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentTaskEAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
