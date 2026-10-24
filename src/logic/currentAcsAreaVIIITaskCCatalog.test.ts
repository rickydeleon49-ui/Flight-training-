import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_C_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_C_SOURCE,
  resolveCurrentAreaVIIITaskCAktrCode,
} from "./currentAcsAreaVIIITaskCCatalog";

describe("Private Pilot Airplane ACS 6C Area VIII Task C (PA.VIII.C) catalog slice", () => {
  const expectedCodes = [
    "PA.VIII.C.K1",
    "PA.VIII.C.K1a",
    "PA.VIII.C.K1b",
    "PA.VIII.C.K1c",
    "PA.VIII.C.K1d",
    "PA.VIII.C.R1",
    "PA.VIII.C.R2",
    "PA.VIII.C.R3",
    "PA.VIII.C.R4",
    "PA.VIII.C.R5",
    "PA.VIII.C.R6",
    "PA.VIII.C.R7",
    "PA.VIII.C.R8",
    "PA.VIII.C.S1",
    "PA.VIII.C.S2",
    "PA.VIII.C.S3",
  ] as const;

  it("contains exactly the 16 verified Area VIII Task C codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_C_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(16);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_C_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("VIII");
      expect(entry.task).toBe("C");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_C_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.VIII.C coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_C_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "47–48",
      pdfPages: "55–56",
      areaOfOperation: "Area of Operation VIII: Basic Instrument Maneuvers",
      task: "Task C. Constant Airspeed Descents",
      coverageLabel: "PA.VIII.C",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published with list markers stripped from child descriptions", () => {
    const expectedMap: Record<string, string> = {
      "PA.VIII.C.K1": "Flight instruments as they relate to:",
      "PA.VIII.C.K1a": "Instrument limitations and potential errors",
      "PA.VIII.C.K1b": "Indication of the aircraft attitude",
      "PA.VIII.C.K1c": "Function and operation",
      "PA.VIII.C.K1d": "Proper instrument cross-check techniques",
      "PA.VIII.C.R1":
        "Instrument flying hazards, including failure to maintain visual flight rules (VFR), spatial disorientation, loss of control, fatigue, stress, and emergency off airport landings.",
      "PA.VIII.C.R2": "When to seek assistance or declare an emergency in a deteriorating situation.",
      "PA.VIII.C.R3": "Collision hazards.",
      "PA.VIII.C.R4":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.VIII.C.R5": "Fixation and omission.",
      "PA.VIII.C.R6": "Instrument Interpretation.",
      "PA.VIII.C.R7": "Control application solely by reference to instruments.",
      "PA.VIII.C.R8": "Trimming the aircraft.",
      "PA.VIII.C.S1":
        "Transition to the descent pitch attitude and power setting on an assigned heading using proper instrument cross-check and interpretation, and coordinated flight control application.",
      "PA.VIII.C.S2": "Descend at a constant airspeed to specific altitudes in straight flight and turns.",
      "PA.VIII.C.S3":
        "Level off at the assigned altitude and maintain altitude ±200 feet, heading ±20°, and airspeed ±10 knots.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_C_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area VIII Task C code with case-insensitive ASCII matching including parent and child codes", () => {
    // Parent code
    const resK1 = resolveCurrentAreaVIIITaskCAktrCode("pa.viii.c.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.C.K1",
        description: "Flight instruments as they relate to:",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VIII",
        task: "C",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_C_SOURCE,
      },
    });

    // Children K1a - K1d
    const resK1a = resolveCurrentAreaVIIITaskCAktrCode("pa.viii.c.k1a");
    expect(resK1a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.C.K1a",
        description: "Instrument limitations and potential errors",
      },
    });

    const resK1b = resolveCurrentAreaVIIITaskCAktrCode("PA.VIII.C.K1B");
    expect(resK1b).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.C.K1b",
        description: "Indication of the aircraft attitude",
      },
    });

    const resK1c = resolveCurrentAreaVIIITaskCAktrCode("pa.viii.c.k1c");
    expect(resK1c).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.C.K1c",
        description: "Function and operation",
      },
    });

    const resK1d = resolveCurrentAreaVIIITaskCAktrCode("PA.VIII.C.K1D");
    expect(resK1d).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.C.K1d",
        description: "Proper instrument cross-check techniques",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaVIIITaskCAktrCode("PA.VIII.C.R1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.C.R1",
        description:
          "Instrument flying hazards, including failure to maintain visual flight rules (VFR), spatial disorientation, loss of control, fatigue, stress, and emergency off airport landings.",
      },
    });

    const resR8 = resolveCurrentAreaVIIITaskCAktrCode("pa.viii.c.r8");
    expect(resR8).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.C.R8",
        description: "Trimming the aircraft.",
      },
    });

    // Skill codes
    const resS1 = resolveCurrentAreaVIIITaskCAktrCode("pa.viii.c.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.C.S1",
        description:
          "Transition to the descent pitch attitude and power setting on an assigned heading using proper instrument cross-check and interpretation, and coordinated flight control application.",
      },
    });

    const resS2 = resolveCurrentAreaVIIITaskCAktrCode("PA.VIII.C.S2");
    expect(resS2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.C.S2",
        description: "Descend at a constant airspeed to specific altitudes in straight flight and turns.",
      },
    });

    const resS3 = resolveCurrentAreaVIIITaskCAktrCode("pa.viii.c.s3");
    expect(resS3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.C.S3",
        description:
          "Level off at the assigned altitude and maintain altitude ±200 feet, heading ±20°, and airspeed ±10 knots.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area VIII Task A
    expect(resolveCurrentAreaVIIITaskCAktrCode("PA.VIII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.K1",
    });
    expect(resolveCurrentAreaVIIITaskCAktrCode("PA.VIII.A.S1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.S1",
    });

    // Area VIII Task B
    expect(resolveCurrentAreaVIIITaskCAktrCode("PA.VIII.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.B.K1",
    });
    expect(resolveCurrentAreaVIIITaskCAktrCode("PA.VIII.B.S1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.B.S1",
    });

    // Area VIII Task D (hypothetical or future task)
    expect(resolveCurrentAreaVIIITaskCAktrCode("PA.VIII.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.D.K1",
    });

    // Area VII Task D
    expect(resolveCurrentAreaVIIITaskCAktrCode("PA.VII.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.VII.D.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaVIIITaskCAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    expect(resolveCurrentAreaVIIITaskCAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaVIIITaskCAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaVIIITaskCAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
