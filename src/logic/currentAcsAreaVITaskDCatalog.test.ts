import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_D_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_D_SOURCE,
  resolveCurrentAreaVITaskDAktrCode,
} from "./currentAcsAreaVITaskDCatalog";

describe("Private Pilot Airplane ACS 6C Area VI Task D (PA.VI.D) catalog slice", () => {
  const expectedCodes = [
    "PA.VI.D.K1",
    "PA.VI.D.K2",
    "PA.VI.D.R1",
    "PA.VI.D.R2",
    "PA.VI.D.R3",
    "PA.VI.D.R4",
    "PA.VI.D.S1",
    "PA.VI.D.S2",
    "PA.VI.D.S3",
    "PA.VI.D.S4",
    "PA.VI.D.S5",
  ] as const;

  const expectedDescriptions: Record<(typeof expectedCodes)[number], string> = {
    "PA.VI.D.K1": "Methods to determine position.",
    "PA.VI.D.K2":
      "Assistance available if lost (e.g., radar services, communication procedures).",
    "PA.VI.D.R1": "Collision hazards.",
    "PA.VI.D.R2":
      "Distractions, task prioritization, loss of situational awareness, or disorientation.",
    "PA.VI.D.R3": "Recording times over waypoints.",
    "PA.VI.D.R4":
      "When to seek assistance or declare an emergency in a deteriorating situation.",
    "PA.VI.D.S1": "Use an appropriate method to determine position.",
    "PA.VI.D.S2": "Maintain an appropriate heading and climb as necessary.",
    "PA.VI.D.S3": "Identify prominent landmarks.",
    "PA.VI.D.S4":
      "Use navigation systems/facilities or contact an ATC facility for assistance.",
    "PA.VI.D.S5": "Select an appropriate course of action.",
  };

  it("contains exactly the 11 verified Area VI Task D codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_D_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(11);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_D_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("VI");
      expect(entry.task).toBe("D");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_D_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.VI.D coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_D_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "41–42",
      pdfPages: "49–50",
      areaOfOperation: "Area of Operation VI: Navigation",
      task: "Task D. Lost Procedures",
      coverageLabel: "PA.VI.D",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("preserves exact descriptions for every code in the slice", () => {
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_D_CODES) {
      expect(entry.description).toBe(
        expectedDescriptions[entry.code as (typeof expectedCodes)[number]],
      );
    }
  });

  it("resolves codes with ASCII case-insensitivity for K, R, and S codes", () => {
    const k1 = resolveCurrentAreaVITaskDAktrCode("pa.vi.d.k1");
    expect(k1).toEqual({
      status: "current",
      entry: {
        code: "PA.VI.D.K1",
        description: "Methods to determine position.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VI",
        task: "D",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_D_SOURCE,
      },
    });

    const k2 = resolveCurrentAreaVITaskDAktrCode("PA.VI.D.K2");
    expect(k2.status).toBe("current");

    const r1 = resolveCurrentAreaVITaskDAktrCode("pa.vi.d.r1");
    expect(r1).toEqual({
      status: "current",
      entry: {
        code: "PA.VI.D.R1",
        description: "Collision hazards.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VI",
        task: "D",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_D_SOURCE,
      },
    });

    const r4 = resolveCurrentAreaVITaskDAktrCode("pa.vi.d.r4");
    expect(r4.status).toBe("current");

    const s1 = resolveCurrentAreaVITaskDAktrCode("pa.vi.d.s1");
    expect(s1).toEqual({
      status: "current",
      entry: {
        code: "PA.VI.D.S1",
        description: "Use an appropriate method to determine position.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VI",
        task: "D",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_D_SOURCE,
      },
    });

    const s5 = resolveCurrentAreaVITaskDAktrCode("PA.VI.D.S5");
    expect(s5).toEqual({
      status: "current",
      entry: {
        code: "PA.VI.D.S5",
        description: "Select an appropriate course of action.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VI",
        task: "D",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_D_SOURCE,
      },
    });

    const mixedCase = resolveCurrentAreaVITaskDAktrCode("Pa.Vi.D.s2");
    expect(mixedCase.status).toBe("current");
  });

  it("leaves out-of-slice codes and invalid tokens unresolved", () => {
    expect(resolveCurrentAreaVITaskDAktrCode("PA.VI.D.K3")).toEqual({
      status: "unresolved",
      code: "PA.VI.D.K3",
    });
    expect(resolveCurrentAreaVITaskDAktrCode("PA.VI.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.VI.C.K1",
    });
    expect(resolveCurrentAreaVITaskDAktrCode("PA.VI.D.R5")).toEqual({
      status: "unresolved",
      code: "PA.VI.D.R5",
    });
    expect(resolveCurrentAreaVITaskDAktrCode("PA.VI.D.S6")).toEqual({
      status: "unresolved",
      code: "PA.VI.D.S6",
    });
    expect(resolveCurrentAreaVITaskDAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaVITaskDAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
