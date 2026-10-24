import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_D_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_D_SOURCE,
  resolveCurrentAreaXTaskDAktrCode,
} from "./currentAcsAreaXTaskDCatalog";

describe("Private Pilot Airplane ACS 6C Area X Task D (PA.X.D) catalog slice", () => {
  const expectedCodes = [
    "PA.X.D.K1",
    "PA.X.D.R1",
    "PA.X.D.R2",
    "PA.X.D.R3",
    "PA.X.D.R4",
    "PA.X.D.R5",
    "PA.X.D.R6",
    "PA.X.D.S1",
    "PA.X.D.S2",
    "PA.X.D.S3",
    "PA.X.D.S4",
    "PA.X.D.S5",
    "PA.X.D.S6",
    "PA.X.D.S7",
    "PA.X.D.S8",
    "PA.X.D.S9",
    "PA.X.D.S10",
    "PA.X.D.S11",
    "PA.X.D.S12",
    "PA.X.D.S13",
  ] as const;

  it("contains exactly the 20 verified Area X Task D codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_D_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(20);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_D_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("X");
      expect(entry.task).toBe("D");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_D_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.X.D coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_D_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "62–63",
      pdfPages: "69–70",
      areaOfOperation: "Area of Operation X: Multiengine Operations",
      task: "Task D. Instrument Approach and Landing with an Inoperative Engine (Simulated) (AMEL, AMES)",
      coverageLabel: "PA.X.D",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.X.D.K1":
        "Instrument approach procedures with one engine inoperative.",
      "PA.X.D.R1":
        "Potential engine failure during approach and landing.",
      "PA.X.D.R2": "Collision hazards.",
      "PA.X.D.R3": "Configuring the airplane.",
      "PA.X.D.R4":
        "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.X.D.R5":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.X.D.R6":
        "Performing a go-around/rejected landing with an engine failure.",
      "PA.X.D.S1":
        "Promptly recognize an engine failure and maintain positive aircraft control.",
      "PA.X.D.S2":
        "Set the engine controls, reduce drag, identify and verify the inoperative engine, and simulate feathering of the propeller on the inoperative engine (evaluator should then establish zero thrust on the inoperative engine).",
      "PA.X.D.S3":
        "Use flight controls in the proper combination as recommended by the manufacturer, or as required to maintain best performance, and trim as required.",
      "PA.X.D.S4":
        "Follow the manufacturer’s recommended emergency procedures and complete the appropriate checklist.",
      "PA.X.D.S5":
        "Monitor the operating engine and aircraft systems and make adjustments as necessary.",
      "PA.X.D.S6":
        "Request and follow an actual or a simulated air traffic control (ATC) clearance for an instrument approach.",
      "PA.X.D.S7":
        "Maintain altitude ±100 feet or minimum sink rate if applicable, airspeed ±10 knots, and selected heading ±10°.",
      "PA.X.D.S8":
        "Establish a rate of descent that ensures arrival at the minimum descent altitude (MDA) or decision altitude (DA)/decision height (DH) with the airplane in a position from which a descent to a landing on the intended runway or landing path can be made, either straight in or circling as appropriate.",
      "PA.X.D.S9":
        "On final approach segment, maintain vertical (as applicable) and lateral guidance within ¾-scale deflection.",
      "PA.X.D.S10":
        "Avoid loss of airplane control or attempted flight contrary to the operating limitations of the airplane.",
      "PA.X.D.S11":
        "Comply with the published criteria for the aircraft approach category if circling.",
      "PA.X.D.S12": "Execute a landing.",
      "PA.X.D.S13": "Complete the appropriate checklist(s).",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_D_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area X Task D code with case-insensitive ASCII matching", () => {
    // Knowledge codes
    const resK1 = resolveCurrentAreaXTaskDAktrCode("pa.x.d.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.D.K1",
        description:
          "Instrument approach procedures with one engine inoperative.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "X",
        task: "D",
      },
    });

    const resK1Upper = resolveCurrentAreaXTaskDAktrCode("PA.X.D.K1");
    expect(resK1Upper).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.D.K1",
        description:
          "Instrument approach procedures with one engine inoperative.",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaXTaskDAktrCode("pa.x.d.r1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.D.R1",
        description:
          "Potential engine failure during approach and landing.",
      },
    });

    const resR6 = resolveCurrentAreaXTaskDAktrCode("PA.X.D.R6");
    expect(resR6).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.D.R6",
        description:
          "Performing a go-around/rejected landing with an engine failure.",
      },
    });

    // Skill codes
    const resS1 = resolveCurrentAreaXTaskDAktrCode("pa.x.d.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.D.S1",
        description:
          "Promptly recognize an engine failure and maintain positive aircraft control.",
      },
    });

    const resS2 = resolveCurrentAreaXTaskDAktrCode("PA.X.D.S2");
    expect(resS2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.D.S2",
        description:
          "Set the engine controls, reduce drag, identify and verify the inoperative engine, and simulate feathering of the propeller on the inoperative engine (evaluator should then establish zero thrust on the inoperative engine).",
      },
    });

    const resS13 = resolveCurrentAreaXTaskDAktrCode("pa.x.d.s13");
    expect(resS13).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.D.S13",
        description: "Complete the appropriate checklist(s).",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area X Task A
    expect(resolveCurrentAreaXTaskDAktrCode("PA.X.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.X.A.K1",
    });

    // Area X Task B
    expect(resolveCurrentAreaXTaskDAktrCode("PA.X.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.X.B.K1",
    });

    // Area X Task C
    expect(resolveCurrentAreaXTaskDAktrCode("PA.X.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.X.C.K1",
    });

    // Area IX Task A
    expect(resolveCurrentAreaXTaskDAktrCode("PA.IX.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.A.K1",
    });

    // Area VIII Task A
    expect(resolveCurrentAreaXTaskDAktrCode("PA.VIII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaXTaskDAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes and non-existent sub-elements unresolved", () => {
    expect(resolveCurrentAreaXTaskDAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
    expect(resolveCurrentAreaXTaskDAktrCode("PA.X.D.K2")).toEqual({
      status: "unresolved",
      code: "PA.X.D.K2",
    });
    expect(resolveCurrentAreaXTaskDAktrCode("PA.X.D.R7")).toEqual({
      status: "unresolved",
      code: "PA.X.D.R7",
    });
    expect(resolveCurrentAreaXTaskDAktrCode("PA.X.D.S14")).toEqual({
      status: "unresolved",
      code: "PA.X.D.S14",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaXTaskDAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaXTaskDAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
    expect(resolveCurrentAreaXTaskDAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
