import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_G_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_G_SOURCE,
  resolveCurrentAreaIXTaskGAktrCode,
} from "./currentAcsAreaIXTaskGCatalog";

describe("Private Pilot Airplane ACS 6C Area IX Task G (PA.IX.G) catalog slice", () => {
  const expectedCodes = [
    "PA.IX.G.K1",
    "PA.IX.G.K2",
    "PA.IX.G.K3",
    "PA.IX.G.K4",
    "PA.IX.G.K5",
    "PA.IX.G.R1",
    "PA.IX.G.R2",
    "PA.IX.G.R3",
    "PA.IX.G.R4",
    "PA.IX.G.R5",
    "PA.IX.G.R6",
    "PA.IX.G.S1",
    "PA.IX.G.S2",
    "PA.IX.G.S3",
    "PA.IX.G.S4",
    "PA.IX.G.S5",
    "PA.IX.G.S6",
    "PA.IX.G.S7",
    "PA.IX.G.S8",
    "PA.IX.G.S9",
    "PA.IX.G.S10",
  ] as const;

  it("contains exactly the 21 verified Area IX Task G codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_G_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(21);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_G_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IX");
      expect(entry.task).toBe("G");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_G_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IX.G coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_G_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "57–58",
      pdfPages: "64–65",
      areaOfOperation: "Area of Operation IX: Emergency Operations",
      task: "Task G. Approach and Landing with an Inoperative Engine (Simulated) (AMEL, AMES)",
      coverageLabel: "PA.IX.G",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IX.G.K1": "Factors affecting minimum controllable speed (VMC).",
      "PA.IX.G.K2":
        "VMC (red line) and best single-engine rate of climb airspeed (VYSE) (blue line).",
      "PA.IX.G.K3":
        "How to identify, verify, feather, and secure an inoperative engine.",
      "PA.IX.G.K4":
        "Importance of drag reduction, including propeller feathering, gear and flap retraction, the manufacturer’s recommended control input and its relation to zero sideslip.",
      "PA.IX.G.K5": "Applicant responsibilities during simulated feathering.",
      "PA.IX.G.R1":
        "Potential engine failure inflight or during an approach.",
      "PA.IX.G.R2": "Collision hazards.",
      "PA.IX.G.R3": "Configuring the airplane.",
      "PA.IX.G.R4":
        "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IX.G.R5":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IX.G.R6": "Possible single-engine go-around.",
      "PA.IX.G.S1":
        "Promptly recognize an engine failure and maintain positive aircraft control.",
      "PA.IX.G.S2":
        "Set the engine controls, reduce drag, identify and verify the inoperative engine, and simulate feathering of the propeller on the inoperative engine (evaluator should then establish zero thrust on the inoperative engine).",
      "PA.IX.G.S3":
        "Use flight controls in the proper combination as recommended by the manufacturer, or as required to maintain best performance, and trim as required.",
      "PA.IX.G.S4":
        "Follow the manufacturer’s recommended emergency procedures and complete the appropriate checklist.",
      "PA.IX.G.S5":
        "Monitor the operating engine and aircraft systems and make adjustments as necessary.",
      "PA.IX.G.S6":
        "Maintain the manufacturer’s recommended approach airspeed +10/-5 knots, in the landing configuration with a stabilized approach, until landing is assured.",
      "PA.IX.G.S7":
        "Make smooth, timely, and correct control application before, during, and after touchdown.",
      "PA.IX.G.S8":
        "Touch down on the first one-third of available runway/landing surface, with no drift, and the airplane’s longitudinal axis aligned with and over the runway center or landing path.",
      "PA.IX.G.S9":
        "Maintain directional control and appropriate crosswind correction throughout the approach and landing.",
      "PA.IX.G.S10": "Complete the appropriate checklist(s).",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_G_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area IX Task G code with case-insensitive ASCII matching", () => {
    // Knowledge codes
    const resK1 = resolveCurrentAreaIXTaskGAktrCode("pa.ix.g.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.G.K1",
        description: "Factors affecting minimum controllable speed (VMC).",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "IX",
        task: "G",
      },
    });

    const resK5 = resolveCurrentAreaIXTaskGAktrCode("PA.IX.G.K5");
    expect(resK5).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.G.K5",
        description: "Applicant responsibilities during simulated feathering.",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaIXTaskGAktrCode("pa.ix.g.r1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.G.R1",
        description: "Potential engine failure inflight or during an approach.",
      },
    });

    const resR6 = resolveCurrentAreaIXTaskGAktrCode("PA.IX.G.R6");
    expect(resR6).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.G.R6",
        description: "Possible single-engine go-around.",
      },
    });

    // Skill codes
    const resS1 = resolveCurrentAreaIXTaskGAktrCode("pa.ix.g.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.G.S1",
        description:
          "Promptly recognize an engine failure and maintain positive aircraft control.",
      },
    });

    const resS10 = resolveCurrentAreaIXTaskGAktrCode("PA.IX.G.S10");
    expect(resS10).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.G.S10",
        description: "Complete the appropriate checklist(s).",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area IX Task A
    expect(resolveCurrentAreaIXTaskGAktrCode("PA.IX.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.A.K1",
    });

    // Area IX Task B
    expect(resolveCurrentAreaIXTaskGAktrCode("PA.IX.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.B.K1",
    });

    // Area IX Task C
    expect(resolveCurrentAreaIXTaskGAktrCode("PA.IX.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.C.K1",
    });

    // Area IX Task D
    expect(resolveCurrentAreaIXTaskGAktrCode("PA.IX.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.D.K1",
    });

    // Area IX Task E
    expect(resolveCurrentAreaIXTaskGAktrCode("PA.IX.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.E.K1",
    });

    // Area IX Task F
    expect(resolveCurrentAreaIXTaskGAktrCode("PA.IX.F.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.F.K1",
    });

    // Area VIII Task A
    expect(resolveCurrentAreaIXTaskGAktrCode("PA.VIII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaIXTaskGAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes and non-existent sub-elements unresolved", () => {
    expect(resolveCurrentAreaIXTaskGAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
    expect(resolveCurrentAreaIXTaskGAktrCode("PA.IX.G.K6")).toEqual({
      status: "unresolved",
      code: "PA.IX.G.K6",
    });
    expect(resolveCurrentAreaIXTaskGAktrCode("PA.IX.G.R7")).toEqual({
      status: "unresolved",
      code: "PA.IX.G.R7",
    });
    expect(resolveCurrentAreaIXTaskGAktrCode("PA.IX.G.S11")).toEqual({
      status: "unresolved",
      code: "PA.IX.G.S11",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIXTaskGAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIXTaskGAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
    expect(resolveCurrentAreaIXTaskGAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
