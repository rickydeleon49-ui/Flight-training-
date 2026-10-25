import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_M_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_M_SOURCE,
  resolveCurrentAreaIVTaskMAktrCode,
} from "./currentAcsAreaIVTaskMCatalog";

describe("Private Pilot Airplane ACS 6C Area IV Task M (PA.IV.M) catalog slice", () => {
  const expectedCodes = [
    "PA.IV.M.K1",
    "PA.IV.M.K2",
    "PA.IV.M.K3",
    "PA.IV.M.K4",
    "PA.IV.M.R1",
    "PA.IV.M.R2",
    "PA.IV.M.R2a",
    "PA.IV.M.R2b",
    "PA.IV.M.R2c",
    "PA.IV.M.R2d",
    "PA.IV.M.R2e",
    "PA.IV.M.R3",
    "PA.IV.M.R3a",
    "PA.IV.M.R3b",
    "PA.IV.M.R4",
    "PA.IV.M.R5",
    "PA.IV.M.R6",
    "PA.IV.M.R7",
    "PA.IV.M.R8",
    "PA.IV.M.R9",
    "PA.IV.M.S1",
    "PA.IV.M.S2",
    "PA.IV.M.S3",
    "PA.IV.M.S4",
    "PA.IV.M.S5",
    "PA.IV.M.S6",
    "PA.IV.M.S7",
    "PA.IV.M.S8",
    "PA.IV.M.S9",
  ] as const;

  it("contains exactly the 29 verified Area IV Task M codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_M_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(29);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_M_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IV");
      expect(entry.task).toBe("M");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_M_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IV.M coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_M_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "33–34",
      pdfPages: "41–42",
      areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
      task: "Task M. Forward Slip to a Landing (ASEL, ASES)",
      coverageLabel: "PA.IV.M",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IV.M.K1": "Concepts of energy management during a forward slip approach.",
      "PA.IV.M.K2": "Effects of atmospheric conditions, including wind, on approach and landing performance.",
      "PA.IV.M.K3": "Wind correction techniques during forward slip.",
      "PA.IV.M.K4": "When and why a forward slip approach is used during an approach.",
      "PA.IV.M.R1": "Selection of runway/landing surface, approach path, and touchdown area based on pilot capability, aircraft performance and limitations, available distance, and wind.",
      "PA.IV.M.R2": "Effects of:",
      "PA.IV.M.R2a": "Crosswind",
      "PA.IV.M.R2b": "Windshear",
      "PA.IV.M.R2c": "Tailwind",
      "PA.IV.M.R2d": "Wake turbulence",
      "PA.IV.M.R2e": "Landing surface/condition",
      "PA.IV.M.R3": "Planning for:",
      "PA.IV.M.R3a": "Rejected landing and go-around",
      "PA.IV.M.R3b": "Land and hold short operations (LAHSO)",
      "PA.IV.M.R4": "Collision hazards.",
      "PA.IV.M.R5": "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IV.M.R6": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IV.M.R7": "Forward slip operations, including fuel flowage, tail stalls with flaps, and airspeed control.",
      "PA.IV.M.R8": "Surface contact with the airplane’s longitudinal axis misaligned.",
      "PA.IV.M.R9": "Unstable approach.",
      "PA.IV.M.S1": "Complete the appropriate checklist(s).",
      "PA.IV.M.S2": "Make radio calls as appropriate.",
      "PA.IV.M.S3": "Plan and follow a flightpath to the selected landing area considering altitude, wind, terrain, and obstructions.",
      "PA.IV.M.S4": "Select the most suitable touchdown point based on wind, landing surface, obstructions, and airplane limitations.",
      "PA.IV.M.S5": "Position airplane on downwind leg, parallel to landing runway or selected landing surface.",
      "PA.IV.M.S6": "Configure the airplane correctly.",
      "PA.IV.M.S7": "As necessary, correlate crosswind with direction of forward slip and transition to side slip before touchdown.",
      "PA.IV.M.S8": "Touch down at a proper pitch attitude, within 400 feet beyond or on the specified point, with no side drift, and with the airplane’s longitudinal axis aligned with and over the runway center/landing path.",
      "PA.IV.M.S9": "Maintain a ground track aligned with the runway center/landing path.",
    };

    expect(CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_M_CODES).toHaveLength(29);
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_M_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves each code in the slice case-insensitively and returns current metadata", () => {
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_M_CODES) {
      const lowerResolution = resolveCurrentAreaIVTaskMAktrCode(entry.code.toLowerCase());
      expect(lowerResolution.status).toBe("current");
      if (lowerResolution.status === "current") {
        expect(lowerResolution.entry).toBe(entry);
      }

      const exactResolution = resolveCurrentAreaIVTaskMAktrCode(entry.code);
      expect(exactResolution.status).toBe("current");
      if (exactResolution.status === "current") {
        expect(exactResolution.entry).toBe(entry);
      }
    }
  });

  it("returns unresolved for codes outside the PA.IV.M slice", () => {
    const outOfSliceCodes = [
      "PA.IV.L.S10",
      "PA.IV.M.K5",
      "PA.IV.M.R10",
      "PA.IV.M.R2f",
      "PA.IV.M.R3c",
      "PA.IV.M.S0",
      "PA.IV.M.S10",
      "PA.IV.N.K1",
      "PA.I.A.K1",
      "",
      "UNKNOWN",
      "PLT044",
    ];

    for (const code of outOfSliceCodes) {
      const resolution = resolveCurrentAreaIVTaskMAktrCode(code);
      expect(resolution).toEqual({
        status: "unresolved",
        code: code.toUpperCase(),
      });
    }
  });
});
