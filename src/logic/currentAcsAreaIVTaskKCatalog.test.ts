import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_K_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_K_SOURCE,
  resolveCurrentAreaIVTaskKAktrCode,
} from "./currentAcsAreaIVTaskKCatalog";

describe("Private Pilot Airplane ACS 6C Area IV Task K (PA.IV.K) catalog slice", () => {
  const expectedCodes = [
    "PA.IV.K.K1",
    "PA.IV.K.K2",
    "PA.IV.K.K3",
    "PA.IV.K.K4",
    "PA.IV.K.R1",
    "PA.IV.K.R2",
    "PA.IV.K.R2a",
    "PA.IV.K.R2b",
    "PA.IV.K.R2c",
    "PA.IV.K.R2d",
    "PA.IV.K.R2e",
    "PA.IV.K.R3",
    "PA.IV.K.R3a",
    "PA.IV.K.R3b",
    "PA.IV.K.R4",
    "PA.IV.K.R5",
    "PA.IV.K.R6",
    "PA.IV.K.R7",
    "PA.IV.K.S1",
    "PA.IV.K.S2",
    "PA.IV.K.S3",
    "PA.IV.K.S4",
    "PA.IV.K.S5",
    "PA.IV.K.S6",
    "PA.IV.K.S6a",
    "PA.IV.K.S6b",
    "PA.IV.K.S8",
    "PA.IV.K.S9",
    "PA.IV.K.S10",
    "PA.IV.K.S11",
    "PA.IV.K.S12",
    "PA.IV.K.S13",
  ] as const;

  it("contains exactly the 32 verified Area IV Task K codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_K_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(32);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_K_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IV");
      expect(entry.task).toBe("K");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_K_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IV.K coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_K_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "31–32",
      pdfPages: "39–40",
      areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
      task: "Task K. Rough Water Takeoff and Climb (ASES, AMES)",
      coverageLabel: "PA.IV.K",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IV.K.K1": "Effects of atmospheric conditions, including wind, on takeoff and climb performance.",
      "PA.IV.K.K2": "Best angle of climb speed (VX) and best rate of climb speed (VY).",
      "PA.IV.K.K3": "Appropriate airplane configuration.",
      "PA.IV.K.K4": "Appropriate use of rough water takeoff and climb technique.",
      "PA.IV.K.R1": "Selection of takeoff path based on pilot capability, airplane performance and limitations, available distance, and wind.",
      "PA.IV.K.R2": "Effects of:",
      "PA.IV.K.R2a": "Crosswind",
      "PA.IV.K.R2b": "Windshear",
      "PA.IV.K.R2c": "Tailwind",
      "PA.IV.K.R2d": "Wake turbulence",
      "PA.IV.K.R2e": "Water surface/condition",
      "PA.IV.K.R3": "Abnormal operations, including planning for:",
      "PA.IV.K.R3a": "Rejected takeoff",
      "PA.IV.K.R3b": "Potential engine failure in takeoff/climb phase of flight",
      "PA.IV.K.R4": "Collision hazards.",
      "PA.IV.K.R5": "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IV.K.R6": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IV.K.R7": "Gear position in an amphibious airplane.",
      "PA.IV.K.S1": "Complete the appropriate checklist(s).",
      "PA.IV.K.S2": "Make radio calls as appropriate.",
      "PA.IV.K.S3": "Verify assigned/correct takeoff path.",
      "PA.IV.K.S4": "Determine wind direction with or without visible wind direction indicators.",
      "PA.IV.K.S5": "Position flight controls and configure the airplane for the existing conditions.",
      "PA.IV.K.S6": "Clear the area, select an appropriate takeoff path considering wind, swells, surface hazards, or vessels.",
      "PA.IV.K.S6a": "Retract the water rudders, as appropriate",
      "PA.IV.K.S6b": "Advance the throttle smoothly to takeoff power and confirm proper engine and flight instrument indications prior to rotation",
      "PA.IV.K.S8": "Establish and maintain an appropriate planing attitude, directional control, and correct for porpoising, skipping, and increase in water drag.",
      "PA.IV.K.S9": "Avoid excessive water spray on the propeller(s).",
      "PA.IV.K.S10": "Lift off at minimum airspeed and accelerate to VY +10/- 5 knots before leaving ground effect.",
      "PA.IV.K.S11": "Configure the airplane after a positive rate of climb has been verified or in accordance with airplane manufacturer’s instructions.",
      "PA.IV.K.S12": "Maintain VY +10/-5 knots to a safe maneuvering altitude.",
      "PA.IV.K.S13": "Maintain directional control and proper wind-drift correction throughout takeoff and climb.",
    };

    expect(CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_K_CODES).toHaveLength(32);
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_K_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves each code in the slice case-insensitively and returns current metadata", () => {
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_K_CODES) {
      const lowerResolution = resolveCurrentAreaIVTaskKAktrCode(entry.code.toLowerCase());
      expect(lowerResolution.status).toBe("current");
      if (lowerResolution.status === "current") {
        expect(lowerResolution.entry).toBe(entry);
      }

      const exactResolution = resolveCurrentAreaIVTaskKAktrCode(entry.code);
      expect(exactResolution.status).toBe("current");
      if (exactResolution.status === "current") {
        expect(exactResolution.entry).toBe(entry);
      }
    }
  });

  it("excludes archived S7 from this current slice catalog and resolver", () => {
    expect(CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_K_CODES.find((c) => c.code === "PA.IV.K.S7")).toBeUndefined();

    expect(resolveCurrentAreaIVTaskKAktrCode("PA.IV.K.S7")).toEqual({
      status: "unresolved",
      code: "PA.IV.K.S7",
    });

    expect(resolveCurrentAreaIVTaskKAktrCode("pa.iv.k.s7")).toEqual({
      status: "unresolved",
      code: "PA.IV.K.S7",
    });
  });

  it("returns unresolved for codes outside the PA.IV.K slice", () => {
    const outOfSliceCodes = [
      "PA.IV.J.S9",
      "PA.IV.K.K5",
      "PA.IV.K.R8",
      "PA.IV.K.S7",
      "PA.IV.K.S14",
      "PA.IV.L.K1",
      "PA.I.A.K1",
      "",
      "UNKNOWN",
      "PLT044",
    ];

    for (const code of outOfSliceCodes) {
      const resolution = resolveCurrentAreaIVTaskKAktrCode(code);
      expect(resolution).toEqual({
        status: "unresolved",
        code: code.toUpperCase(),
      });
    }
  });
});
