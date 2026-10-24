import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_B_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_B_SOURCE,
  resolveCurrentAreaIVTaskBAktrCode,
} from "./currentAcsAreaIVTaskBCatalog";

describe("Private Pilot Airplane ACS 6C Area IV Task B (PA.IV.B) catalog slice", () => {
  const expectedCodes = [
    "PA.IV.B.K1",
    "PA.IV.B.K2",
    "PA.IV.B.K3",
    "PA.IV.B.R1",
    "PA.IV.B.R2",
    "PA.IV.B.R2a",
    "PA.IV.B.R2b",
    "PA.IV.B.R2c",
    "PA.IV.B.R2d",
    "PA.IV.B.R2e",
    "PA.IV.B.R3",
    "PA.IV.B.R3a",
    "PA.IV.B.R3b",
    "PA.IV.B.R4",
    "PA.IV.B.R5",
    "PA.IV.B.R6",
    "PA.IV.B.S1",
    "PA.IV.B.S2",
    "PA.IV.B.S3",
    "PA.IV.B.S4",
    "PA.IV.B.S5",
    "PA.IV.B.S6",
    "PA.IV.B.S7",
    "PA.IV.B.S8",
    "PA.IV.B.S9",
    "PA.IV.B.S10",
    "PA.IV.B.S11",
    "PA.IV.B.S12",
  ] as const;

  it("contains exactly the 28 verified Area IV Task B codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_B_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(28);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_B_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IV");
      expect(entry.task).toBe("B");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_B_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IV.B coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_B_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "19–20",
      pdfPages: "27–28",
      areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
      task: "Task B. Normal Approach and Landing",
      coverageLabel: "PA.IV.B",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IV.B.K1": "A stabilized approach, including energy management concepts.",
      "PA.IV.B.K2": "Effects of atmospheric conditions, including wind, on approach and landing performance.",
      "PA.IV.B.K3": "Wind correction techniques on approach and landing.",
      "PA.IV.B.R1": "Selection of runway/landing surface, approach path, and touchdown area based on pilot capability, aircraft performance and limitations, available distance, and wind.",
      "PA.IV.B.R2": "Effects of:",
      "PA.IV.B.R2a": "Crosswind",
      "PA.IV.B.R2b": "Windshear",
      "PA.IV.B.R2c": "Tailwind",
      "PA.IV.B.R2d": "Wake turbulence",
      "PA.IV.B.R2e": "Landing surface/condition",
      "PA.IV.B.R3": "Planning for:",
      "PA.IV.B.R3a": "Rejected landing and go-around",
      "PA.IV.B.R3b": "Land and hold short operations (LAHSO)",
      "PA.IV.B.R4": "Collision hazards.",
      "PA.IV.B.R5": "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IV.B.R6": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IV.B.S1": "Complete the appropriate checklist(s).",
      "PA.IV.B.S2": "Make radio calls as appropriate.",
      "PA.IV.B.S3": "Ensure the airplane is aligned with the correct/assigned runway or landing surface.",
      "PA.IV.B.S4": "Scan the runway or landing surface and adjoining area for traffic and obstructions.",
      "PA.IV.B.S5": "Select and aim for a suitable touchdown point considering the wind conditions, landing surface, and obstructions.",
      "PA.IV.B.S6": "Establish the recommended approach and landing configuration, airspeed, and trim, and adjust pitch attitude and power as required to maintain a stabilized approach.",
      "PA.IV.B.S7": "Maintain manufacturer’s published approach airspeed or in its absence not more than 1.3 times the stalling speed or the minimum steady flight speed in the landing configuration (VSO), +10/-5 knots with gust factor applied.",
      "PA.IV.B.S8": "Maintain directional control and appropriate crosswind correction throughout the approach and landing.",
      "PA.IV.B.S9": "Make smooth, timely, and correct control application during round out and touchdown.",
      "PA.IV.B.S10": "Touch down at a proper pitch attitude, within 400 feet beyond or on the specified point, with no side drift, and with the airplane’s longitudinal axis aligned with and over the runway center/landing path.",
      "PA.IV.B.S11": "Execute a timely go-around if the approach cannot be made within the tolerances specified above or for any other condition that may result in an unsafe approach or landing.",
      "PA.IV.B.S12": "Use runway incursion avoidance procedures, if applicable.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_B_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area IV Task B code with case-insensitive ASCII matching, including child codes", () => {
    const resK1 = resolveCurrentAreaIVTaskBAktrCode("pa.iv.b.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.B.K1",
        description: "A stabilized approach, including energy management concepts.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "IV",
        task: "B",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_B_SOURCE,
      },
    });

    const resR2 = resolveCurrentAreaIVTaskBAktrCode("pa.iv.b.r2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.B.R2",
        description: "Effects of:",
      },
    });

    const resR2a = resolveCurrentAreaIVTaskBAktrCode("pa.iv.b.r2a");
    expect(resR2a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.B.R2a",
        description: "Crosswind",
      },
    });

    const resR2e = resolveCurrentAreaIVTaskBAktrCode("PA.IV.B.R2E");
    expect(resR2e).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.B.R2e",
        description: "Landing surface/condition",
      },
    });

    const resR3 = resolveCurrentAreaIVTaskBAktrCode("pa.iv.b.r3");
    expect(resR3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.B.R3",
        description: "Planning for:",
      },
    });

    const resR3a = resolveCurrentAreaIVTaskBAktrCode("PA.IV.B.R3A");
    expect(resR3a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.B.R3a",
        description: "Rejected landing and go-around",
      },
    });

    const resR3b = resolveCurrentAreaIVTaskBAktrCode("pa.iv.b.r3b");
    expect(resR3b).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.B.R3b",
        description: "Land and hold short operations (LAHSO)",
      },
    });

    const resS7 = resolveCurrentAreaIVTaskBAktrCode("pa.iv.b.s7");
    expect(resS7).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.B.S7",
        description:
          "Maintain manufacturer’s published approach airspeed or in its absence not more than 1.3 times the stalling speed or the minimum steady flight speed in the landing configuration (VSO), +10/-5 knots with gust factor applied.",
      },
    });

    const resS10 = resolveCurrentAreaIVTaskBAktrCode("PA.IV.B.S10");
    expect(resS10).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.B.S10",
        description:
          "Touch down at a proper pitch attitude, within 400 feet beyond or on the specified point, with no side drift, and with the airplane’s longitudinal axis aligned with and over the runway center/landing path.",
      },
    });

    const resS12 = resolveCurrentAreaIVTaskBAktrCode("pa.iv.b.s12");
    expect(resS12).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.B.S12",
        description: "Use runway incursion avoidance procedures, if applicable.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Representative current code outside this slice: Area IV Task A
    expect(resolveCurrentAreaIVTaskBAktrCode("PA.IV.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.A.K1",
    });

    // Representative current code outside this slice: Area IV Task C
    expect(resolveCurrentAreaIVTaskBAktrCode("PA.IV.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.C.K1",
    });

    // Representative current code outside this slice: Area III Task B
    expect(resolveCurrentAreaIVTaskBAktrCode("PA.III.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.III.B.K1",
    });

    // Representative current code outside this slice: Area I Task A
    expect(resolveCurrentAreaIVTaskBAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIVTaskBAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIVTaskBAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
