import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_C_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_C_SOURCE,
  resolveCurrentAreaIVTaskCAktrCode,
} from "./currentAcsAreaIVTaskCCatalog";

describe("Private Pilot Airplane ACS 6C Area IV Task C (PA.IV.C) catalog slice", () => {
  const expectedCodes = [
    "PA.IV.C.K1",
    "PA.IV.C.K2",
    "PA.IV.C.K3",
    "PA.IV.C.K4",
    "PA.IV.C.K5",
    "PA.IV.C.K6",
    "PA.IV.C.R1",
    "PA.IV.C.R2",
    "PA.IV.C.R2a",
    "PA.IV.C.R2b",
    "PA.IV.C.R2c",
    "PA.IV.C.R2d",
    "PA.IV.C.R2e",
    "PA.IV.C.R3",
    "PA.IV.C.R3a",
    "PA.IV.C.R3b",
    "PA.IV.C.R4",
    "PA.IV.C.R5",
    "PA.IV.C.R6",
    "PA.IV.C.S1",
    "PA.IV.C.S2",
    "PA.IV.C.S3",
    "PA.IV.C.S4",
    "PA.IV.C.S5",
    "PA.IV.C.S6",
    "PA.IV.C.S7",
    "PA.IV.C.S8",
    "PA.IV.C.S9",
    "PA.IV.C.S10",
  ] as const;

  it("contains exactly the 29 verified Area IV Task C codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_C_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(29);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_C_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IV");
      expect(entry.task).toBe("C");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_C_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IV.C coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_C_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "20–21",
      pdfPages: "28–29",
      areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
      task: "Task C. Soft-Field Takeoff and Climb (ASEL)",
      coverageLabel: "PA.IV.C",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IV.C.K1": "Effects of atmospheric conditions, including wind, on takeoff and climb performance.",
      "PA.IV.C.K2": "Best angle of climb speed (VX) and best rate of climb speed (VY).",
      "PA.IV.C.K3": "Appropriate airplane configuration.",
      "PA.IV.C.K4": "Ground effect.",
      "PA.IV.C.K5": "Importance of weight transfer from wheels to wings.",
      "PA.IV.C.K6": "Left turning tendencies.",
      "PA.IV.C.R1": "Selection of runway based on pilot capability, airplane performance and limitations, available distance, and wind.",
      "PA.IV.C.R2": "Effects of:",
      "PA.IV.C.R2a": "Crosswind",
      "PA.IV.C.R2b": "Windshear",
      "PA.IV.C.R2c": "Tailwind",
      "PA.IV.C.R2d": "Wake turbulence",
      "PA.IV.C.R2e": "Takeoff surface/condition",
      "PA.IV.C.R3": "Abnormal operations, including planning for:",
      "PA.IV.C.R3a": "Rejected takeoff",
      "PA.IV.C.R3b": "Potential engine failure in takeoff/climb phase of flight",
      "PA.IV.C.R4": "Collision hazards.",
      "PA.IV.C.R5": "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IV.C.R6": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IV.C.S1": "Complete the appropriate checklist(s).",
      "PA.IV.C.S2": "Make radio calls as appropriate.",
      "PA.IV.C.S3": "Verify assigned/correct runway.",
      "PA.IV.C.S4": "Determine wind direction with or without visible wind direction indicators.",
      "PA.IV.C.S5": "Position the flight controls for the existing wind, if applicable.",
      "PA.IV.C.S6": "Clear the area, maintain necessary flight control inputs, taxi into takeoff position and align the airplane on the runway centerline without stopping, while advancing the throttle smoothly to takeoff power.",
      "PA.IV.C.S7": "Confirm takeoff power and proper engine and flight instrument indications.",
      "PA.IV.C.S8": "Establish and maintain a pitch attitude that transfers the weight of the airplane from the wheels to the wings as rapidly as possible.",
      "PA.IV.C.S9": "Lift off at the lowest possible airspeed and remain in ground effect while accelerating to VX or VY, as appropriate.",
      "PA.IV.C.S10": "Establish a pitch attitude for VX or VY, as appropriate, and maintain selected airspeed +10/-5 knots during the climb.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_C_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area IV Task C code with case-insensitive ASCII matching, including child codes", () => {
    const resK1 = resolveCurrentAreaIVTaskCAktrCode("pa.iv.c.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.C.K1",
        description: "Effects of atmospheric conditions, including wind, on takeoff and climb performance.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "IV",
        task: "C",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_C_SOURCE,
      },
    });

    const resK2 = resolveCurrentAreaIVTaskCAktrCode("pa.iv.c.k2");
    expect(resK2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.C.K2",
        description: "Best angle of climb speed (VX) and best rate of climb speed (VY).",
      },
    });

    const resR2 = resolveCurrentAreaIVTaskCAktrCode("pa.iv.c.r2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.C.R2",
        description: "Effects of:",
      },
    });

    const resR2a = resolveCurrentAreaIVTaskCAktrCode("pa.iv.c.r2a");
    expect(resR2a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.C.R2a",
        description: "Crosswind",
      },
    });

    const resR2e = resolveCurrentAreaIVTaskCAktrCode("PA.IV.C.R2E");
    expect(resR2e).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.C.R2e",
        description: "Takeoff surface/condition",
      },
    });

    const resR3 = resolveCurrentAreaIVTaskCAktrCode("pa.iv.c.r3");
    expect(resR3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.C.R3",
        description: "Abnormal operations, including planning for:",
      },
    });

    const resR3a = resolveCurrentAreaIVTaskCAktrCode("PA.IV.C.R3A");
    expect(resR3a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.C.R3a",
        description: "Rejected takeoff",
      },
    });

    const resR3b = resolveCurrentAreaIVTaskCAktrCode("pa.iv.c.r3b");
    expect(resR3b).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.C.R3b",
        description: "Potential engine failure in takeoff/climb phase of flight",
      },
    });

    const resS6 = resolveCurrentAreaIVTaskCAktrCode("pa.iv.c.s6");
    expect(resS6).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.C.S6",
        description:
          "Clear the area, maintain necessary flight control inputs, taxi into takeoff position and align the airplane on the runway centerline without stopping, while advancing the throttle smoothly to takeoff power.",
      },
    });

    const resS8 = resolveCurrentAreaIVTaskCAktrCode("pa.iv.c.s8");
    expect(resS8).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.C.S8",
        description:
          "Establish and maintain a pitch attitude that transfers the weight of the airplane from the wheels to the wings as rapidly as possible.",
      },
    });

    const resS9 = resolveCurrentAreaIVTaskCAktrCode("pa.iv.c.s9");
    expect(resS9).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.C.S9",
        description:
          "Lift off at the lowest possible airspeed and remain in ground effect while accelerating to VX or VY, as appropriate.",
      },
    });

    const resS10 = resolveCurrentAreaIVTaskCAktrCode("PA.IV.C.S10");
    expect(resS10).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IV.C.S10",
        description:
          "Establish a pitch attitude for VX or VY, as appropriate, and maintain selected airspeed +10/-5 knots during the climb.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Representative current code outside this slice: Area IV Task A
    expect(resolveCurrentAreaIVTaskCAktrCode("PA.IV.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.A.K1",
    });

    // Representative current code outside this slice: Area IV Task B
    expect(resolveCurrentAreaIVTaskCAktrCode("PA.IV.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.B.K1",
    });

    // Representative current code outside this slice: Area III Task B
    expect(resolveCurrentAreaIVTaskCAktrCode("PA.III.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.III.B.K1",
    });

    // Representative current code outside this slice: Area I Task A
    expect(resolveCurrentAreaIVTaskCAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIVTaskCAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIVTaskCAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
