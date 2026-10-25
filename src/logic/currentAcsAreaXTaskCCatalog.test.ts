import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_C_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_C_SOURCE,
  resolveCurrentAreaXTaskCAktrCode,
} from "./currentAcsAreaXTaskCCatalog";

describe("Private Pilot Airplane ACS 6C Area X Task C (PA.X.C) catalog slice", () => {
  const expectedCodes = [
    "PA.X.C.K1",
    "PA.X.C.R1",
    "PA.X.C.R2",
    "PA.X.C.R3",
    "PA.X.C.R4",
    "PA.X.C.R5",
    "PA.X.C.S1",
    "PA.X.C.S2",
    "PA.X.C.S3",
    "PA.X.C.S4",
    "PA.X.C.S5",
    "PA.X.C.S6",
    "PA.X.C.S7",
    "PA.X.C.S8",
    "PA.X.C.S9",
    "PA.X.C.S10",
    "PA.X.C.S11",
  ] as const;

  it("contains exactly the 17 verified Area X Task C codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_C_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(17);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_C_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("X");
      expect(entry.task).toBe("C");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_C_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.X.C coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_C_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "61–62",
      pdfPages: "68–69",
      areaOfOperation: "Area of Operation X: Multiengine Operations",
      task: "Task C. One Engine Inoperative (Simulated) During Straight-and-Level Flight and Turns (AMEL, AMES)",
      coverageLabel: "PA.X.C",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.X.C.K1":
        "Procedures used if engine failure occurs during straight-and-level flight and turns while on instruments.",
      "PA.X.C.R1": "Identification of the inoperative engine.",
      "PA.X.C.R2":
        "Inability to climb or maintain altitude with an inoperative engine.",
      "PA.X.C.R3":
        "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.X.C.R4":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.X.C.R5": "Fuel management during single-engine operation.",
      "PA.X.C.S1":
        "Promptly recognize an engine failure and maintain positive aircraft control.",
      "PA.X.C.S2":
        "Set the engine controls, reduce drag, identify and verify the inoperative engine, and simulate feathering of the propeller on the inoperative engine (evaluator should then establish zero thrust on the inoperative engine).",
      "PA.X.C.S3":
        "Establish the best engine-inoperative airspeed and trim the airplane.",
      "PA.X.C.S4":
        "Use flight controls in the proper combination as recommended by the manufacturer, or as required to maintain best performance, and trim as required.",
      "PA.X.C.S5":
        "Verify the prescribed checklist procedures used for securing the inoperative engine.",
      "PA.X.C.S6":
        "Attempt to determine and resolve the reason for the engine failure.",
      "PA.X.C.S7": "Monitor engine functions and make necessary adjustments.",
      "PA.X.C.S8":
        "Maintain the specified altitude ±100 feet or minimum sink rate if applicable, airspeed ±10 knots, and the specified heading ±10°.",
      "PA.X.C.S9":
        "Assess the aircraft’s performance capability and decide an appropriate action to ensure a safe landing.",
      "PA.X.C.S10":
        "Avoid loss of airplane control or attempted flight contrary to the engine-inoperative operating limitations of the airplane.",
      "PA.X.C.S11":
        "Use single-pilot resource management (SRM) or crew resource management (CRM), as appropriate.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_C_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area X Task C code with case-insensitive ASCII matching", () => {
    // Knowledge codes
    const resK1 = resolveCurrentAreaXTaskCAktrCode("pa.x.c.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.C.K1",
        description:
          "Procedures used if engine failure occurs during straight-and-level flight and turns while on instruments.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "X",
        task: "C",
      },
    });

    const resK1Upper = resolveCurrentAreaXTaskCAktrCode("PA.X.C.K1");
    expect(resK1Upper).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.C.K1",
        description:
          "Procedures used if engine failure occurs during straight-and-level flight and turns while on instruments.",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaXTaskCAktrCode("pa.x.c.r1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.C.R1",
        description: "Identification of the inoperative engine.",
      },
    });

    const resR5 = resolveCurrentAreaXTaskCAktrCode("PA.X.C.R5");
    expect(resR5).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.C.R5",
        description: "Fuel management during single-engine operation.",
      },
    });

    // Skill codes
    const resS1 = resolveCurrentAreaXTaskCAktrCode("pa.x.c.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.C.S1",
        description:
          "Promptly recognize an engine failure and maintain positive aircraft control.",
      },
    });

    const resS2 = resolveCurrentAreaXTaskCAktrCode("PA.X.C.S2");
    expect(resS2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.C.S2",
        description:
          "Set the engine controls, reduce drag, identify and verify the inoperative engine, and simulate feathering of the propeller on the inoperative engine (evaluator should then establish zero thrust on the inoperative engine).",
      },
    });

    const resS11 = resolveCurrentAreaXTaskCAktrCode("pa.x.c.s11");
    expect(resS11).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.C.S11",
        description:
          "Use single-pilot resource management (SRM) or crew resource management (CRM), as appropriate.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area X Task A
    expect(resolveCurrentAreaXTaskCAktrCode("PA.X.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.X.A.K1",
    });

    // Area X Task B
    expect(resolveCurrentAreaXTaskCAktrCode("PA.X.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.X.B.K1",
    });

    // Area IX Task A
    expect(resolveCurrentAreaXTaskCAktrCode("PA.IX.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.A.K1",
    });

    // Area VIII Task A
    expect(resolveCurrentAreaXTaskCAktrCode("PA.VIII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaXTaskCAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes and non-existent sub-elements unresolved", () => {
    expect(resolveCurrentAreaXTaskCAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
    expect(resolveCurrentAreaXTaskCAktrCode("PA.X.C.K2")).toEqual({
      status: "unresolved",
      code: "PA.X.C.K2",
    });
    expect(resolveCurrentAreaXTaskCAktrCode("PA.X.C.R6")).toEqual({
      status: "unresolved",
      code: "PA.X.C.R6",
    });
    expect(resolveCurrentAreaXTaskCAktrCode("PA.X.C.S12")).toEqual({
      status: "unresolved",
      code: "PA.X.C.S12",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaXTaskCAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaXTaskCAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
    expect(resolveCurrentAreaXTaskCAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
