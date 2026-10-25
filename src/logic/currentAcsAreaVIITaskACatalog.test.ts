import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_A_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_A_SOURCE,
  resolveCurrentAreaVIITaskAAktrCode,
} from "./currentAcsAreaVIITaskACatalog";

describe("Private Pilot Airplane ACS 6C Area VII Task A (PA.VII.A) catalog slice", () => {
  const expectedCodes = [
    "PA.VII.A.K1",
    "PA.VII.A.R1",
    "PA.VII.A.R2",
    "PA.VII.A.R3",
    "PA.VII.A.R4",
    "PA.VII.A.R5",
    "PA.VII.A.R6",
    "PA.VII.A.S1",
    "PA.VII.A.S2",
    "PA.VII.A.S3",
    "PA.VII.A.S4",
    "PA.VII.A.S5",
  ] as const;

  const expectedDescriptions: Record<(typeof expectedCodes)[number], string> = {
    "PA.VII.A.K1":
      "Aerodynamics associated with slow flight in various airplane configurations, including the relationship between angle of attack, airspeed, load factor, power setting, airplane weight and center of gravity, airplane attitude, and yaw effects.",
    "PA.VII.A.R1":
      "Inadvertent slow flight and flight with a stall warning, which could lead to loss of control.",
    "PA.VII.A.R2":
      "Range and limitations of stall warning indicators (e.g., aircraft buffet, stall horn, etc.).",
    "PA.VII.A.R3": "Uncoordinated flight.",
    "PA.VII.A.R4":
      "Effect of environmental elements on airplane performance (e.g., turbulence, microbursts, and high-density altitude).",
    "PA.VII.A.R5": "Collision hazards.",
    "PA.VII.A.R6":
      "Distractions, task prioritization, loss of situational awareness, or disorientation.",
    "PA.VII.A.S1": "Clear the area.",
    "PA.VII.A.S2":
      "Select an entry altitude that allows the Task to be completed no lower than 1,500 feet above ground level (AGL) (ASEL, ASES) or 3,000 feet AGL (AMEL, AMES).",
    "PA.VII.A.S3":
      "Establish and maintain an airspeed at which any further increase in angle of attack, increase in load factor, or reduction in power, would result in a stall warning (e.g., aircraft buffet, stall horn, etc.).",
    "PA.VII.A.S4":
      "Accomplish coordinated straight-and-level flight, turns, climbs, and descents with the aircraft configured as specified by the evaluator without a stall warning (e.g., aircraft buffet, stall horn, etc.).",
    "PA.VII.A.S5":
      "Maintain the specified altitude, ±100 feet; specified heading, ±10°; airspeed, +10/-0 knots; and specified angle of bank, ±10°.",
  };

  it("contains exactly the 12 verified Area VII Task A codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_A_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(12);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_A_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("VII");
      expect(entry.task).toBe("A");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_A_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.VII.A coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_A_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "42–43",
      pdfPages: "50–51",
      areaOfOperation: "Area of Operation VII: Slow Flight and Stalls",
      task: "Task A. Maneuvering During Slow Flight",
      coverageLabel: "PA.VII.A",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("preserves exact descriptions for every code in the slice", () => {
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_A_CODES) {
      expect(entry.description).toBe(
        expectedDescriptions[entry.code as (typeof expectedCodes)[number]],
      );
    }
  });

  it("resolves codes with ASCII case-insensitivity for K, R, and S codes", () => {
    const k1 = resolveCurrentAreaVIITaskAAktrCode("pa.vii.a.k1");
    expect(k1).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.A.K1",
        description:
          "Aerodynamics associated with slow flight in various airplane configurations, including the relationship between angle of attack, airspeed, load factor, power setting, airplane weight and center of gravity, airplane attitude, and yaw effects.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "A",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_A_SOURCE,
      },
    });

    const r1 = resolveCurrentAreaVIITaskAAktrCode("pa.vii.a.r1");
    expect(r1).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.A.R1",
        description:
          "Inadvertent slow flight and flight with a stall warning, which could lead to loss of control.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "A",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_A_SOURCE,
      },
    });

    const r3 = resolveCurrentAreaVIITaskAAktrCode("PA.VII.A.R3");
    expect(r3.status).toBe("current");

    const r6 = resolveCurrentAreaVIITaskAAktrCode("pa.vii.a.r6");
    expect(r6).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.A.R6",
        description:
          "Distractions, task prioritization, loss of situational awareness, or disorientation.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "A",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_A_SOURCE,
      },
    });

    const s1 = resolveCurrentAreaVIITaskAAktrCode("pa.vii.a.s1");
    expect(s1).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.A.S1",
        description: "Clear the area.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "A",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_A_SOURCE,
      },
    });

    const s5 = resolveCurrentAreaVIITaskAAktrCode("PA.VII.A.S5");
    expect(s5).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.A.S5",
        description:
          "Maintain the specified altitude, ±100 feet; specified heading, ±10°; airspeed, +10/-0 knots; and specified angle of bank, ±10°.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "A",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_A_SOURCE,
      },
    });

    const mixedCase = resolveCurrentAreaVIITaskAAktrCode("Pa.ViI.a.S2");
    expect(mixedCase.status).toBe("current");
  });

  it("leaves out-of-slice codes and invalid tokens unresolved", () => {
    expect(resolveCurrentAreaVIITaskAAktrCode("PA.VII.A.K2")).toEqual({
      status: "unresolved",
      code: "PA.VII.A.K2",
    });
    expect(resolveCurrentAreaVIITaskAAktrCode("PA.VII.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.VII.B.K1",
    });
    expect(resolveCurrentAreaVIITaskAAktrCode("PA.VII.A.R7")).toEqual({
      status: "unresolved",
      code: "PA.VII.A.R7",
    });
    expect(resolveCurrentAreaVIITaskAAktrCode("PA.VII.A.S6")).toEqual({
      status: "unresolved",
      code: "PA.VII.A.S6",
    });
    expect(resolveCurrentAreaVIITaskAAktrCode("PA.VI.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.VI.D.K1",
    });
    expect(resolveCurrentAreaVIITaskAAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaVIITaskAAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
