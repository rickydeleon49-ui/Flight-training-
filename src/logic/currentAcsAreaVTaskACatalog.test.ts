import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_A_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_V_TASK_A_SOURCE,
  resolveCurrentAreaVTaskAAktrCode,
} from "./currentAcsAreaVTaskACatalog";

describe("Private Pilot Airplane ACS 6C Area V Task A (PA.V.A) catalog slice", () => {
  const expectedCodes = [
    "PA.V.A.K1",
    "PA.V.A.K2",
    "PA.V.A.K2a",
    "PA.V.A.K2b",
    "PA.V.A.K2c",
    "PA.V.A.K2d",
    "PA.V.A.K2e",
    "PA.V.A.R1",
    "PA.V.A.R2",
    "PA.V.A.R3",
    "PA.V.A.R4",
    "PA.V.A.R5",
    "PA.V.A.S1",
    "PA.V.A.S2",
    "PA.V.A.S3",
    "PA.V.A.S4",
    "PA.V.A.S5",
  ] as const;

  it("contains exactly the 17 verified Area V Task A codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_A_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(17);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_A_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("V");
      expect(entry.task).toBe("A");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_V_TASK_A_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.V.A coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_V_TASK_A_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "36",
      pdfPages: "44",
      areaOfOperation: "Area of Operation V: Performance Maneuvers and Ground Reference Maneuvers",
      task: "Task A. Steep Turns",
      coverageLabel: "PA.V.A",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.V.A.K1": "How to conduct a proper steep turn.",
      "PA.V.A.K2": "Aerodynamics associated with steep turns, including:",
      "PA.V.A.K2a": "Maintaining coordinated flight",
      "PA.V.A.K2b": "Overbanking tendencies",
      "PA.V.A.K2c": "Maneuvering speed, including the impact of weight changes",
      "PA.V.A.K2d": "Load factor and accelerated stalls",
      "PA.V.A.K2e": "Rate and radius of turn",
      "PA.V.A.R1": "Division of attention between aircraft control and orientation.",
      "PA.V.A.R2": "Collision hazards.",
      "PA.V.A.R3": "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.V.A.R4": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.V.A.R5": "Uncoordinated flight.",
      "PA.V.A.S1": "Clear the area.",
      "PA.V.A.S2": "Establish the manufacturer's recommended airspeed; or if one is not available, an airspeed not to exceed the maneuvering speed (VA).",
      "PA.V.A.S3": "Roll into a coordinated 360° steep turn with approximately a 45° bank.",
      "PA.V.A.S4": "Perform the Task in the opposite direction, as specified by evaluator.",
      "PA.V.A.S5": "Maintain the entry altitude ±100 feet, airspeed ±10 knots, bank ±5°, and roll out on the entry heading ±10°.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_A_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area V Task A code with case-insensitive ASCII matching, including child codes", () => {
    const resK1 = resolveCurrentAreaVTaskAAktrCode("pa.v.a.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.V.A.K1",
        description: "How to conduct a proper steep turn.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "V",
        task: "A",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_V_TASK_A_SOURCE,
      },
    });

    const resK2 = resolveCurrentAreaVTaskAAktrCode("pa.v.a.k2");
    expect(resK2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.V.A.K2",
        description: "Aerodynamics associated with steep turns, including:",
      },
    });

    const resK2a = resolveCurrentAreaVTaskAAktrCode("pa.v.a.k2a");
    expect(resK2a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.V.A.K2a",
        description: "Maintaining coordinated flight",
      },
    });

    const resK2e = resolveCurrentAreaVTaskAAktrCode("PA.V.A.K2E");
    expect(resK2e).toMatchObject({
      status: "current",
      entry: {
        code: "PA.V.A.K2e",
        description: "Rate and radius of turn",
      },
    });

    const resR1 = resolveCurrentAreaVTaskAAktrCode("pa.v.a.r1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.V.A.R1",
        description: "Division of attention between aircraft control and orientation.",
      },
    });

    const resS3 = resolveCurrentAreaVTaskAAktrCode("PA.V.A.S3");
    expect(resS3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.V.A.S3",
        description: "Roll into a coordinated 360° steep turn with approximately a 45° bank.",
      },
    });

    const resS5 = resolveCurrentAreaVTaskAAktrCode("pa.v.a.s5");
    expect(resS5).toMatchObject({
      status: "current",
      entry: {
        code: "PA.V.A.S5",
        description: "Maintain the entry altitude ±100 feet, airspeed ±10 knots, bank ±5°, and roll out on the entry heading ±10°.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Representative current code outside this slice: Area V Task B
    expect(resolveCurrentAreaVTaskAAktrCode("PA.V.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.V.B.K1",
    });

    // Representative current code outside this slice: Area IV Task A
    expect(resolveCurrentAreaVTaskAAktrCode("PA.IV.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.A.K1",
    });

    // Representative current code outside this slice: Area I Task A
    expect(resolveCurrentAreaVTaskAAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });

    // Nonexistent Area V Task A code
    expect(resolveCurrentAreaVTaskAAktrCode("PA.V.A.S6")).toEqual({
      status: "unresolved",
      code: "PA.V.A.S6",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaVTaskAAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaVTaskAAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
