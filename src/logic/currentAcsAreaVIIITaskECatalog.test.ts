import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_E_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_E_SOURCE,
  resolveCurrentAreaVIIITaskEAktrCode,
} from "./currentAcsAreaVIIITaskECatalog";

describe("Private Pilot Airplane ACS 6C Area VIII Task E (PA.VIII.E) catalog slice", () => {
  const expectedCodes = [
    "PA.VIII.E.K1",
    "PA.VIII.E.K2",
    "PA.VIII.E.K3",
    "PA.VIII.E.K4",
    "PA.VIII.E.R1",
    "PA.VIII.E.R3",
    "PA.VIII.E.R4",
    "PA.VIII.E.R5",
    "PA.VIII.E.R7",
    "PA.VIII.E.R8",
    "PA.VIII.E.R9",
    "PA.VIII.E.R10",
    "PA.VIII.E.S1",
    "PA.VIII.E.S2",
  ] as const;

  it("contains exactly the 14 verified Area VIII Task E codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_E_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(14);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_E_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("VIII");
      expect(entry.task).toBe("E");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_E_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.VIII.E coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_E_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "49–50",
      pdfPages: "57–58",
      areaOfOperation: "Area of Operation VIII: Basic Instrument Maneuvers",
      task: "Task E. Recovery from Unusual Flight Attitudes",
      coverageLabel: "PA.VIII.E",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.VIII.E.K1":
        "Prevention of unusual attitudes, including flight causal, physiological, and environmental factors, and system and equipment failures.",
      "PA.VIII.E.K2": "Procedures for recovery from unusual attitudes in flight.",
      "PA.VIII.E.K3":
        "Procedures available to safely regain visual meteorological conditions (VMC) after flight into inadvertent instrument meteorological conditions or unintended instrument meteorological conditions (IIMC)/(UIMC).",
      "PA.VIII.E.K4": "Appropriate use of automation, if applicable.",
      "PA.VIII.E.R1":
        "Situations that could lead to loss of control in-flight (LOC-I) or unusual attitudes in-flight (e.g., stress, task saturation, inadequate instrument scan distractions, and spatial disorientation).",
      "PA.VIII.E.R3": "Collision hazards.",
      "PA.VIII.E.R4":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.VIII.E.R5": "Interpreting flight instruments.",
      "PA.VIII.E.R7": "Operating envelope considerations.",
      "PA.VIII.E.R8": "Control input errors, inducing undesired aircraft attitudes.",
      "PA.VIII.E.R9": "Assessment of the unusual attitude.",
      "PA.VIII.E.R10": "Control application solely by reference to instruments.",
      "PA.VIII.E.S1":
        "Use proper instrument cross-check and interpretation to identify an unusual attitude (including both nose-high and nose-low) in flight, and apply the appropriate flight control, power input, and aircraft configuration in the correct sequence, to return to a stabilized level flight attitude.",
      "PA.VIII.E.S2":
        "Use single-pilot resource management (SRM) or crew resource management (CRM), as appropriate.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_E_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area VIII Task E code with case-insensitive ASCII matching", () => {
    // Knowledge codes
    const resK1 = resolveCurrentAreaVIIITaskEAktrCode("pa.viii.e.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.E.K1",
        description:
          "Prevention of unusual attitudes, including flight causal, physiological, and environmental factors, and system and equipment failures.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VIII",
        task: "E",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_E_SOURCE,
      },
    });

    const resK4 = resolveCurrentAreaVIIITaskEAktrCode("PA.VIII.E.K4");
    expect(resK4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.E.K4",
        description: "Appropriate use of automation, if applicable.",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaVIIITaskEAktrCode("pa.viii.e.r1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.E.R1",
        description:
          "Situations that could lead to loss of control in-flight (LOC-I) or unusual attitudes in-flight (e.g., stress, task saturation, inadequate instrument scan distractions, and spatial disorientation).",
      },
    });

    const resR10 = resolveCurrentAreaVIIITaskEAktrCode("PA.VIII.E.R10");
    expect(resR10).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.E.R10",
        description: "Control application solely by reference to instruments.",
      },
    });

    // Skill codes
    const resS1 = resolveCurrentAreaVIIITaskEAktrCode("pa.viii.e.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.E.S1",
        description:
          "Use proper instrument cross-check and interpretation to identify an unusual attitude (including both nose-high and nose-low) in flight, and apply the appropriate flight control, power input, and aircraft configuration in the correct sequence, to return to a stabilized level flight attitude.",
      },
    });

    const resS2 = resolveCurrentAreaVIIITaskEAktrCode("PA.VIII.E.S2");
    expect(resS2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.E.S2",
        description:
          "Use single-pilot resource management (SRM) or crew resource management (CRM), as appropriate.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area VIII Task A
    expect(resolveCurrentAreaVIIITaskEAktrCode("PA.VIII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.K1",
    });

    // Area VIII Task B
    expect(resolveCurrentAreaVIIITaskEAktrCode("PA.VIII.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.B.K1",
    });

    // Area VIII Task C
    expect(resolveCurrentAreaVIIITaskEAktrCode("PA.VIII.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.C.K1",
    });

    // Area VIII Task D
    expect(resolveCurrentAreaVIIITaskEAktrCode("PA.VIII.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.D.K1",
    });
    expect(resolveCurrentAreaVIIITaskEAktrCode("PA.VIII.D.S1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.D.S1",
    });

    // Area VII Task E (or hypothetical)
    expect(resolveCurrentAreaVIIITaskEAktrCode("PA.VII.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.VII.E.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaVIIITaskEAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes unresolved (including archived K1a-d, R2, R6)", () => {
    // Explicitly excluded archived codes for PA.VIII.E
    expect(resolveCurrentAreaVIIITaskEAktrCode("PA.VIII.E.K1a")).toEqual({
      status: "unresolved",
      code: "PA.VIII.E.K1A",
    });
    expect(resolveCurrentAreaVIIITaskEAktrCode("PA.VIII.E.K1b")).toEqual({
      status: "unresolved",
      code: "PA.VIII.E.K1B",
    });
    expect(resolveCurrentAreaVIIITaskEAktrCode("PA.VIII.E.K1c")).toEqual({
      status: "unresolved",
      code: "PA.VIII.E.K1C",
    });
    expect(resolveCurrentAreaVIIITaskEAktrCode("PA.VIII.E.K1d")).toEqual({
      status: "unresolved",
      code: "PA.VIII.E.K1D",
    });
    expect(resolveCurrentAreaVIIITaskEAktrCode("PA.VIII.E.R2")).toEqual({
      status: "unresolved",
      code: "PA.VIII.E.R2",
    });
    expect(resolveCurrentAreaVIIITaskEAktrCode("PA.VIII.E.R6")).toEqual({
      status: "unresolved",
      code: "PA.VIII.E.R6",
    });

    // Other archived codes
    expect(resolveCurrentAreaVIIITaskEAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaVIIITaskEAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaVIIITaskEAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
