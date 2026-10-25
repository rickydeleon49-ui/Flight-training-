import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_TASK_H_CODES,
  PRIVATE_AIRPLANE_ACS_6C_TASK_H_SOURCE,
  resolveCurrentTaskHAktrCode,
} from "./currentAcsTaskHCatalog";

describe("Private Pilot Airplane ACS 6C Task H (PA.I.H) catalog slice", () => {
  const expectedCodes = [
    "PA.I.H.K1",
    "PA.I.H.K1a",
    "PA.I.H.K1b",
    "PA.I.H.K1c",
    "PA.I.H.K1d",
    "PA.I.H.K1e",
    "PA.I.H.K1f",
    "PA.I.H.K1g",
    "PA.I.H.K1h",
    "PA.I.H.K1i",
    "PA.I.H.K1j",
    "PA.I.H.K1k",
    "PA.I.H.K1l",
    "PA.I.H.K2",
    "PA.I.H.K3",
    "PA.I.H.K4",
    "PA.I.H.R1",
    "PA.I.H.R2",
    "PA.I.H.R3",
    "PA.I.H.R4",
    "PA.I.H.S1",
    "PA.I.H.S2",
  ] as const;

  it("contains exactly the 22 verified Task H codes once each with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_TASK_H_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(22);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_H_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("I");
      expect(entry.task).toBe("H");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_TASK_H_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.I.H coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_TASK_H_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "8",
      pdfPages: "16",
      areaOfOperation: "Area of Operation I: Preflight Preparation",
      task: "Task H. Human Factors",
      coverageLabel: "PA.I.H",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.I.H.K1":
        "Symptoms, recognition, causes, effects, and corrective actions associated with aeromedical and physiological issues, including:",
      "PA.I.H.K1a": "Hypoxia",
      "PA.I.H.K1b": "Hyperventilation",
      "PA.I.H.K1c": "Middle ear and sinus problems",
      "PA.I.H.K1d": "Spatial disorientation",
      "PA.I.H.K1e": "Motion sickness",
      "PA.I.H.K1f": "Carbon monoxide poisoning",
      "PA.I.H.K1g": "Stress",
      "PA.I.H.K1h": "Fatigue",
      "PA.I.H.K1i": "Dehydration and nutrition",
      "PA.I.H.K1j": "Hypothermia",
      "PA.I.H.K1k": "Optical illusions",
      "PA.I.H.K1l": "Dissolved nitrogen in the bloodstream after scuba dives",
      "PA.I.H.K2": "Regulations regarding use of alcohol and drugs.",
      "PA.I.H.K3": "Effects of alcohol, drugs, and over-the-counter medications.",
      "PA.I.H.K4":
        "Aeronautical Decision-Making (ADM) to include using Crew Resource Management (CRM) or Single-Pilot Resource Management (SRM), as appropriate.",
      "PA.I.H.R1": "Aeromedical and physiological issues.",
      "PA.I.H.R2": "Hazardous attitudes.",
      "PA.I.H.R3": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.I.H.R4": "Confirmation and expectation bias.",
      "PA.I.H.S1":
        "Associate the symptoms and effects for at least three of the conditions listed in K1a through K1l with the cause(s) and corrective action(s).",
      "PA.I.H.S2":
        "Perform self-assessment, including fitness for flight and personal minimums, for actual flight or a scenario given by the evaluator.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_H_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Task H code with case-insensitive ASCII matching", () => {
    const res = resolveCurrentTaskHAktrCode("pa.i.h.k1");
    expect(res).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.H.K1",
        description:
          "Symptoms, recognition, causes, effects, and corrective actions associated with aeromedical and physiological issues, including:",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        source: PRIVATE_AIRPLANE_ACS_6C_TASK_H_SOURCE,
      },
    });

    const resUpper = resolveCurrentTaskHAktrCode("PA.I.H.S2");
    expect(resUpper).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.H.S2",
        description:
          "Perform self-assessment, including fitness for flight and personal minimums, for actual flight or a scenario given by the evaluator.",
      },
    });

    const resSub = resolveCurrentTaskHAktrCode("pa.i.h.k1l");
    expect(resSub).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.H.K1l",
        description: "Dissolved nitrogen in the bloodstream after scuba dives",
      },
    });
  });

  it("leaves out-of-slice current codes unresolved (including Tasks A, B, C, D, E, F, and G)", () => {
    // PA.I.A.K1 is Task A
    expect(resolveCurrentTaskHAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });

    // PA.I.B.K1 is Task B
    expect(resolveCurrentTaskHAktrCode("PA.I.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.B.K1",
    });

    // PA.I.C.K1 is Task C
    expect(resolveCurrentTaskHAktrCode("PA.I.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.C.K1",
    });

    // PA.I.D.K1 is Task D
    expect(resolveCurrentTaskHAktrCode("PA.I.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.D.K1",
    });

    // PA.I.E.K1 is Task E
    expect(resolveCurrentTaskHAktrCode("PA.I.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.E.K1",
    });

    // PA.I.F.K1 is Task F
    expect(resolveCurrentTaskHAktrCode("PA.I.F.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.F.K1",
    });

    // PA.I.G.K1 is Task G
    expect(resolveCurrentTaskHAktrCode("PA.I.G.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.G.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    // PA.III.A.R3 is an archived code in the archived catalog
    expect(resolveCurrentTaskHAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentTaskHAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentTaskHAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
