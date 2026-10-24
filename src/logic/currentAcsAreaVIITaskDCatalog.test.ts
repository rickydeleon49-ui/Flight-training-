import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_D_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_D_SOURCE,
  resolveCurrentAreaVIITaskDAktrCode,
} from "./currentAcsAreaVIITaskDCatalog";

describe("Private Pilot Airplane ACS 6C Area VII Task D (PA.VII.D) catalog slice", () => {
  const expectedCodes = [
    "PA.VII.D.K1",
    "PA.VII.D.K2",
    "PA.VII.D.K3",
    "PA.VII.D.R1",
    "PA.VII.D.R2",
    "PA.VII.D.R3",
    "PA.VII.D.R4",
    "PA.VII.D.R5",
    "PA.VII.D.R6",
  ] as const;

  const expectedDescriptions: Record<(typeof expectedCodes)[number], string> = {
    "PA.VII.D.K1":
      "Aerodynamics associated with spins in various airplane configurations, including the relationship between angle of attack, airspeed, load factor, power setting, airplane weight and center of gravity, airplane attitude, and yaw effects.",
    "PA.VII.D.K2":
      "What causes a spin and how to identify the entry, incipient, and developed phases of a spin.",
    "PA.VII.D.K3": "Spin recovery procedure.",
    "PA.VII.D.R1":
      "Factors and situations that could lead to inadvertent spin and loss of control.",
    "PA.VII.D.R2":
      "Range and limitations of stall warning indicators (e.g., aircraft buffet, stall horn, etc.).",
    "PA.VII.D.R3": "Spin recovery procedure.",
    "PA.VII.D.R4":
      "Effect of environmental elements on airplane performance related to spins (e.g., turbulence, microbursts, and high-density altitude).",
    "PA.VII.D.R5": "Collision hazards.",
    "PA.VII.D.R6":
      "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  };

  it("contains exactly the 9 verified Area VII Task D codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_D_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(9);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_D_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("VII");
      expect(entry.task).toBe("D");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_D_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.VII.D coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_D_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "45–46",
      pdfPages: "53–54",
      areaOfOperation: "Area of Operation VII: Slow Flight and Stalls",
      task: "Task D. Spin Awareness",
      coverageLabel: "PA.VII.D",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("preserves exact descriptions for every code in the slice", () => {
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_D_CODES) {
      expect(entry.description).toBe(
        expectedDescriptions[entry.code as (typeof expectedCodes)[number]],
      );
    }
  });

  it("resolves codes with ASCII case-insensitivity for K and R codes", () => {
    const k1 = resolveCurrentAreaVIITaskDAktrCode("pa.vii.d.k1");
    expect(k1).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.D.K1",
        description:
          "Aerodynamics associated with spins in various airplane configurations, including the relationship between angle of attack, airspeed, load factor, power setting, airplane weight and center of gravity, airplane attitude, and yaw effects.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "D",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_D_SOURCE,
      },
    });

    const k2 = resolveCurrentAreaVIITaskDAktrCode("Pa.ViI.d.K2");
    expect(k2).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.D.K2",
        description:
          "What causes a spin and how to identify the entry, incipient, and developed phases of a spin.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "D",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_D_SOURCE,
      },
    });

    const k3 = resolveCurrentAreaVIITaskDAktrCode("pa.vii.d.k3");
    expect(k3).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.D.K3",
        description: "Spin recovery procedure.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "D",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_D_SOURCE,
      },
    });

    const r1 = resolveCurrentAreaVIITaskDAktrCode("pa.vii.d.r1");
    expect(r1).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.D.R1",
        description:
          "Factors and situations that could lead to inadvertent spin and loss of control.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "D",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_D_SOURCE,
      },
    });

    const r3 = resolveCurrentAreaVIITaskDAktrCode("PA.VII.D.R3");
    expect(r3).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.D.R3",
        description: "Spin recovery procedure.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "D",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_D_SOURCE,
      },
    });

    const r6 = resolveCurrentAreaVIITaskDAktrCode("pa.vii.d.r6");
    expect(r6).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.D.R6",
        description:
          "Distractions, task prioritization, loss of situational awareness, or disorientation.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "D",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_D_SOURCE,
      },
    });

    const mixedCase = resolveCurrentAreaVIITaskDAktrCode("Pa.ViI.d.R4");
    expect(mixedCase.status).toBe("current");
  });

  it("leaves out-of-slice codes, sample skills, and invalid tokens unresolved", () => {
    // Skills are intentionally left blank in FAA-S-ACS-6C for Task D: any sample PA.VII.D.S1 must be unresolved
    expect(resolveCurrentAreaVIITaskDAktrCode("PA.VII.D.S1")).toEqual({
      status: "unresolved",
      code: "PA.VII.D.S1",
    });
    expect(resolveCurrentAreaVIITaskDAktrCode("pa.vii.d.s1")).toEqual({
      status: "unresolved",
      code: "PA.VII.D.S1",
    });

    // Knowledge out of range
    expect(resolveCurrentAreaVIITaskDAktrCode("PA.VII.D.K4")).toEqual({
      status: "unresolved",
      code: "PA.VII.D.K4",
    });
    // Risk management out of range
    expect(resolveCurrentAreaVIITaskDAktrCode("PA.VII.D.R7")).toEqual({
      status: "unresolved",
      code: "PA.VII.D.R7",
    });

    // Sibling tasks in Area VII
    expect(resolveCurrentAreaVIITaskDAktrCode("PA.VII.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.VII.C.K1",
    });
    expect(resolveCurrentAreaVIITaskDAktrCode("PA.VII.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.VII.B.K1",
    });
    expect(resolveCurrentAreaVIITaskDAktrCode("PA.VII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VII.A.K1",
    });

    // Unrelated legacy AKTR code or empty
    expect(resolveCurrentAreaVIITaskDAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaVIITaskDAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
