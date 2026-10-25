import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_F_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_F_SOURCE,
  resolveCurrentAreaIVTaskFAktrCode,
} from "./currentAcsAreaIVTaskFCatalog";

describe("Private Pilot Airplane ACS 6C Area IV Task F (PA.IV.F) catalog slice", () => {
  const expectedCodes = [
    "PA.IV.F.K1",
    "PA.IV.F.K2",
    "PA.IV.F.K3",
    "PA.IV.F.R1",
    "PA.IV.F.R2",
    "PA.IV.F.R2a",
    "PA.IV.F.R2b",
    "PA.IV.F.R2c",
    "PA.IV.F.R2d",
    "PA.IV.F.R2e",
    "PA.IV.F.R3",
    "PA.IV.F.R3a",
    "PA.IV.F.R3b",
    "PA.IV.F.R4",
    "PA.IV.F.R5",
    "PA.IV.F.R6",
    "PA.IV.F.S1",
    "PA.IV.F.S2",
    "PA.IV.F.S3",
    "PA.IV.F.S4",
    "PA.IV.F.S5",
    "PA.IV.F.S6",
    "PA.IV.F.S7",
    "PA.IV.F.S8",
    "PA.IV.F.S9",
    "PA.IV.F.S10",
    "PA.IV.F.S11",
    "PA.IV.F.S12",
    "PA.IV.F.S13",
  ] as const;

  it("contains exactly the 29 verified Area IV Task F codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_F_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(29);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_F_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IV");
      expect(entry.task).toBe("F");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_F_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IV.F coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_F_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "24–25",
      pdfPages: "32–33",
      areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
      task: "Task F. Short-Field Approach and Landing (ASEL, AMEL)",
      coverageLabel: "PA.IV.F",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IV.F.K1": "A stabilized approach, including energy management concepts.",
      "PA.IV.F.K2": "Effects of atmospheric conditions, including wind, on approach and landing performance.",
      "PA.IV.F.K3": "Wind correction techniques on approach and landing.",
      "PA.IV.F.R1": "Selection of runway based on pilot capability, airplane performance and limitations, available distance, and wind.",
      "PA.IV.F.R2": "Effects of:",
      "PA.IV.F.R2a": "Crosswind",
      "PA.IV.F.R2b": "Windshear",
      "PA.IV.F.R2c": "Tailwind",
      "PA.IV.F.R2d": "Wake turbulence",
      "PA.IV.F.R2e": "Landing surface/condition",
      "PA.IV.F.R3": "Planning for:",
      "PA.IV.F.R3a": "Rejected landing and go-around",
      "PA.IV.F.R3b": "Land and hold short operations (LAHSO)",
      "PA.IV.F.R4": "Collision hazards.",
      "PA.IV.F.R5": "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IV.F.R6": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IV.F.S1": "Complete the appropriate checklist(s).",
      "PA.IV.F.S2": "Make radio calls as appropriate.",
      "PA.IV.F.S3": "Ensure the airplane is aligned with the correct/assigned runway.",
      "PA.IV.F.S4": "Scan the landing runway and adjoining area for traffic and obstructions.",
      "PA.IV.F.S5": "Select and aim for a suitable touchdown point considering the wind conditions, landing surface, and obstructions.",
      "PA.IV.F.S6": "Establish the recommended approach and landing configuration, airspeed, and trim, and adjust pitch attitude and power as required to maintain a stabilized approach.",
      "PA.IV.F.S7": "Maintain manufacturer’s published approach airspeed or in its absence not more than 1.3 VSO, +10/-5 knots with gust factor applied.",
      "PA.IV.F.S8": "Maintain directional control and appropriate crosswind correction throughout the approach and landing.",
      "PA.IV.F.S9": "Make smooth, timely, and correct control application before, during, and after touchdown.",
      "PA.IV.F.S10": "Touch down at a proper pitch attitude within 200 feet beyond or on the specified point, threshold markings, or runway numbers, with no side drift, minimum float, and with the airplane's longitudinal axis aligned with and over the runway centerline.",
      "PA.IV.F.S11": "Use manufacturer’s recommended procedures for airplane configuration and braking.",
      "PA.IV.F.S12": "Execute a timely go-around if the approach cannot be made within the tolerances specified above or for any other condition that may result in an unsafe approach or landing.",
      "PA.IV.F.S13": "Use runway incursion avoidance procedures, if applicable.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_F_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area IV Task F code with case-insensitive ASCII matching, including child codes", () => {
    const resK1 = resolveCurrentAreaIVTaskFAktrCode("pa.iv.f.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.F.K1",
        description: "A stabilized approach, including energy management concepts.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "IV",
        task: "F",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_F_SOURCE,
      },
    });

    const resK2 = resolveCurrentAreaIVTaskFAktrCode("pa.iv.f.k2");
    expect(resK2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.F.K2",
        description: "Effects of atmospheric conditions, including wind, on approach and landing performance.",
      },
    });

    const resK3 = resolveCurrentAreaIVTaskFAktrCode("PA.IV.F.K3");
    expect(resK3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.F.K3",
        description: "Wind correction techniques on approach and landing.",
      },
    });

    const resR2 = resolveCurrentAreaIVTaskFAktrCode("pa.iv.f.r2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.F.R2",
        description: "Effects of:",
      },
    });

    const resR2a = resolveCurrentAreaIVTaskFAktrCode("pa.iv.f.r2a");
    expect(resR2a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.F.R2a",
        description: "Crosswind",
      },
    });

    const resR2e = resolveCurrentAreaIVTaskFAktrCode("PA.IV.F.R2E");
    expect(resR2e).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.F.R2e",
        description: "Landing surface/condition",
      },
    });

    const resR3 = resolveCurrentAreaIVTaskFAktrCode("pa.iv.f.r3");
    expect(resR3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.F.R3",
        description: "Planning for:",
      },
    });

    const resR3a = resolveCurrentAreaIVTaskFAktrCode("PA.IV.F.R3A");
    expect(resR3a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.F.R3a",
        description: "Rejected landing and go-around",
      },
    });

    const resR3b = resolveCurrentAreaIVTaskFAktrCode("pa.iv.f.r3b");
    expect(resR3b).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.F.R3b",
        description: "Land and hold short operations (LAHSO)",
      },
    });

    const resS6 = resolveCurrentAreaIVTaskFAktrCode("pa.iv.f.s6");
    expect(resS6).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.F.S6",
        description:
          "Establish the recommended approach and landing configuration, airspeed, and trim, and adjust pitch attitude and power as required to maintain a stabilized approach.",
      },
    });

    const resS7 = resolveCurrentAreaIVTaskFAktrCode("pa.iv.f.s7");
    expect(resS7).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.F.S7",
        description:
          "Maintain manufacturer’s published approach airspeed or in its absence not more than 1.3 VSO, +10/-5 knots with gust factor applied.",
      },
    });

    const resS10 = resolveCurrentAreaIVTaskFAktrCode("pa.iv.f.s10");
    expect(resS10).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.F.S10",
        description:
          "Touch down at a proper pitch attitude within 200 feet beyond or on the specified point, threshold markings, or runway numbers, with no side drift, minimum float, and with the airplane's longitudinal axis aligned with and over the runway centerline.",
      },
    });

    const resS13 = resolveCurrentAreaIVTaskFAktrCode("PA.IV.F.S13");
    expect(resS13).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.F.S13",
        description: "Use runway incursion avoidance procedures, if applicable.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Representative current code outside this slice: Area IV Task A
    expect(resolveCurrentAreaIVTaskFAktrCode("PA.IV.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.A.K1",
    });

    // Representative current code outside this slice: Area IV Task B
    expect(resolveCurrentAreaIVTaskFAktrCode("PA.IV.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.B.K1",
    });

    // Representative current code outside this slice: Area IV Task C
    expect(resolveCurrentAreaIVTaskFAktrCode("PA.IV.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.C.K1",
    });

    // Representative current code outside this slice: Area IV Task D
    expect(resolveCurrentAreaIVTaskFAktrCode("PA.IV.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.D.K1",
    });

    // Representative current code outside this slice: Area IV Task E
    expect(resolveCurrentAreaIVTaskFAktrCode("PA.IV.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.E.K1",
    });

    // Representative current code outside this slice: Area I Task A
    expect(resolveCurrentAreaIVTaskFAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIVTaskFAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIVTaskFAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
