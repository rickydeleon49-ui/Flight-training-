import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_I_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_I_SOURCE,
  resolveCurrentAreaIVTaskIAktrCode,
} from "./currentAcsAreaIVTaskICatalog";

describe("Private Pilot Airplane ACS 6C Area IV Task I (PA.IV.I) catalog slice", () => {
  const expectedCodes = [
    "PA.IV.I.K1",
    "PA.IV.I.K2",
    "PA.IV.I.K3",
    "PA.IV.I.K4",
    "PA.IV.I.R1",
    "PA.IV.I.R2",
    "PA.IV.I.R3",
    "PA.IV.I.R3a",
    "PA.IV.I.R3b",
    "PA.IV.I.R4",
    "PA.IV.I.R5",
    "PA.IV.I.R6",
    "PA.IV.I.R7",
    "PA.IV.I.S1",
    "PA.IV.I.S2",
    "PA.IV.I.S3",
    "PA.IV.I.S4",
    "PA.IV.I.S4a",
    "PA.IV.I.S4b",
    "PA.IV.I.S6",
    "PA.IV.I.S7",
    "PA.IV.I.S8",
    "PA.IV.I.S9",
    "PA.IV.I.S10",
    "PA.IV.I.S11",
    "PA.IV.I.S12",
  ] as const;

  it("contains exactly the 26 verified Area IV Task I codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_I_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(26);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_I_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IV");
      expect(entry.task).toBe("I");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_I_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IV.I coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_I_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "28–29",
      pdfPages: "36–37",
      areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
      task: "Task I. Glassy Water Takeoff and Climb (ASES, AMES)",
      coverageLabel: "PA.IV.I",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IV.I.K1": "Effects of atmospheric conditions, including wind, on takeoff and climb performance.",
      "PA.IV.I.K2": "Best angle of climb speed (VX) and best rate of climb speed (VY).",
      "PA.IV.I.K3": "Appropriate airplane configuration.",
      "PA.IV.I.K4": "Appropriate use of glassy water takeoff and climb technique.",
      "PA.IV.I.R1": "Selection of takeoff path based on pilot capability, airplane performance and limitations, and available distance.",
      "PA.IV.I.R2": "Water surface/condition.",
      "PA.IV.I.R3": "Abnormal operations, including planning for:",
      "PA.IV.I.R3a": "Rejected takeoff",
      "PA.IV.I.R3b": "Potential engine failure in takeoff/climb phase of flight",
      "PA.IV.I.R4": "Collision hazards.",
      "PA.IV.I.R5": "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IV.I.R6": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IV.I.R7": "Gear position in an amphibious airplane.",
      "PA.IV.I.S1": "Complete the appropriate checklist(s).",
      "PA.IV.I.S2": "Make radio calls as appropriate.",
      "PA.IV.I.S3": "Position flight controls and configure the aircraft for the existing conditions.",
      "PA.IV.I.S4": "Clear the area, select appropriate takeoff path considering surface hazards or vessels and surface conditions:",
      "PA.IV.I.S4a": "Retract the water rudders, as appropriate",
      "PA.IV.I.S4b": "Advance the throttle smoothly to takeoff power and confirm proper engine and flight instrument indications prior to rotation",
      "PA.IV.I.S6": "Establish and maintain an appropriate planing attitude, directional control, and correct for porpoising, skipping, and increase in water drag.",
      "PA.IV.I.S7": "Avoid excessive water spray on the propeller(s).",
      "PA.IV.I.S8": "Use appropriate techniques to lift seaplane from the water considering surface conditions.",
      "PA.IV.I.S9": "Establish proper attitude/airspeed and accelerate to VY +10/-5 knots during the climb.",
      "PA.IV.I.S10": "Configure the airplane after a positive rate of climb has been verified or in accordance with airplane manufacturer’s instructions.",
      "PA.IV.I.S11": "Maintain VY +10/-5 knots to a safe maneuvering altitude.",
      "PA.IV.I.S12": "Maintain directional control throughout takeoff and climb.",
    };

    expect(CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_I_CODES).toHaveLength(26);
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_I_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves each code in the slice case-insensitively and returns current metadata", () => {
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_I_CODES) {
      const lowerResolution = resolveCurrentAreaIVTaskIAktrCode(entry.code.toLowerCase());
      expect(lowerResolution.status).toBe("current");
      if (lowerResolution.status === "current") {
        expect(lowerResolution.entry).toBe(entry);
      }

      const exactResolution = resolveCurrentAreaIVTaskIAktrCode(entry.code);
      expect(exactResolution.status).toBe("current");
      if (exactResolution.status === "current") {
        expect(exactResolution.entry).toBe(entry);
      }
    }
  });

  it("excludes archived S5 from this current slice catalog and resolver", () => {
    expect(CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_I_CODES.find((c) => c.code === "PA.IV.I.S5")).toBeUndefined();

    expect(resolveCurrentAreaIVTaskIAktrCode("PA.IV.I.S5")).toEqual({
      status: "unresolved",
      code: "PA.IV.I.S5",
    });

    expect(resolveCurrentAreaIVTaskIAktrCode("pa.iv.i.s5")).toEqual({
      status: "unresolved",
      code: "PA.IV.I.S5",
    });
  });

  it("returns unresolved for codes outside the PA.IV.I slice", () => {
    const outOfSliceCodes = [
      "PA.IV.H.S13",
      "PA.IV.I.K5",
      "PA.IV.I.R8",
      "PA.IV.I.S5",
      "PA.IV.I.S13",
      "PA.IV.J.K1",
      "PA.I.A.K1",
      "",
      "UNKNOWN",
      "PLT044",
    ];

    for (const code of outOfSliceCodes) {
      const resolution = resolveCurrentAreaIVTaskIAktrCode(code);
      expect(resolution).toEqual({
        status: "unresolved",
        code: code.toUpperCase(),
      });
    }
  });
});
