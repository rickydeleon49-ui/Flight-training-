import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_TASK_D_CODES,
  PRIVATE_AIRPLANE_ACS_6C_TASK_D_SOURCE,
  resolveCurrentTaskDAktrCode,
} from "./currentAcsTaskDCatalog";

describe("Private Pilot Airplane ACS 6C Task D (PA.I.D) catalog slice", () => {
  const expectedCodes = [
    "PA.I.D.K1",
    "PA.I.D.K1a",
    "PA.I.D.K2",
    "PA.I.D.K3",
    "PA.I.D.K3a",
    "PA.I.D.K3b",
    "PA.I.D.K3c",
    "PA.I.D.K4",
    "PA.I.D.K5",
    "PA.I.D.K6",
    "PA.I.D.R1",
    "PA.I.D.R2",
    "PA.I.D.R3",
    "PA.I.D.R4",
    "PA.I.D.R5",
    "PA.I.D.R6",
    "PA.I.D.R7",
    "PA.I.D.S1",
    "PA.I.D.S2",
    "PA.I.D.S3",
    "PA.I.D.S4",
    "PA.I.D.S5",
  ] as const;

  it("contains exactly the 22 verified Task D codes once each with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_TASK_D_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(22);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_D_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("I");
      expect(entry.task).toBe("D");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_TASK_D_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.I.D coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_TASK_D_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "5",
      pdfPages: "13",
      areaOfOperation: "Area of Operation I: Preflight Preparation",
      task: "Task D. Cross-Country Flight Planning",
      coverageLabel: "PA.I.D",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.I.D.K1": "Route planning, including consideration of different classes and special use airspace (SUA) and selection of appropriate and available navigation/communication systems and facilities.",
      "PA.I.D.K1a": "Use of an electronic flight bag (EFB), if used",
      "PA.I.D.K2": "Altitude selection accounting for terrain and obstacles, glide distance of airplane, VFR cruising altitudes, and effect of wind.",
      "PA.I.D.K3": "Calculating:",
      "PA.I.D.K3a": "Time, climb and descent rates, course, distance, heading, true airspeed, and groundspeed",
      "PA.I.D.K3b": "Estimated time of arrival, including conversion to universal coordinated time (UTC)",
      "PA.I.D.K3c": "Fuel requirements, including reserve",
      "PA.I.D.K4": "Elements of a VFR flight plan.",
      "PA.I.D.K5": "Procedures for filing, activating, and closing a VFR flight plan.",
      "PA.I.D.K6": "Inflight intercept procedures.",
      "PA.I.D.R1": "Pilot.",
      "PA.I.D.R2": "Aircraft.",
      "PA.I.D.R3": "Environment (e.g., weather, airports, airspace, terrain, obstacles).",
      "PA.I.D.R4": "External pressures.",
      "PA.I.D.R5": "Limitations of air traffic control (ATC) services.",
      "PA.I.D.R6": "Fuel planning.",
      "PA.I.D.R7": "Use of an electronic flight bag (EFB), if used.",
      "PA.I.D.S1": "Prepare, present, and explain a cross-country flight plan assigned by the evaluator, including a risk analysis based on real-time weather, to the first fuel stop.",
      "PA.I.D.S2": "Apply pertinent information from appropriate and current aeronautical charts, Chart Supplements; Notices to Air Missions (NOTAMs) relative to airport, runway and taxiway closures; and other flight publications.",
      "PA.I.D.S3": "Create a navigation plan and simulate filing a VFR flight plan.",
      "PA.I.D.S4": "Recalculate fuel reserves based on a scenario provided by the evaluator.",
      "PA.I.D.S5": "Use an electronic flight bag (EFB), if applicable.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_D_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Task D code with case-insensitive ASCII matching", () => {
    const res = resolveCurrentTaskDAktrCode("pa.i.d.k1");
    expect(res).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.D.K1",
        description: "Route planning, including consideration of different classes and special use airspace (SUA) and selection of appropriate and available navigation/communication systems and facilities.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        source: PRIVATE_AIRPLANE_ACS_6C_TASK_D_SOURCE,
      },
    });

    const resUpper = resolveCurrentTaskDAktrCode("PA.I.D.S5");
    expect(resUpper).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.D.S5",
        description: "Use an electronic flight bag (EFB), if applicable.",
      },
    });

    const resSub = resolveCurrentTaskDAktrCode("pa.i.d.k3a");
    expect(resSub).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.D.K3a",
        description: "Time, climb and descent rates, course, distance, heading, true airspeed, and groundspeed",
      },
    });
  });

  it("leaves out-of-slice current codes unresolved (including Task A, Task B, and Task C)", () => {
    // PA.I.A.K1 is Task A
    expect(resolveCurrentTaskDAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });

    // PA.I.B.K1 is Task B
    expect(resolveCurrentTaskDAktrCode("PA.I.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.B.K1",
    });

    // PA.I.C.K1 is Task C
    expect(resolveCurrentTaskDAktrCode("PA.I.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.C.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    // PA.III.A.R3 is an archived code in the archived catalog
    expect(resolveCurrentTaskDAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentTaskDAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentTaskDAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
