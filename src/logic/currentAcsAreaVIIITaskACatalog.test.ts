import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_A_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_A_SOURCE,
  resolveCurrentAreaVIIITaskAAktrCode,
} from "./currentAcsAreaVIIITaskACatalog";

describe("Private Pilot Airplane ACS 6C Area VIII Task A (PA.VIII.A) catalog slice", () => {
  const expectedCodes = [
    "PA.VIII.A.K1",
    "PA.VIII.A.K1a",
    "PA.VIII.A.K1b",
    "PA.VIII.A.K1c",
    "PA.VIII.A.K1d",
    "PA.VIII.A.R1",
    "PA.VIII.A.R2",
    "PA.VIII.A.R3",
    "PA.VIII.A.R4",
    "PA.VIII.A.R5",
    "PA.VIII.A.R6",
    "PA.VIII.A.R7",
    "PA.VIII.A.R8",
    "PA.VIII.A.S1",
    "PA.VIII.A.S2",
  ] as const;

  it("contains exactly the 15 verified Area VIII Task A codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_A_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(15);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_A_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("VIII");
      expect(entry.task).toBe("A");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_A_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.VIII.A coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_A_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "46",
      pdfPages: "54",
      areaOfOperation: "Area of Operation VIII: Basic Instrument Maneuvers",
      task: "Task A. Straight-and-Level Flight",
      coverageLabel: "PA.VIII.A",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published with list markers stripped from child descriptions", () => {
    const expectedMap: Record<string, string> = {
      "PA.VIII.A.K1": "Flight instruments as they relate to:",
      "PA.VIII.A.K1a": "Instrument limitations and potential errors",
      "PA.VIII.A.K1b": "Indication of the aircraft attitude",
      "PA.VIII.A.K1c": "Function and operation",
      "PA.VIII.A.K1d": "Proper instrument cross-check techniques",
      "PA.VIII.A.R1":
        "Instrument flying hazards, including failure to maintain visual flight rules (VFR), spatial disorientation, loss of control, fatigue, stress, and emergency off airport landings.",
      "PA.VIII.A.R2": "When to seek assistance or declare an emergency in a deteriorating situation.",
      "PA.VIII.A.R3": "Collision hazards.",
      "PA.VIII.A.R4":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.VIII.A.R5": "Fixation and omission.",
      "PA.VIII.A.R6": "Instrument Interpretation.",
      "PA.VIII.A.R7": "Control application solely by reference to instruments.",
      "PA.VIII.A.R8": "Trimming the aircraft.",
      "PA.VIII.A.S1":
        "Maintain straight-and-level flight using proper instrument cross-check and interpretation, and coordinated control application.",
      "PA.VIII.A.S2": "Maintain altitude ±200 feet, heading ±20°, and airspeed ±10 knots.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_A_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area VIII Task A code with case-insensitive ASCII matching including parent and child codes", () => {
    // Parent code
    const resK1 = resolveCurrentAreaVIIITaskAAktrCode("pa.viii.a.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.A.K1",
        description: "Flight instruments as they relate to:",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VIII",
        task: "A",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_A_SOURCE,
      },
    });

    // Children K1a - K1d
    const resK1a = resolveCurrentAreaVIIITaskAAktrCode("pa.viii.a.k1a");
    expect(resK1a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.A.K1a",
        description: "Instrument limitations and potential errors",
      },
    });

    const resK1b = resolveCurrentAreaVIIITaskAAktrCode("PA.VIII.A.K1B");
    expect(resK1b).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.A.K1b",
        description: "Indication of the aircraft attitude",
      },
    });

    const resK1c = resolveCurrentAreaVIIITaskAAktrCode("pa.viii.a.k1c");
    expect(resK1c).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.A.K1c",
        description: "Function and operation",
      },
    });

    const resK1d = resolveCurrentAreaVIIITaskAAktrCode("PA.VIII.A.K1D");
    expect(resK1d).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.A.K1d",
        description: "Proper instrument cross-check techniques",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaVIIITaskAAktrCode("PA.VIII.A.R1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.A.R1",
        description:
          "Instrument flying hazards, including failure to maintain visual flight rules (VFR), spatial disorientation, loss of control, fatigue, stress, and emergency off airport landings.",
      },
    });

    const resR8 = resolveCurrentAreaVIIITaskAAktrCode("pa.viii.a.r8");
    expect(resR8).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.A.R8",
        description: "Trimming the aircraft.",
      },
    });

    // Skill codes
    const resS1 = resolveCurrentAreaVIIITaskAAktrCode("pa.viii.a.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.A.S1",
        description:
          "Maintain straight-and-level flight using proper instrument cross-check and interpretation, and coordinated control application.",
      },
    });

    const resS2 = resolveCurrentAreaVIIITaskAAktrCode("PA.VIII.A.S2");
    expect(resS2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.A.S2",
        description: "Maintain altitude ±200 feet, heading ±20°, and airspeed ±10 knots.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area VIII Task B (hypothetical or future task)
    expect(resolveCurrentAreaVIIITaskAAktrCode("PA.VIII.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.B.K1",
    });
    expect(resolveCurrentAreaVIIITaskAAktrCode("PA.VIII.B.S1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.B.S1",
    });

    // Area VII Task D
    expect(resolveCurrentAreaVIIITaskAAktrCode("PA.VII.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.VII.D.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaVIIITaskAAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    expect(resolveCurrentAreaVIIITaskAAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaVIIITaskAAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaVIIITaskAAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
