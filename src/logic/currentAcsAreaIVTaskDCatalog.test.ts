import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_D_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_D_SOURCE,
  resolveCurrentAreaIVTaskDAktrCode,
} from "./currentAcsAreaIVTaskDCatalog";

describe("Private Pilot Airplane ACS 6C Area IV Task D (PA.IV.D) catalog slice", () => {
  const expectedCodes = [
    "PA.IV.D.K1",
    "PA.IV.D.K2",
    "PA.IV.D.K3",
    "PA.IV.D.R1",
    "PA.IV.D.R2",
    "PA.IV.D.R2a",
    "PA.IV.D.R2b",
    "PA.IV.D.R2c",
    "PA.IV.D.R2d",
    "PA.IV.D.R2e",
    "PA.IV.D.R3",
    "PA.IV.D.R3a",
    "PA.IV.D.R3b",
    "PA.IV.D.R4",
    "PA.IV.D.R5",
    "PA.IV.D.R6",
    "PA.IV.D.S1",
    "PA.IV.D.S2",
    "PA.IV.D.S3",
    "PA.IV.D.S4",
    "PA.IV.D.S5",
    "PA.IV.D.S6",
    "PA.IV.D.S7",
    "PA.IV.D.S8",
    "PA.IV.D.S9",
    "PA.IV.D.S10",
    "PA.IV.D.S11",
    "PA.IV.D.S12",
    "PA.IV.D.S13",
  ] as const;

  it("contains exactly the 29 verified Area IV Task D codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_D_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(29);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_D_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IV");
      expect(entry.task).toBe("D");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_D_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IV.D coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_D_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "22–23",
      pdfPages: "30–31",
      areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
      task: "Task D. Soft-Field Approach and Landing (ASEL)",
      coverageLabel: "PA.IV.D",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IV.D.K1": "A stabilized approach, including energy management concepts.",
      "PA.IV.D.K2": "Effects of atmospheric conditions, including wind, on approach and landing performance.",
      "PA.IV.D.K3": "Wind correction techniques on approach and landing.",
      "PA.IV.D.R1": "Selection of runway based on pilot capability, airplane performance and limitations, available distance, and wind.",
      "PA.IV.D.R2": "Effects of:",
      "PA.IV.D.R2a": "Crosswind",
      "PA.IV.D.R2b": "Windshear",
      "PA.IV.D.R2c": "Tailwind",
      "PA.IV.D.R2d": "Wake turbulence",
      "PA.IV.D.R2e": "Landing surface/condition",
      "PA.IV.D.R3": "Planning for:",
      "PA.IV.D.R3a": "Rejected landing and go-around",
      "PA.IV.D.R3b": "Land and hold short operations (LAHSO)",
      "PA.IV.D.R4": "Collision hazards.",
      "PA.IV.D.R5": "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IV.D.R6": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IV.D.S1": "Complete the appropriate checklist(s).",
      "PA.IV.D.S2": "Make radio calls as appropriate.",
      "PA.IV.D.S3": "Ensure the airplane is aligned with the correct/assigned runway.",
      "PA.IV.D.S4": "Scan the landing runway and adjoining area for traffic and obstructions.",
      "PA.IV.D.S5": "Select and aim for a suitable touchdown point considering the wind conditions, landing surface, and obstructions.",
      "PA.IV.D.S6": "Establish the recommended approach and landing configuration, airspeed, and trim, and adjust pitch attitude and power as required to maintain a stabilized approach.",
      "PA.IV.D.S7": "Maintain manufacturer’s published approach airspeed or in its absence not more than 1.3 VSO, +10/-5 knots with gust factor applied.",
      "PA.IV.D.S8": "Maintain directional control and appropriate crosswind correction throughout the approach and landing.",
      "PA.IV.D.S9": "Make smooth, timely, and correct control inputs during the round out and touchdown, and, for tricycle gear airplanes, keep the nose wheel off the surface until loss of elevator effectiveness.",
      "PA.IV.D.S10": "Touch down at a proper pitch attitude with minimum sink rate, no side drift, and with the airplane’s longitudinal axis aligned with the center of the runway.",
      "PA.IV.D.S11": "Maintain elevator as recommended by manufacturer during rollout and exit the “soft” area at a speed that would preclude sinking into the surface.",
      "PA.IV.D.S12": "Execute a timely go-around if the approach cannot be made within the tolerances specified above or for any other condition that may result in an unsafe approach or landing.",
      "PA.IV.D.S13": "Maintain proper position of the flight controls and sufficient speed to taxi while on the soft surface.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_D_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area IV Task D code with case-insensitive ASCII matching, including child codes", () => {
    const resK1 = resolveCurrentAreaIVTaskDAktrCode("pa.iv.d.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.D.K1",
        description: "A stabilized approach, including energy management concepts.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "IV",
        task: "D",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_D_SOURCE,
      },
    });

    const resK2 = resolveCurrentAreaIVTaskDAktrCode("pa.iv.d.k2");
    expect(resK2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.D.K2",
        description: "Effects of atmospheric conditions, including wind, on approach and landing performance.",
      },
    });

    const resK3 = resolveCurrentAreaIVTaskDAktrCode("PA.IV.D.K3");
    expect(resK3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.D.K3",
        description: "Wind correction techniques on approach and landing.",
      },
    });

    const resR2 = resolveCurrentAreaIVTaskDAktrCode("pa.iv.d.r2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.D.R2",
        description: "Effects of:",
      },
    });

    const resR2a = resolveCurrentAreaIVTaskDAktrCode("pa.iv.d.r2a");
    expect(resR2a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.D.R2a",
        description: "Crosswind",
      },
    });

    const resR2e = resolveCurrentAreaIVTaskDAktrCode("PA.IV.D.R2E");
    expect(resR2e).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.D.R2e",
        description: "Landing surface/condition",
      },
    });

    const resR3 = resolveCurrentAreaIVTaskDAktrCode("pa.iv.d.r3");
    expect(resR3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.D.R3",
        description: "Planning for:",
      },
    });

    const resR3a = resolveCurrentAreaIVTaskDAktrCode("PA.IV.D.R3A");
    expect(resR3a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.D.R3a",
        description: "Rejected landing and go-around",
      },
    });

    const resR3b = resolveCurrentAreaIVTaskDAktrCode("pa.iv.d.r3b");
    expect(resR3b).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.D.R3b",
        description: "Land and hold short operations (LAHSO)",
      },
    });

    const resS7 = resolveCurrentAreaIVTaskDAktrCode("pa.iv.d.s7");
    expect(resS7).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.D.S7",
        description:
          "Maintain manufacturer’s published approach airspeed or in its absence not more than 1.3 VSO, +10/-5 knots with gust factor applied.",
      },
    });

    const resS9 = resolveCurrentAreaIVTaskDAktrCode("pa.iv.d.s9");
    expect(resS9).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.D.S9",
        description:
          "Make smooth, timely, and correct control inputs during the round out and touchdown, and, for tricycle gear airplanes, keep the nose wheel off the surface until loss of elevator effectiveness.",
      },
    });

    const resS11 = resolveCurrentAreaIVTaskDAktrCode("pa.iv.d.s11");
    expect(resS11).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.D.S11",
        description:
          "Maintain elevator as recommended by manufacturer during rollout and exit the “soft” area at a speed that would preclude sinking into the surface.",
      },
    });

    const resS13 = resolveCurrentAreaIVTaskDAktrCode("PA.IV.D.S13");
    expect(resS13).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.D.S13",
        description: "Maintain proper position of the flight controls and sufficient speed to taxi while on the soft surface.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Representative current code outside this slice: Area IV Task A
    expect(resolveCurrentAreaIVTaskDAktrCode("PA.IV.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.A.K1",
    });

    // Representative current code outside this slice: Area IV Task B
    expect(resolveCurrentAreaIVTaskDAktrCode("PA.IV.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.B.K1",
    });

    // Representative current code outside this slice: Area IV Task C
    expect(resolveCurrentAreaIVTaskDAktrCode("PA.IV.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.C.K1",
    });

    // Representative current code outside this slice: Area I Task A
    expect(resolveCurrentAreaIVTaskDAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIVTaskDAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIVTaskDAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
