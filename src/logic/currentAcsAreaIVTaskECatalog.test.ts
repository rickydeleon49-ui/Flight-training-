import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_E_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_E_SOURCE,
  resolveCurrentAreaIVTaskEAktrCode,
} from "./currentAcsAreaIVTaskECatalog";

describe("Private Pilot Airplane ACS 6C Area IV Task E (PA.IV.E) catalog slice", () => {
  const expectedCodes = [
    "PA.IV.E.K1",
    "PA.IV.E.K2",
    "PA.IV.E.K3",
    "PA.IV.E.R1",
    "PA.IV.E.R2",
    "PA.IV.E.R2a",
    "PA.IV.E.R2b",
    "PA.IV.E.R2c",
    "PA.IV.E.R2d",
    "PA.IV.E.R2e",
    "PA.IV.E.R3",
    "PA.IV.E.R3a",
    "PA.IV.E.R3b",
    "PA.IV.E.R4",
    "PA.IV.E.R5",
    "PA.IV.E.R6",
    "PA.IV.E.S1",
    "PA.IV.E.S2",
    "PA.IV.E.S3",
    "PA.IV.E.S4",
    "PA.IV.E.S5",
    "PA.IV.E.S6",
    "PA.IV.E.S7",
    "PA.IV.E.S8",
    "PA.IV.E.S9",
    "PA.IV.E.S10",
    "PA.IV.E.S11",
    "PA.IV.E.S12",
    "PA.IV.E.S13",
    "PA.IV.E.S14",
    "PA.IV.E.S15",
  ] as const;

  it("contains exactly the 31 verified Area IV Task E codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_E_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(31);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_E_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IV");
      expect(entry.task).toBe("E");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_E_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IV.E coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_E_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "23–24",
      pdfPages: "31–32",
      areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
      task: "Task E. Short-Field Takeoff and Maximum Performance Climb (ASEL, AMEL)",
      coverageLabel: "PA.IV.E",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IV.E.K1": "Effects of atmospheric conditions, including wind, on takeoff and climb performance.",
      "PA.IV.E.K2": "Best angle of climb speed (VX) and best rate of climb speed (VY).",
      "PA.IV.E.K3": "Appropriate airplane configuration.",
      "PA.IV.E.R1": "Selection of runway based on pilot capability, airplane performance and limitations, available distance, and wind.",
      "PA.IV.E.R2": "Effects of:",
      "PA.IV.E.R2a": "Crosswind",
      "PA.IV.E.R2b": "Windshear",
      "PA.IV.E.R2c": "Tailwind",
      "PA.IV.E.R2d": "Wake turbulence",
      "PA.IV.E.R2e": "Takeoff surface/condition",
      "PA.IV.E.R3": "Abnormal operations, including planning for:",
      "PA.IV.E.R3a": "Rejected takeoff",
      "PA.IV.E.R3b": "Potential engine failure in takeoff/climb phase of flight",
      "PA.IV.E.R4": "Collision hazards.",
      "PA.IV.E.R5": "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IV.E.R6": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IV.E.S1": "Complete the appropriate checklist(s).",
      "PA.IV.E.S2": "Make radio calls as appropriate.",
      "PA.IV.E.S3": "Verify assigned/correct runway.",
      "PA.IV.E.S4": "Determine wind direction with or without visible wind direction indicators.",
      "PA.IV.E.S5": "Position the flight controls for the existing wind, if applicable.",
      "PA.IV.E.S6": "Clear the area, taxi into takeoff position, and align the airplane on the runway centerline utilizing maximum available takeoff area.",
      "PA.IV.E.S7": "Apply brakes while setting engine power to achieve maximum performance.",
      "PA.IV.E.S8": "Confirm takeoff power prior to brake release and verify proper engine and flight instrument indications prior to rotation.",
      "PA.IV.E.S9": "Rotate and lift off at the recommended airspeed and accelerate to the recommended obstacle clearance airspeed or VX, +10/-5 knots.",
      "PA.IV.E.S10": "Establish a pitch attitude to maintain the recommended obstacle clearance airspeed or VX, +10/-5 knots until the obstacle is cleared or until the airplane is 50 feet above the surface.",
      "PA.IV.E.S11": "Establish a pitch attitude for VY and accelerate to VY +10/-5 knots after clearing the obstacle or at 50 feet AGL if simulating an obstacle.",
      "PA.IV.E.S12": "Configure the airplane in accordance with the manufacturer’s guidance after a positive rate of climb has been verified.",
      "PA.IV.E.S13": "Maintain VY +10/-5 knots to a safe maneuvering altitude.",
      "PA.IV.E.S14": "Maintain directional control and proper wind-drift correction throughout takeoff and climb.",
      "PA.IV.E.S15": "Comply with noise abatement procedures, as applicable.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_E_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area IV Task E code with case-insensitive ASCII matching, including child codes", () => {
    const resK1 = resolveCurrentAreaIVTaskEAktrCode("pa.iv.e.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.E.K1",
        description: "Effects of atmospheric conditions, including wind, on takeoff and climb performance.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "IV",
        task: "E",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_E_SOURCE,
      },
    });

    const resK2 = resolveCurrentAreaIVTaskEAktrCode("pa.iv.e.k2");
    expect(resK2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.E.K2",
        description: "Best angle of climb speed (VX) and best rate of climb speed (VY).",
      },
    });

    const resK3 = resolveCurrentAreaIVTaskEAktrCode("PA.IV.E.K3");
    expect(resK3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.E.K3",
        description: "Appropriate airplane configuration.",
      },
    });

    const resR2 = resolveCurrentAreaIVTaskEAktrCode("pa.iv.e.r2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.E.R2",
        description: "Effects of:",
      },
    });

    const resR2a = resolveCurrentAreaIVTaskEAktrCode("pa.iv.e.r2a");
    expect(resR2a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.E.R2a",
        description: "Crosswind",
      },
    });

    const resR2e = resolveCurrentAreaIVTaskEAktrCode("PA.IV.E.R2E");
    expect(resR2e).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.E.R2e",
        description: "Takeoff surface/condition",
      },
    });

    const resR3 = resolveCurrentAreaIVTaskEAktrCode("pa.iv.e.r3");
    expect(resR3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.E.R3",
        description: "Abnormal operations, including planning for:",
      },
    });

    const resR3a = resolveCurrentAreaIVTaskEAktrCode("PA.IV.E.R3A");
    expect(resR3a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.E.R3a",
        description: "Rejected takeoff",
      },
    });

    const resR3b = resolveCurrentAreaIVTaskEAktrCode("pa.iv.e.r3b");
    expect(resR3b).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.E.R3b",
        description: "Potential engine failure in takeoff/climb phase of flight",
      },
    });

    const resS6 = resolveCurrentAreaIVTaskEAktrCode("pa.iv.e.s6");
    expect(resS6).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.E.S6",
        description:
          "Clear the area, taxi into takeoff position, and align the airplane on the runway centerline utilizing maximum available takeoff area.",
      },
    });

    const resS9 = resolveCurrentAreaIVTaskEAktrCode("pa.iv.e.s9");
    expect(resS9).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.E.S9",
        description:
          "Rotate and lift off at the recommended airspeed and accelerate to the recommended obstacle clearance airspeed or VX, +10/-5 knots.",
      },
    });

    const resS10 = resolveCurrentAreaIVTaskEAktrCode("pa.iv.e.s10");
    expect(resS10).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.E.S10",
        description:
          "Establish a pitch attitude to maintain the recommended obstacle clearance airspeed or VX, +10/-5 knots until the obstacle is cleared or until the airplane is 50 feet above the surface.",
      },
    });

    const resS15 = resolveCurrentAreaIVTaskEAktrCode("PA.IV.E.S15");
    expect(resS15).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.E.S15",
        description: "Comply with noise abatement procedures, as applicable.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Representative current code outside this slice: Area IV Task A
    expect(resolveCurrentAreaIVTaskEAktrCode("PA.IV.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.A.K1",
    });

    // Representative current code outside this slice: Area IV Task B
    expect(resolveCurrentAreaIVTaskEAktrCode("PA.IV.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.B.K1",
    });

    // Representative current code outside this slice: Area IV Task C
    expect(resolveCurrentAreaIVTaskEAktrCode("PA.IV.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.C.K1",
    });

    // Representative current code outside this slice: Area IV Task D
    expect(resolveCurrentAreaIVTaskEAktrCode("PA.IV.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.D.K1",
    });

    // Representative current code outside this slice: Area I Task A
    expect(resolveCurrentAreaIVTaskEAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIVTaskEAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIVTaskEAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
