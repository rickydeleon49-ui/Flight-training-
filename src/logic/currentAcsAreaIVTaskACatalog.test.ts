import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_A_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_A_SOURCE,
  resolveCurrentAreaIVTaskAAktrCode,
} from "./currentAcsAreaIVTaskACatalog";

describe("Private Pilot Airplane ACS 6C Area IV Task A (PA.IV.A) catalog slice", () => {
  const expectedCodes = [
    "PA.IV.A.K1",
    "PA.IV.A.K2",
    "PA.IV.A.K3",
    "PA.IV.A.R1",
    "PA.IV.A.R2",
    "PA.IV.A.R2a",
    "PA.IV.A.R2b",
    "PA.IV.A.R2c",
    "PA.IV.A.R2d",
    "PA.IV.A.R2e",
    "PA.IV.A.R3",
    "PA.IV.A.R3a",
    "PA.IV.A.R3b",
    "PA.IV.A.R4",
    "PA.IV.A.R5",
    "PA.IV.A.R6",
    "PA.IV.A.R7",
    "PA.IV.A.S1",
    "PA.IV.A.S2",
    "PA.IV.A.S3",
    "PA.IV.A.S4",
    "PA.IV.A.S5",
    "PA.IV.A.S6",
    "PA.IV.A.S6a",
    "PA.IV.A.S7",
    "PA.IV.A.S7a",
    "PA.IV.A.S8",
    "PA.IV.A.S9",
    "PA.IV.A.S11",
    "PA.IV.A.S12",
    "PA.IV.A.S13",
    "PA.IV.A.S14",
    "PA.IV.A.S15",
  ] as const;

  it("contains exactly the 33 verified Area IV Task A codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_A_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(33);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_A_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IV");
      expect(entry.task).toBe("A");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_A_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IV.A coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_A_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "18–19",
      pdfPages: "26–27",
      areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
      task: "Task A. Normal Takeoff and Climb",
      coverageLabel: "PA.IV.A",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IV.A.K1": "Effects of atmospheric conditions, including wind, on takeoff and climb performance.",
      "PA.IV.A.K2": "Best angle of climb speed (VX) and best rate of climb speed (VY).",
      "PA.IV.A.K3": "Appropriate airplane configuration.",
      "PA.IV.A.R1": "Selection of runway or takeoff path based on aircraft performance and limitations, available distance, and wind.",
      "PA.IV.A.R2": "Effects of:",
      "PA.IV.A.R2a": "Crosswind",
      "PA.IV.A.R2b": "Windshear",
      "PA.IV.A.R2c": "Tailwind",
      "PA.IV.A.R2d": "Wake turbulence",
      "PA.IV.A.R2e": "Takeoff surface/condition",
      "PA.IV.A.R3": "Abnormal operations, including planning for:",
      "PA.IV.A.R3a": "Rejected takeoff",
      "PA.IV.A.R3b": "Potential engine failure in takeoff/climb phase of flight",
      "PA.IV.A.R4": "Collision hazards.",
      "PA.IV.A.R5": "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IV.A.R6": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IV.A.R7": "Runway incursion.",
      "PA.IV.A.S1": "Complete the appropriate checklist(s).",
      "PA.IV.A.S2": "Make radio calls as appropriate.",
      "PA.IV.A.S3": "Verify assigned/correct runway or takeoff path.",
      "PA.IV.A.S4": "Determine wind direction with or without visible wind direction indicators.",
      "PA.IV.A.S5": "Position the flight controls for the existing wind, if applicable.",
      "PA.IV.A.S6": "Clear the area, taxi into takeoff position, and align the airplane on the runway centerline (ASEL, AMEL) or takeoff path (ASES, AMES).",
      "PA.IV.A.S6a": "Retract the water rudders, as appropriate (ASES, AMES)",
      "PA.IV.A.S7": "Advance the throttle smoothly to takeoff power and confirm proper engine and flight instrument indications prior to rotation.",
      "PA.IV.A.S7a": "Establish and maintain the most efficient planing/lift-off attitude, and correct for porpoising or skipping (ASES, AMES)",
      "PA.IV.A.S8": "Avoid excessive water spray on the propeller(s) (ASES, AMES).",
      "PA.IV.A.S9": "Rotate and lift off at the recommended airspeed and accelerate to VY.",
      "PA.IV.A.S11": "Establish a pitch attitude to maintain the manufacturer’s recommended speed or VY, +10/-5 knots.",
      "PA.IV.A.S12": "Configure the airplane in accordance with manufacturer’s guidance.",
      "PA.IV.A.S13": "Maintain VY +10/-5 knots to a safe maneuvering altitude.",
      "PA.IV.A.S14": "Maintain directional control and proper wind-drift correction throughout takeoff and climb.",
      "PA.IV.A.S15": "Comply with noise abatement procedures, as applicable.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_A_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area IV Task A code with case-insensitive ASCII matching, including child codes", () => {
    const resK1 = resolveCurrentAreaIVTaskAAktrCode("pa.iv.a.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.A.K1",
        description: "Effects of atmospheric conditions, including wind, on takeoff and climb performance.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "IV",
        task: "A",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_A_SOURCE,
      },
    });

    const resR2 = resolveCurrentAreaIVTaskAAktrCode("pa.iv.a.r2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.A.R2",
        description: "Effects of:",
      },
    });

    const resR2a = resolveCurrentAreaIVTaskAAktrCode("pa.iv.a.r2a");
    expect(resR2a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.A.R2a",
        description: "Crosswind",
      },
    });

    const resR3b = resolveCurrentAreaIVTaskAAktrCode("PA.IV.A.R3B");
    expect(resR3b).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.A.R3b",
        description: "Potential engine failure in takeoff/climb phase of flight",
      },
    });

    const resS6a = resolveCurrentAreaIVTaskAAktrCode("pa.iv.a.s6a");
    expect(resS6a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.A.S6a",
        description: "Retract the water rudders, as appropriate (ASES, AMES)",
      },
    });

    const resS7a = resolveCurrentAreaIVTaskAAktrCode("PA.IV.A.S7A");
    expect(resS7a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.A.S7a",
        description: "Establish and maintain the most efficient planing/lift-off attitude, and correct for porpoising or skipping (ASES, AMES)",
      },
    });

    const resS15 = resolveCurrentAreaIVTaskAAktrCode("pa.iv.a.s15");
    expect(resS15).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.A.S15",
        description: "Comply with noise abatement procedures, as applicable.",
      },
    });
  });

  it("excludes archived S10 from this current slice catalog and resolver", () => {
    expect(CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_A_CODES.find((c) => c.code === "PA.IV.A.S10")).toBeUndefined();

    expect(resolveCurrentAreaIVTaskAAktrCode("PA.IV.A.S10")).toEqual({
      status: "unresolved",
      code: "PA.IV.A.S10",
    });

    expect(resolveCurrentAreaIVTaskAAktrCode("pa.iv.a.s10")).toEqual({
      status: "unresolved",
      code: "PA.IV.A.S10",
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Representative current code outside this slice: Area IV Task B
    expect(resolveCurrentAreaIVTaskAAktrCode("PA.IV.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.B.K1",
    });

    // Representative current code outside this slice: Area III Task B
    expect(resolveCurrentAreaIVTaskAAktrCode("PA.III.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.III.B.K1",
    });

    // Representative current code outside this slice: Area I Task A
    expect(resolveCurrentAreaIVTaskAAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIVTaskAAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIVTaskAAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
