import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_L_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_L_SOURCE,
  resolveCurrentAreaIVTaskLAktrCode,
} from "./currentAcsAreaIVTaskLCatalog";

describe("Private Pilot Airplane ACS 6C Area IV Task L (PA.IV.L) catalog slice", () => {
  const expectedCodes = [
    "PA.IV.L.K1",
    "PA.IV.L.K2",
    "PA.IV.L.K3",
    "PA.IV.L.K4",
    "PA.IV.L.K5",
    "PA.IV.L.R1",
    "PA.IV.L.R2",
    "PA.IV.L.R2a",
    "PA.IV.L.R2b",
    "PA.IV.L.R2c",
    "PA.IV.L.R2d",
    "PA.IV.L.R2e",
    "PA.IV.L.R3",
    "PA.IV.L.R4",
    "PA.IV.L.R5",
    "PA.IV.L.R6",
    "PA.IV.L.R7",
    "PA.IV.L.S1",
    "PA.IV.L.S2",
    "PA.IV.L.S3",
    "PA.IV.L.S4",
    "PA.IV.L.S5",
    "PA.IV.L.S6",
    "PA.IV.L.S7",
    "PA.IV.L.S8",
    "PA.IV.L.S9",
    "PA.IV.L.S10",
  ] as const;

  it("contains exactly the 27 verified Area IV Task L codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_L_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(27);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_L_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IV");
      expect(entry.task).toBe("L");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_L_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IV.L coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_L_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "32–33",
      pdfPages: "40–41",
      areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
      task: "Task L. Rough Water Approach and Landing (ASES, AMES)",
      coverageLabel: "PA.IV.L",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IV.L.K1": "A stabilized approach, including energy management concepts.",
      "PA.IV.L.K2": "Effects of atmospheric conditions, including wind, on approach and landing performance.",
      "PA.IV.L.K3": "Wind correction techniques on approach and landing.",
      "PA.IV.L.K4": "When and why rough water techniques are used.",
      "PA.IV.L.K5": "How to perform a proper rough water approach and landing.",
      "PA.IV.L.R1": "Selection of approach path and touchdown area based on pilot capability, airplane performance and limitations, available distance, and wind.",
      "PA.IV.L.R2": "Effects of:",
      "PA.IV.L.R2a": "Crosswind",
      "PA.IV.L.R2b": "Windshear",
      "PA.IV.L.R2c": "Tailwind",
      "PA.IV.L.R2d": "Wake turbulence",
      "PA.IV.L.R2e": "Water surface/condition",
      "PA.IV.L.R3": "Planning for a go-around and rejected landing.",
      "PA.IV.L.R4": "Collision hazards.",
      "PA.IV.L.R5": "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IV.L.R6": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IV.L.R7": "Gear position in an amphibious airplane.",
      "PA.IV.L.S1": "Complete the appropriate checklist(s).",
      "PA.IV.L.S2": "Make radio calls as appropriate.",
      "PA.IV.L.S3": "Ensure the airplane is aligned with the correct/assigned waterway.",
      "PA.IV.L.S4": "Scan the landing area for traffic and obstructions.",
      "PA.IV.L.S5": "Select and aim for a suitable touchdown point considering the wind conditions, landing surface, and obstructions.",
      "PA.IV.L.S6": "Establish the recommended approach and landing configuration, airspeed, and trim, and adjust pitch attitude and power as required to maintain a stabilized approach.",
      "PA.IV.L.S7": "Maintain manufacturer’s published approach airspeed or in its absence not more than 1.3 VSO, +10/-5 knots with gust factor applied.",
      "PA.IV.L.S8": "Maintain directional control and appropriate crosswind correction throughout the approach and landing.",
      "PA.IV.L.S9": "Make smooth, timely, and correct power and control adjustments to maintain proper pitch attitude and rate of descent to touchdown.",
      "PA.IV.L.S10": "Contact the water in a proper pitch attitude, considering the type of rough water.",
    };

    expect(CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_L_CODES).toHaveLength(27);
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_L_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves each code in the slice case-insensitively and returns current metadata", () => {
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_L_CODES) {
      const lowerResolution = resolveCurrentAreaIVTaskLAktrCode(entry.code.toLowerCase());
      expect(lowerResolution.status).toBe("current");
      if (lowerResolution.status === "current") {
        expect(lowerResolution.entry).toBe(entry);
      }

      const exactResolution = resolveCurrentAreaIVTaskLAktrCode(entry.code);
      expect(exactResolution.status).toBe("current");
      if (exactResolution.status === "current") {
        expect(exactResolution.entry).toBe(entry);
      }
    }
  });

  it("returns unresolved for codes outside the PA.IV.L slice", () => {
    const outOfSliceCodes = [
      "PA.IV.K.S13",
      "PA.IV.L.K6",
      "PA.IV.L.R8",
      "PA.IV.L.R2f",
      "PA.IV.L.S0",
      "PA.IV.L.S11",
      "PA.IV.M.K1",
      "PA.I.A.K1",
      "",
      "UNKNOWN",
      "PLT044",
    ];

    for (const code of outOfSliceCodes) {
      const resolution = resolveCurrentAreaIVTaskLAktrCode(code);
      expect(resolution).toEqual({
        status: "unresolved",
        code: code.toUpperCase(),
      });
    }
  });
});
