import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_N_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_N_SOURCE,
  resolveCurrentAreaIVTaskNAktrCode,
} from "./currentAcsAreaIVTaskNCatalog";

describe("Private Pilot Airplane ACS 6C Area IV Task N (PA.IV.N) catalog slice", () => {
  const expectedCodes = [
    "PA.IV.N.K1",
    "PA.IV.N.K2",
    "PA.IV.N.K3",
    "PA.IV.N.R1",
    "PA.IV.N.R2",
    "PA.IV.N.R3",
    "PA.IV.N.R4",
    "PA.IV.N.R5",
    "PA.IV.N.R6",
    "PA.IV.N.R7",
    "PA.IV.N.R8",
    "PA.IV.N.R9",
    "PA.IV.N.S1",
    "PA.IV.N.S2",
    "PA.IV.N.S3",
    "PA.IV.N.S4",
    "PA.IV.N.S5",
    "PA.IV.N.S6",
    "PA.IV.N.S7",
    "PA.IV.N.S8",
    "PA.IV.N.S9",
  ] as const;

  it("contains exactly the 21 verified Area IV Task N codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_N_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(21);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_N_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IV");
      expect(entry.task).toBe("N");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_N_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IV.N coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_N_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "35",
      pdfPages: "43",
      areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
      task: "Task N. Go-Around/Rejected Landing",
      coverageLabel: "PA.IV.N",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IV.N.K1": "A stabilized approach, including energy management concepts.",
      "PA.IV.N.K2": "Effects of atmospheric conditions, including wind and density altitude, on a go-around or rejected landing.",
      "PA.IV.N.K3": "Wind correction techniques on takeoff/departure and approach/landing.",
      "PA.IV.N.R1": "Delayed recognition of the need for a go-around/rejected landing.",
      "PA.IV.N.R2": "Delayed performance of a go-around at low altitude.",
      "PA.IV.N.R3": "Power application.",
      "PA.IV.N.R4": "Configuring the airplane.",
      "PA.IV.N.R5": "Collision hazards.",
      "PA.IV.N.R6": "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IV.N.R7": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IV.N.R8": "Runway incursion.",
      "PA.IV.N.R9": "Managing a go-around/rejected landing after accepting a LAHSO clearance.",
      "PA.IV.N.S1": "Complete the appropriate checklist(s).",
      "PA.IV.N.S2": "Make radio calls as appropriate.",
      "PA.IV.N.S3": "Make a timely decision to discontinue the approach to landing.",
      "PA.IV.N.S4": "Apply takeoff power immediately and transition to climb pitch attitude for VX or VY as appropriate +10/-5 knots.",
      "PA.IV.N.S5": "Configure the airplane after a positive rate of climb has been verified or in accordance with airplane manufacturer’s instructions.",
      "PA.IV.N.S6": "Maneuver to the side of the runway/landing area when necessary to clear and avoid conflicting traffic.",
      "PA.IV.N.S7": "Maintain VY +10/-5 knots to a safe maneuvering altitude.",
      "PA.IV.N.S8": "Maintain directional control and proper wind-drift correction throughout the climb.",
      "PA.IV.N.S9": "Use runway incursion avoidance procedures, if applicable.",
    };

    expect(CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_N_CODES).toHaveLength(21);
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_N_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves each code in the slice case-insensitively and returns current metadata", () => {
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_N_CODES) {
      const lowerResolution = resolveCurrentAreaIVTaskNAktrCode(entry.code.toLowerCase());
      expect(lowerResolution.status).toBe("current");
      if (lowerResolution.status === "current") {
        expect(lowerResolution.entry).toBe(entry);
      }

      const exactResolution = resolveCurrentAreaIVTaskNAktrCode(entry.code);
      expect(exactResolution.status).toBe("current");
      if (exactResolution.status === "current") {
        expect(exactResolution.entry).toBe(entry);
      }
    }
  });

  it("returns unresolved for codes outside the PA.IV.N slice", () => {
    const outOfSliceCodes = [
      "PA.IV.M.S9",
      "PA.IV.N.K0",
      "PA.IV.N.K4",
      "PA.IV.N.R0",
      "PA.IV.N.R10",
      "PA.IV.N.S0",
      "PA.IV.N.S10",
      "PA.V.A.K1",
      "PA.I.A.K1",
      "",
      "UNKNOWN",
      "PLT044",
    ];

    for (const code of outOfSliceCodes) {
      const resolution = resolveCurrentAreaIVTaskNAktrCode(code);
      expect(resolution).toEqual({
        status: "unresolved",
        code: code.toUpperCase(),
      });
    }
  });
});
