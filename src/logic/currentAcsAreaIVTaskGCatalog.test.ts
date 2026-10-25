import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_G_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_G_SOURCE,
  resolveCurrentAreaIVTaskGAktrCode,
} from "./currentAcsAreaIVTaskGCatalog";

describe("Private Pilot Airplane ACS 6C Area IV Task G (PA.IV.G) catalog slice", () => {
  const expectedCodes = [
    "PA.IV.G.K1",
    "PA.IV.G.K2",
    "PA.IV.G.K3",
    "PA.IV.G.K4",
    "PA.IV.G.R1",
    "PA.IV.G.R2",
    "PA.IV.G.R2a",
    "PA.IV.G.R2b",
    "PA.IV.G.R2c",
    "PA.IV.G.R2d",
    "PA.IV.G.R2e",
    "PA.IV.G.R3",
    "PA.IV.G.R3a",
    "PA.IV.G.R3b",
    "PA.IV.G.R4",
    "PA.IV.G.R5",
    "PA.IV.G.R6",
    "PA.IV.G.S1",
    "PA.IV.G.S2",
    "PA.IV.G.S3",
    "PA.IV.G.S4",
    "PA.IV.G.S5",
    "PA.IV.G.S6",
    "PA.IV.G.S6a",
    "PA.IV.G.S7",
    "PA.IV.G.S8",
    "PA.IV.G.S9",
    "PA.IV.G.S10",
    "PA.IV.G.S11",
    "PA.IV.G.S12",
    "PA.IV.G.S13",
    "PA.IV.G.S14",
    "PA.IV.G.S15",
    "PA.IV.G.S16",
  ] as const;

  it("contains exactly the 34 verified Area IV Task G codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_G_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(34);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_G_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IV");
      expect(entry.task).toBe("G");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_G_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IV.G coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_G_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "26–27",
      pdfPages: "34–35",
      areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
      task: "Task G. Confined Area Takeoff and Maximum Performance Climb (ASES, AMES)",
      coverageLabel: "PA.IV.G",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IV.G.K1": "Effects of atmospheric conditions, including wind, on takeoff and climb performance.",
      "PA.IV.G.K2": "Best angle of climb speed (VX) and best rate of climb speed (VY).",
      "PA.IV.G.K3": "Appropriate airplane configuration.",
      "PA.IV.G.K4": "Effects of water surface.",
      "PA.IV.G.R1": "Selection of takeoff path based on pilot capability, airplane performance and limitations, available distance, and wind.",
      "PA.IV.G.R2": "Effects of:",
      "PA.IV.G.R2a": "Crosswind",
      "PA.IV.G.R2b": "Windshear",
      "PA.IV.G.R2c": "Tailwind",
      "PA.IV.G.R2d": "Wake turbulence",
      "PA.IV.G.R2e": "Water surface/condition",
      "PA.IV.G.R3": "Abnormal operations, including planning for:",
      "PA.IV.G.R3a": "Rejected takeoff",
      "PA.IV.G.R3b": "Potential engine failure in takeoff/climb phase of flight",
      "PA.IV.G.R4": "Collision hazards.",
      "PA.IV.G.R5": "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IV.G.R6": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IV.G.S1": "Complete the appropriate checklist(s).",
      "PA.IV.G.S2": "Make radio calls as appropriate.",
      "PA.IV.G.S3": "Verify assigned/correct takeoff path.",
      "PA.IV.G.S4": "Determine wind direction with or without visible wind direction indicators.",
      "PA.IV.G.S5": "Position the flight controls for the existing wind, if applicable.",
      "PA.IV.G.S6": "Clear the area, taxi into takeoff position utilizing maximum available takeoff area, and align the airplane on the takeoff path.",
      "PA.IV.G.S6a": "Retract the water rudders, as appropriate",
      "PA.IV.G.S7": "Advance the throttle smoothly to takeoff power and confirm proper engine and flight instrument indications prior to rotation.",
      "PA.IV.G.S8": "Establish a pitch attitude that maintains the most efficient planing/lift-off attitude and correct for porpoising and skipping.",
      "PA.IV.G.S9": "Avoid excessive water spray on the propeller(s).",
      "PA.IV.G.S10": "Rotate and lift off at the recommended airspeed, and accelerate to the recommended obstacle clearance airspeed or VX.",
      "PA.IV.G.S11": "Establish a pitch attitude to maintain the recommended obstacle clearance airspeed or VX, +10/-5 knots until the obstacle is cleared or until the airplane is 50 feet above the surface.",
      "PA.IV.G.S12": "Establish a pitch attitude for VY and accelerate to VY +10/-5 knots after clearing the obstacle or at 50 feet AGL if simulating an obstacle.",
      "PA.IV.G.S13": "Retract flaps, if extended, after a positive rate of climb has been verified or in accordance with airplane manufacturer’s guidance.",
      "PA.IV.G.S14": "Maintain VY +10/-5 knots to a safe maneuvering altitude.",
      "PA.IV.G.S15": "Maintain directional control and proper wind-drift correction throughout takeoff and climb.",
      "PA.IV.G.S16": "Comply with noise abatement procedures, as applicable.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_G_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area IV Task G code with case-insensitive ASCII matching, including child codes", () => {
    const resK1 = resolveCurrentAreaIVTaskGAktrCode("pa.iv.g.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.G.K1",
        description: "Effects of atmospheric conditions, including wind, on takeoff and climb performance.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "IV",
        task: "G",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_G_SOURCE,
      },
    });

    const resK2 = resolveCurrentAreaIVTaskGAktrCode("pa.iv.g.k2");
    expect(resK2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.G.K2",
        description: "Best angle of climb speed (VX) and best rate of climb speed (VY).",
      },
    });

    const resK4 = resolveCurrentAreaIVTaskGAktrCode("PA.IV.G.K4");
    expect(resK4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.G.K4",
        description: "Effects of water surface.",
      },
    });

    const resR2 = resolveCurrentAreaIVTaskGAktrCode("pa.iv.g.r2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.G.R2",
        description: "Effects of:",
      },
    });

    const resR2a = resolveCurrentAreaIVTaskGAktrCode("pa.iv.g.r2a");
    expect(resR2a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.G.R2a",
        description: "Crosswind",
      },
    });

    const resR2e = resolveCurrentAreaIVTaskGAktrCode("PA.IV.G.R2E");
    expect(resR2e).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.G.R2e",
        description: "Water surface/condition",
      },
    });

    const resR3 = resolveCurrentAreaIVTaskGAktrCode("pa.iv.g.r3");
    expect(resR3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.G.R3",
        description: "Abnormal operations, including planning for:",
      },
    });

    const resR3a = resolveCurrentAreaIVTaskGAktrCode("PA.IV.G.R3A");
    expect(resR3a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.G.R3a",
        description: "Rejected takeoff",
      },
    });

    const resR3b = resolveCurrentAreaIVTaskGAktrCode("pa.iv.g.r3b");
    expect(resR3b).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.G.R3b",
        description: "Potential engine failure in takeoff/climb phase of flight",
      },
    });

    const resS6 = resolveCurrentAreaIVTaskGAktrCode("pa.iv.g.s6");
    expect(resS6).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.G.S6",
        description:
          "Clear the area, taxi into takeoff position utilizing maximum available takeoff area, and align the airplane on the takeoff path.",
      },
    });

    const resS6a = resolveCurrentAreaIVTaskGAktrCode("pa.iv.g.s6a");
    expect(resS6a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.G.S6a",
        description: "Retract the water rudders, as appropriate",
      },
    });

    const resS8 = resolveCurrentAreaIVTaskGAktrCode("pa.iv.g.s8");
    expect(resS8).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.G.S8",
        description:
          "Establish a pitch attitude that maintains the most efficient planing/lift-off attitude and correct for porpoising and skipping.",
      },
    });

    const resS11 = resolveCurrentAreaIVTaskGAktrCode("pa.iv.g.s11");
    expect(resS11).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.G.S11",
        description:
          "Establish a pitch attitude to maintain the recommended obstacle clearance airspeed or VX, +10/-5 knots until the obstacle is cleared or until the airplane is 50 feet above the surface.",
      },
    });

    const resS16 = resolveCurrentAreaIVTaskGAktrCode("PA.IV.G.S16");
    expect(resS16).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.G.S16",
        description: "Comply with noise abatement procedures, as applicable.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Representative current code outside this slice: Area IV Task A
    expect(resolveCurrentAreaIVTaskGAktrCode("PA.IV.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.A.K1",
    });

    // Representative current code outside this slice: Area IV Task B
    expect(resolveCurrentAreaIVTaskGAktrCode("PA.IV.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.B.K1",
    });

    // Representative current code outside this slice: Area IV Task C
    expect(resolveCurrentAreaIVTaskGAktrCode("PA.IV.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.C.K1",
    });

    // Representative current code outside this slice: Area IV Task D
    expect(resolveCurrentAreaIVTaskGAktrCode("PA.IV.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.D.K1",
    });

    // Representative current code outside this slice: Area IV Task E
    expect(resolveCurrentAreaIVTaskGAktrCode("PA.IV.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.E.K1",
    });

    // Representative current code outside this slice: Area IV Task F
    expect(resolveCurrentAreaIVTaskGAktrCode("PA.IV.F.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.F.K1",
    });

    // Representative current code outside this slice: Area I Task G
    expect(resolveCurrentAreaIVTaskGAktrCode("PA.I.G.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.G.K1",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIVTaskGAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIVTaskGAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
