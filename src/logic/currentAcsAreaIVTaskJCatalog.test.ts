import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_J_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_J_SOURCE,
  resolveCurrentAreaIVTaskJAktrCode,
} from "./currentAcsAreaIVTaskJCatalog";

describe("Private Pilot Airplane ACS 6C Area IV Task J (PA.IV.J) catalog slice", () => {
  const expectedCodes = [
    "PA.IV.J.K1",
    "PA.IV.J.K2",
    "PA.IV.J.K3",
    "PA.IV.J.K4",
    "PA.IV.J.R1",
    "PA.IV.J.R2",
    "PA.IV.J.R3",
    "PA.IV.J.R4",
    "PA.IV.J.R5",
    "PA.IV.J.R6",
    "PA.IV.J.R7",
    "PA.IV.J.S1",
    "PA.IV.J.S2",
    "PA.IV.J.S3",
    "PA.IV.J.S4",
    "PA.IV.J.S5",
    "PA.IV.J.S6",
    "PA.IV.J.S7",
    "PA.IV.J.S8",
    "PA.IV.J.S9",
  ] as const;

  it("contains exactly the 20 verified Area IV Task J codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_J_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(20);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_J_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IV");
      expect(entry.task).toBe("J");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_J_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IV.J coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_J_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "30",
      pdfPages: "38",
      areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
      task: "Task J. Glassy Water Approach and Landing (ASES, AMES)",
      coverageLabel: "PA.IV.J",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IV.J.K1": "A stabilized approach, including energy management concepts.",
      "PA.IV.J.K2": "Effects of atmospheric conditions, including wind, on approach and landing performance.",
      "PA.IV.J.K3": "When and why glassy water techniques are used.",
      "PA.IV.J.K4": "How a glassy water approach and landing is executed.",
      "PA.IV.J.R1": "Selection of approach path and touchdown area based on pilot capability, airplane performance and limitations, and available distance.",
      "PA.IV.J.R2": "Water surface/condition.",
      "PA.IV.J.R3": "Planning for a go-around and rejected landing.",
      "PA.IV.J.R4": "Collision hazards.",
      "PA.IV.J.R5": "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IV.J.R6": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IV.J.R7": "Gear position in an amphibious airplane.",
      "PA.IV.J.S1": "Complete the appropriate checklist(s).",
      "PA.IV.J.S2": "Make radio calls as appropriate.",
      "PA.IV.J.S3": "Scan the landing area for traffic and obstructions.",
      "PA.IV.J.S4": "Select a proper approach and landing path considering the landing surface, visual attitude references, water depth, and collision hazards.",
      "PA.IV.J.S5": "Establish the recommended approach and landing configuration, airspeed, and trim, and adjust pitch attitude and power as required to maintain a stabilized approach.",
      "PA.IV.J.S6": "Maintain manufacturer’s published approach airspeed or in its absence not more than 1.3 VSO, +10/-5 knots.",
      "PA.IV.J.S7": "Make smooth, timely, and correct power and control adjustments to maintain proper pitch attitude and rate of descent to touchdown.",
      "PA.IV.J.S8": "Contact the water in a proper pitch attitude, and slow to idle taxi speed.",
      "PA.IV.J.S9": "Maintain directional control throughout the approach and landing.",
    };

    expect(CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_J_CODES).toHaveLength(20);
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_J_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves each code in the slice case-insensitively and returns current metadata", () => {
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_J_CODES) {
      const lowerResolution = resolveCurrentAreaIVTaskJAktrCode(entry.code.toLowerCase());
      expect(lowerResolution.status).toBe("current");
      if (lowerResolution.status === "current") {
        expect(lowerResolution.entry).toBe(entry);
      }

      const exactResolution = resolveCurrentAreaIVTaskJAktrCode(entry.code);
      expect(exactResolution.status).toBe("current");
      if (exactResolution.status === "current") {
        expect(exactResolution.entry).toBe(entry);
      }
    }
  });

  it("returns unresolved for codes outside the PA.IV.J slice", () => {
    const outOfSliceCodes = [
      "PA.IV.I.S12",
      "PA.IV.J.K5",
      "PA.IV.J.R8",
      "PA.IV.J.S10",
      "PA.IV.K.K1",
      "PA.I.A.K1",
      "",
      "UNKNOWN",
      "PLT044",
    ];

    for (const code of outOfSliceCodes) {
      const resolution = resolveCurrentAreaIVTaskJAktrCode(code);
      expect(resolution).toEqual({
        status: "unresolved",
        code: code.toUpperCase(),
      });
    }
  });
});
