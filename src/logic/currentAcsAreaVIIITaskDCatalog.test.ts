import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_D_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_D_SOURCE,
  resolveCurrentAreaVIIITaskDAktrCode,
} from "./currentAcsAreaVIIITaskDCatalog";

describe("Private Pilot Airplane ACS 6C Area VIII Task D (PA.VIII.D) catalog slice", () => {
  const expectedCodes = [
    "PA.VIII.D.K1",
    "PA.VIII.D.K1a",
    "PA.VIII.D.K1b",
    "PA.VIII.D.K1c",
    "PA.VIII.D.K1d",
    "PA.VIII.D.R1",
    "PA.VIII.D.R2",
    "PA.VIII.D.R3",
    "PA.VIII.D.R4",
    "PA.VIII.D.R5",
    "PA.VIII.D.R6",
    "PA.VIII.D.R7",
    "PA.VIII.D.R8",
    "PA.VIII.D.S1",
  ] as const;

  it("contains exactly the 14 verified Area VIII Task D codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_D_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(14);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_D_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("VIII");
      expect(entry.task).toBe("D");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_D_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.VIII.D coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_D_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "48–49",
      pdfPages: "56–57",
      areaOfOperation: "Area of Operation VIII: Basic Instrument Maneuvers",
      task: "Task D. Turns to Headings",
      coverageLabel: "PA.VIII.D",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published with list markers stripped from child descriptions", () => {
    const expectedMap: Record<string, string> = {
      "PA.VIII.D.K1": "Flight instruments as they relate to:",
      "PA.VIII.D.K1a": "Instrument limitations and potential errors",
      "PA.VIII.D.K1b": "Indication of the aircraft attitude",
      "PA.VIII.D.K1c": "Function and operation",
      "PA.VIII.D.K1d": "Proper instrument cross-check techniques",
      "PA.VIII.D.R1":
        "Instrument flying hazards, including failure to maintain visual flight rules (VFR), spatial disorientation, loss of control, fatigue, stress, and emergency off airport landings.",
      "PA.VIII.D.R2": "When to seek assistance or declare an emergency in a deteriorating situation.",
      "PA.VIII.D.R3": "Collision hazards.",
      "PA.VIII.D.R4":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.VIII.D.R5": "Fixation and omission.",
      "PA.VIII.D.R6": "Instrument Interpretation.",
      "PA.VIII.D.R7": "Control application solely by reference to instruments.",
      "PA.VIII.D.R8": "Trimming the aircraft.",
      "PA.VIII.D.S1":
        "Turn to headings, maintain altitude ±200 feet, maintain a standard rate turn, roll out on the assigned heading ±10°, and maintain airspeed ±10 knots.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_D_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area VIII Task D code with case-insensitive ASCII matching including parent and child codes", () => {
    // Parent code
    const resK1 = resolveCurrentAreaVIIITaskDAktrCode("pa.viii.d.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.D.K1",
        description: "Flight instruments as they relate to:",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VIII",
        task: "D",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_D_SOURCE,
      },
    });

    // Children K1a - K1d
    const resK1a = resolveCurrentAreaVIIITaskDAktrCode("pa.viii.d.k1a");
    expect(resK1a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.D.K1a",
        description: "Instrument limitations and potential errors",
      },
    });

    const resK1b = resolveCurrentAreaVIIITaskDAktrCode("PA.VIII.D.K1B");
    expect(resK1b).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.D.K1b",
        description: "Indication of the aircraft attitude",
      },
    });

    const resK1c = resolveCurrentAreaVIIITaskDAktrCode("pa.viii.d.k1c");
    expect(resK1c).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.D.K1c",
        description: "Function and operation",
      },
    });

    const resK1d = resolveCurrentAreaVIIITaskDAktrCode("PA.VIII.D.K1D");
    expect(resK1d).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.D.K1d",
        description: "Proper instrument cross-check techniques",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaVIIITaskDAktrCode("PA.VIII.D.R1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.D.R1",
        description:
          "Instrument flying hazards, including failure to maintain visual flight rules (VFR), spatial disorientation, loss of control, fatigue, stress, and emergency off airport landings.",
      },
    });

    const resR8 = resolveCurrentAreaVIIITaskDAktrCode("pa.viii.d.r8");
    expect(resR8).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.D.R8",
        description: "Trimming the aircraft.",
      },
    });

    // Skill code
    const resS1 = resolveCurrentAreaVIIITaskDAktrCode("pa.viii.d.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.D.S1",
        description:
          "Turn to headings, maintain altitude ±200 feet, maintain a standard rate turn, roll out on the assigned heading ±10°, and maintain airspeed ±10 knots.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area VIII Task A
    expect(resolveCurrentAreaVIIITaskDAktrCode("PA.VIII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.K1",
    });
    expect(resolveCurrentAreaVIIITaskDAktrCode("PA.VIII.A.S1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.S1",
    });

    // Area VIII Task B
    expect(resolveCurrentAreaVIIITaskDAktrCode("PA.VIII.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.B.K1",
    });
    expect(resolveCurrentAreaVIIITaskDAktrCode("PA.VIII.B.S1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.B.S1",
    });

    // Area VIII Task C
    expect(resolveCurrentAreaVIIITaskDAktrCode("PA.VIII.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.C.K1",
    });
    expect(resolveCurrentAreaVIIITaskDAktrCode("PA.VIII.C.S1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.C.S1",
    });

    // Area VIII Task E (hypothetical or future task)
    expect(resolveCurrentAreaVIIITaskDAktrCode("PA.VIII.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.E.K1",
    });

    // Area VII Task D
    expect(resolveCurrentAreaVIIITaskDAktrCode("PA.VII.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.VII.D.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaVIIITaskDAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    expect(resolveCurrentAreaVIIITaskDAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaVIIITaskDAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaVIIITaskDAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
