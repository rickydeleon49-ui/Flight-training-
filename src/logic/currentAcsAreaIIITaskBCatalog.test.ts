import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_B_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_III_TASK_B_SOURCE,
  resolveCurrentAreaIIITaskBAktrCode,
} from "./currentAcsAreaIIITaskBCatalog";

describe("Private Pilot Airplane ACS 6C Area III Task B (PA.III.B) catalog slice", () => {
  const expectedCodes = [
    "PA.III.B.K1",
    "PA.III.B.K2",
    "PA.III.B.K3",
    "PA.III.B.K4",
    "PA.III.B.R1",
    "PA.III.B.R2",
    "PA.III.B.R3",
    "PA.III.B.S1",
    "PA.III.B.S2",
    "PA.III.B.S3",
    "PA.III.B.S4",
    "PA.III.B.S5",
    "PA.III.B.S6",
  ] as const;

  it("contains exactly the 13 verified Area III Task B codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_B_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(13);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_B_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("III");
      expect(entry.task).toBe("B");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_III_TASK_B_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.III.B coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_III_TASK_B_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "16–17",
      pdfPages: "24–25",
      areaOfOperation: "Area of Operation III: Airport and Seaplane Base Operations",
      task: "Task B. Traffic Patterns",
      coverageLabel: "PA.III.B",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.III.B.K1": "Towered and nontowered airport operations.",
      "PA.III.B.K2": "Traffic pattern selection for the current conditions.",
      "PA.III.B.K3": "Right-of-way rules.",
      "PA.III.B.K4": "Use of automated weather and airport information.",
      "PA.III.B.R1": "Collision hazards.",
      "PA.III.B.R2":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.III.B.R3": "Windshear and wake turbulence.",
      "PA.III.B.S1":
        "Identify and interpret airport/seaplane base runways, taxiways, markings, signs, and lighting.",
      "PA.III.B.S2": "Comply with recommended traffic pattern procedures.",
      "PA.III.B.S3": "Correct for wind drift to maintain the proper ground track.",
      "PA.III.B.S4": "Maintain orientation with the runway/landing area in use.",
      "PA.III.B.S5":
        "Maintain traffic pattern altitude, ±100 feet, and the appropriate airspeed, ±10 knots.",
      "PA.III.B.S6":
        "Maintain situational awareness and proper spacing from other aircraft in the traffic pattern.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_B_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area III Task B code with case-insensitive ASCII matching", () => {
    const resK1 = resolveCurrentAreaIIITaskBAktrCode("pa.iii.b.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.III.B.K1",
        description: "Towered and nontowered airport operations.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "III",
        task: "B",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_III_TASK_B_SOURCE,
      },
    });

    const resK4 = resolveCurrentAreaIIITaskBAktrCode("pa.iii.b.k4");
    expect(resK4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.III.B.K4",
        description: "Use of automated weather and airport information.",
      },
    });

    const resR1 = resolveCurrentAreaIIITaskBAktrCode("PA.III.B.R1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.III.B.R1",
        description: "Collision hazards.",
      },
    });

    const resR2 = resolveCurrentAreaIIITaskBAktrCode("pa.iii.b.r2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.III.B.R2",
        description:
          "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      },
    });

    const resR3 = resolveCurrentAreaIIITaskBAktrCode("pa.iii.b.r3");
    expect(resR3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.III.B.R3",
        description: "Windshear and wake turbulence.",
      },
    });

    const resS1 = resolveCurrentAreaIIITaskBAktrCode("pa.iii.b.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.III.B.S1",
        description:
          "Identify and interpret airport/seaplane base runways, taxiways, markings, signs, and lighting.",
      },
    });

    const resS6 = resolveCurrentAreaIIITaskBAktrCode("PA.III.B.S6");
    expect(resS6).toMatchObject({
      status: "current",
      entry: {
        code: "PA.III.B.S6",
        description:
          "Maintain situational awareness and proper spacing from other aircraft in the traffic pattern.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Representative current code outside this slice: Task A
    expect(resolveCurrentAreaIIITaskBAktrCode("PA.III.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.III.A.K1",
    });

    // Representative current code outside this slice: Area II Task F
    expect(resolveCurrentAreaIIITaskBAktrCode("PA.II.F.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.F.K1",
    });

    // Representative current code outside this slice: Area I Task A
    expect(resolveCurrentAreaIIITaskBAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIIITaskBAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIIITaskBAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
