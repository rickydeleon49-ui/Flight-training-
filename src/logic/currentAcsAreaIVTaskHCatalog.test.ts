import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_H_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_H_SOURCE,
  resolveCurrentAreaIVTaskHAktrCode,
} from "./currentAcsAreaIVTaskHCatalog";

describe("Private Pilot Airplane ACS 6C Area IV Task H (PA.IV.H) catalog slice", () => {
  const expectedCodes = [
    "PA.IV.H.K1",
    "PA.IV.H.K2",
    "PA.IV.H.K3",
    "PA.IV.H.R1",
    "PA.IV.H.R2",
    "PA.IV.H.R2a",
    "PA.IV.H.R2b",
    "PA.IV.H.R2c",
    "PA.IV.H.R2d",
    "PA.IV.H.R2e",
    "PA.IV.H.R3",
    "PA.IV.H.R4",
    "PA.IV.H.R5",
    "PA.IV.H.R6",
    "PA.IV.H.S1",
    "PA.IV.H.S2",
    "PA.IV.H.S3",
    "PA.IV.H.S4",
    "PA.IV.H.S5",
    "PA.IV.H.S6",
    "PA.IV.H.S7",
    "PA.IV.H.S8",
    "PA.IV.H.S9",
    "PA.IV.H.S10",
    "PA.IV.H.S11",
    "PA.IV.H.S12",
    "PA.IV.H.S13",
  ] as const;

  it("contains exactly the 27 verified Area IV Task H codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_H_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(27);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_H_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IV");
      expect(entry.task).toBe("H");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_H_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IV.H coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_H_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "27–28",
      pdfPages: "35–36",
      areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
      task: "Task H. Confined Area Approach and Landing (ASES, AMES)",
      coverageLabel: "PA.IV.H",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IV.H.K1": "A stabilized approach, including energy management concepts.",
      "PA.IV.H.K2": "Effects of atmospheric conditions, including wind, on approach and landing performance.",
      "PA.IV.H.K3": "Wind correction techniques on approach and landing.",
      "PA.IV.H.R1": "Selection of approach path and touchdown area based on pilot capability, airplane performance and limitations, available distance, and wind.",
      "PA.IV.H.R2": "Effects of:",
      "PA.IV.H.R2a": "Crosswind",
      "PA.IV.H.R2b": "Windshear",
      "PA.IV.H.R2c": "Tailwind",
      "PA.IV.H.R2d": "Wake turbulence",
      "PA.IV.H.R2e": "Water surface/condition",
      "PA.IV.H.R3": "Planning for a go-around and rejected landing.",
      "PA.IV.H.R4": "Collision hazards.",
      "PA.IV.H.R5": "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IV.H.R6": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IV.H.S1": "Complete the appropriate checklist(s).",
      "PA.IV.H.S2": "Make radio calls as appropriate.",
      "PA.IV.H.S3": "Ensure the airplane is aligned for an approach to the correct/assigned landing surface.",
      "PA.IV.H.S4": "Scan the landing area for traffic and obstructions.",
      "PA.IV.H.S5": "Select and aim for a suitable touchdown point considering the wind conditions, landing surface, and obstructions.",
      "PA.IV.H.S6": "Establish the recommended approach and landing configuration, airspeed, and trim, and adjust pitch attitude and power as required to maintain a stabilized approach.",
      "PA.IV.H.S7": "Maintain manufacturer’s published approach airspeed or in its absence not more than 1.3 VSO, +10/-5 knots with gust factor applied.",
      "PA.IV.H.S8": "Maintain directional control and appropriate crosswind correction throughout the approach and landing.",
      "PA.IV.H.S9": "Make smooth, timely, and correct control application before, during, and after touchdown.",
      "PA.IV.H.S10": "Contact the water at the recommended airspeed with a proper pitch attitude for the surface conditions.",
      "PA.IV.H.S11": "Touch down at a proper pitch attitude, within 200 feet beyond or on the specified point, with no side drift, minimum float, and with the airplane’s longitudinal axis aligned with the projected landing path.",
      "PA.IV.H.S12": "Execute a timely go-around if the approach cannot be made within the tolerances specified above or for any other condition that may result in an unsafe approach or landing.",
      "PA.IV.H.S13": "Apply elevator control as necessary to stop in the shortest distance consistent with safety.",
    };

    expect(CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_H_CODES).toHaveLength(27);
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_H_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves each code in the slice case-insensitively and returns current metadata", () => {
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_H_CODES) {
      const lowerResolution = resolveCurrentAreaIVTaskHAktrCode(entry.code.toLowerCase());
      expect(lowerResolution.status).toBe("current");
      if (lowerResolution.status === "current") {
        expect(lowerResolution.entry).toBe(entry);
      }

      const exactResolution = resolveCurrentAreaIVTaskHAktrCode(entry.code);
      expect(exactResolution.status).toBe("current");
      if (exactResolution.status === "current") {
        expect(exactResolution.entry).toBe(entry);
      }
    }
  });

  it("returns unresolved for codes outside the PA.IV.H slice", () => {
    const outOfSliceCodes = [
      "PA.IV.G.S16",
      "PA.IV.H.K4",
      "PA.IV.H.R2f",
      "PA.IV.H.R7",
      "PA.IV.H.S14",
      "PA.IV.I.K1",
      "PA.I.A.K1",
      "",
      "UNKNOWN",
    ];

    for (const code of outOfSliceCodes) {
      const resolution = resolveCurrentAreaIVTaskHAktrCode(code);
      expect(resolution).toEqual({
        status: "unresolved",
        code: code.toUpperCase(),
      });
    }
  });
});
