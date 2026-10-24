import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_B_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_B_SOURCE,
  resolveCurrentAreaVIIITaskBAktrCode,
} from "./currentAcsAreaVIIITaskBCatalog";

describe("Private Pilot Airplane ACS 6C Area VIII Task B (PA.VIII.B) catalog slice", () => {
  const expectedCodes = [
    "PA.VIII.B.K1",
    "PA.VIII.B.K1a",
    "PA.VIII.B.K1b",
    "PA.VIII.B.K1c",
    "PA.VIII.B.K1d",
    "PA.VIII.B.R1",
    "PA.VIII.B.R2",
    "PA.VIII.B.R3",
    "PA.VIII.B.R4",
    "PA.VIII.B.R5",
    "PA.VIII.B.R6",
    "PA.VIII.B.R7",
    "PA.VIII.B.R8",
    "PA.VIII.B.S1",
    "PA.VIII.B.S2",
    "PA.VIII.B.S3",
  ] as const;

  it("contains exactly the 16 verified Area VIII Task B codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_B_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(16);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_B_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("VIII");
      expect(entry.task).toBe("B");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_B_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.VIII.B coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_B_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "46–47",
      pdfPages: "54–55",
      areaOfOperation: "Area of Operation VIII: Basic Instrument Maneuvers",
      task: "Task B. Constant Airspeed Climbs",
      coverageLabel: "PA.VIII.B",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published with list markers stripped from child descriptions", () => {
    const expectedMap: Record<string, string> = {
      "PA.VIII.B.K1": "Flight instruments as they relate to:",
      "PA.VIII.B.K1a": "Instrument limitations and potential errors",
      "PA.VIII.B.K1b": "Indication of the aircraft attitude",
      "PA.VIII.B.K1c": "Function and operation",
      "PA.VIII.B.K1d": "Proper instrument cross-check techniques",
      "PA.VIII.B.R1":
        "Instrument flying hazards, including failure to maintain visual flight rules (VFR), spatial disorientation, loss of control, fatigue, stress, and emergency off airport landings.",
      "PA.VIII.B.R2": "When to seek assistance or declare an emergency in a deteriorating situation.",
      "PA.VIII.B.R3": "Collision hazards.",
      "PA.VIII.B.R4":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.VIII.B.R5": "Fixation and omission.",
      "PA.VIII.B.R6": "Instrument Interpretation.",
      "PA.VIII.B.R7": "Control application solely by reference to instruments.",
      "PA.VIII.B.R8": "Trimming the aircraft.",
      "PA.VIII.B.S1":
        "Transition to the climb pitch attitude and power setting on an assigned heading using proper instrument cross-check and interpretation, and coordinated flight control application.",
      "PA.VIII.B.S2": "Climb at a constant airspeed to specific altitudes in straight flight and turns.",
      "PA.VIII.B.S3":
        "Level off at the assigned altitude and maintain altitude ±200 feet, heading ±20°, and airspeed ±10 knots.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_B_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area VIII Task B code with case-insensitive ASCII matching including parent and child codes", () => {
    // Parent code
    const resK1 = resolveCurrentAreaVIIITaskBAktrCode("pa.viii.b.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.B.K1",
        description: "Flight instruments as they relate to:",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VIII",
        task: "B",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_B_SOURCE,
      },
    });

    // Children K1a - K1d
    const resK1a = resolveCurrentAreaVIIITaskBAktrCode("pa.viii.b.k1a");
    expect(resK1a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.B.K1a",
        description: "Instrument limitations and potential errors",
      },
    });

    const resK1b = resolveCurrentAreaVIIITaskBAktrCode("PA.VIII.B.K1B");
    expect(resK1b).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.B.K1b",
        description: "Indication of the aircraft attitude",
      },
    });

    const resK1c = resolveCurrentAreaVIIITaskBAktrCode("pa.viii.b.k1c");
    expect(resK1c).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.B.K1c",
        description: "Function and operation",
      },
    });

    const resK1d = resolveCurrentAreaVIIITaskBAktrCode("PA.VIII.B.K1D");
    expect(resK1d).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.B.K1d",
        description: "Proper instrument cross-check techniques",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaVIIITaskBAktrCode("PA.VIII.B.R1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.B.R1",
        description:
          "Instrument flying hazards, including failure to maintain visual flight rules (VFR), spatial disorientation, loss of control, fatigue, stress, and emergency off airport landings.",
      },
    });

    const resR8 = resolveCurrentAreaVIIITaskBAktrCode("pa.viii.b.r8");
    expect(resR8).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.B.R8",
        description: "Trimming the aircraft.",
      },
    });

    // Skill codes
    const resS1 = resolveCurrentAreaVIIITaskBAktrCode("pa.viii.b.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.B.S1",
        description:
          "Transition to the climb pitch attitude and power setting on an assigned heading using proper instrument cross-check and interpretation, and coordinated flight control application.",
      },
    });

    const resS2 = resolveCurrentAreaVIIITaskBAktrCode("PA.VIII.B.S2");
    expect(resS2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.B.S2",
        description: "Climb at a constant airspeed to specific altitudes in straight flight and turns.",
      },
    });

    const resS3 = resolveCurrentAreaVIIITaskBAktrCode("pa.viii.b.s3");
    expect(resS3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.B.S3",
        description:
          "Level off at the assigned altitude and maintain altitude ±200 feet, heading ±20°, and airspeed ±10 knots.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area VIII Task A
    expect(resolveCurrentAreaVIIITaskBAktrCode("PA.VIII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.K1",
    });
    expect(resolveCurrentAreaVIIITaskBAktrCode("PA.VIII.A.S1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.S1",
    });

    // Area VIII Task C (hypothetical or future task)
    expect(resolveCurrentAreaVIIITaskBAktrCode("PA.VIII.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.C.K1",
    });

    // Area VII Task D
    expect(resolveCurrentAreaVIIITaskBAktrCode("PA.VII.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.VII.D.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaVIIITaskBAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    expect(resolveCurrentAreaVIIITaskBAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaVIIITaskBAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaVIIITaskBAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
