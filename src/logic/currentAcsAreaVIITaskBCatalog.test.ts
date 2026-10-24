import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_B_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_B_SOURCE,
  resolveCurrentAreaVIITaskBAktrCode,
} from "./currentAcsAreaVIITaskBCatalog";

describe("Private Pilot Airplane ACS 6C Area VII Task B (PA.VII.B) catalog slice", () => {
  const expectedCodes = [
    "PA.VII.B.K1",
    "PA.VII.B.K2",
    "PA.VII.B.K3",
    "PA.VII.B.K4",
    "PA.VII.B.R1",
    "PA.VII.B.R2",
    "PA.VII.B.R3",
    "PA.VII.B.R4",
    "PA.VII.B.R5",
    "PA.VII.B.R6",
    "PA.VII.B.R7",
    "PA.VII.B.R8",
    "PA.VII.B.S1",
    "PA.VII.B.S2",
    "PA.VII.B.S3",
    "PA.VII.B.S4",
    "PA.VII.B.S5",
    "PA.VII.B.S6",
    "PA.VII.B.S7",
    "PA.VII.B.S8",
    "PA.VII.B.S9",
    "PA.VII.B.S10",
    "PA.VII.B.S11",
  ] as const;

  const expectedDescriptions: Record<(typeof expectedCodes)[number], string> = {
    "PA.VII.B.K1":
      "Aerodynamics associated with stalls in various airplane configurations, including the relationship between angle of attack, airspeed, load factor, power setting, airplane weight and center of gravity, airplane attitude, and yaw effects.",
    "PA.VII.B.K2":
      "Stall characteristics as they relate to airplane design, and recognition impending stall and full stall indications using sight, sound, or feel.",
    "PA.VII.B.K3":
      "Factors and situations that can lead to a power-off stall and actions that can be taken to prevent it.",
    "PA.VII.B.K4": "Fundamentals of stall recovery.",
    "PA.VII.B.R1":
      "Factors and situations that could lead to an inadvertent power-off stall, spin, and loss of control.",
    "PA.VII.B.R2":
      "Range and limitations of stall warning indicators (e.g., aircraft buffet, stall horn, etc.).",
    "PA.VII.B.R3": "Stall warning(s) during normal operations.",
    "PA.VII.B.R4": "Stall recovery procedure.",
    "PA.VII.B.R5": "Secondary stalls, accelerated stalls, and cross-control stalls.",
    "PA.VII.B.R6":
      "Effect of environmental elements on airplane performance related to power-off stalls (e.g., turbulence, microbursts, and high-density altitude).",
    "PA.VII.B.R7": "Collision hazards.",
    "PA.VII.B.R8":
      "Distractions, task prioritization, loss of situational awareness, or disorientation.",
    "PA.VII.B.S1": "Clear the area.",
    "PA.VII.B.S2":
      "Select an entry altitude that allows the Task to be completed no lower than 1,500 feet above ground level (AGL) (ASEL, ASES) or 3,000 feet AGL (AMEL, AMES).",
    "PA.VII.B.S3":
      "Configure the airplane in the approach or landing configuration, as specified by the evaluator, and maintain coordinated flight throughout the maneuver.",
    "PA.VII.B.S4": "Establish a stabilized descent.",
    "PA.VII.B.S5":
      "Transition smoothly from the approach or landing attitude to a pitch attitude that induces a stall.",
    "PA.VII.B.S6":
      "Maintain a specified heading ±10° if in straight flight; maintain a specified angle of bank not to exceed 20°, ±10° if in turning flight, while inducing the stall.",
    "PA.VII.B.S7":
      "Acknowledge cues of the impending stall and then recover promptly after a full stall occurs.",
    "PA.VII.B.S8":
      "Execute a stall recovery in accordance with procedures set forth in the Pilot's Operating Handbook (POH) or Airplane Flight Manual (AFM).",
    "PA.VII.B.S9":
      "Configure the airplane as recommended by the manufacturer, and accelerate to best angle of climb speed (VX) or best rate of climb speed (VY).",
    "PA.VII.B.S10":
      "Return to the altitude, heading, and airspeed specified by the evaluator.",
    "PA.VII.B.S11":
      "Use single-pilot resource management (SRM) or crew resource management (CRM), as appropriate.",
  };

  it("contains exactly the 23 verified Area VII Task B codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_B_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(23);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_B_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("VII");
      expect(entry.task).toBe("B");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_B_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.VII.B coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_B_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "43–44",
      pdfPages: "51–52",
      areaOfOperation: "Area of Operation VII: Slow Flight and Stalls",
      task: "Task B. Power-Off Stalls",
      coverageLabel: "PA.VII.B",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("preserves exact descriptions for every code in the slice", () => {
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_B_CODES) {
      expect(entry.description).toBe(
        expectedDescriptions[entry.code as (typeof expectedCodes)[number]],
      );
    }
  });

  it("resolves codes with ASCII case-insensitivity for K, R, and S codes", () => {
    const k1 = resolveCurrentAreaVIITaskBAktrCode("pa.vii.b.k1");
    expect(k1).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.B.K1",
        description:
          "Aerodynamics associated with stalls in various airplane configurations, including the relationship between angle of attack, airspeed, load factor, power setting, airplane weight and center of gravity, airplane attitude, and yaw effects.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "B",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_B_SOURCE,
      },
    });

    const k4 = resolveCurrentAreaVIITaskBAktrCode("Pa.ViI.b.K4");
    expect(k4).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.B.K4",
        description: "Fundamentals of stall recovery.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "B",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_B_SOURCE,
      },
    });

    const r1 = resolveCurrentAreaVIITaskBAktrCode("pa.vii.b.r1");
    expect(r1).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.B.R1",
        description:
          "Factors and situations that could lead to an inadvertent power-off stall, spin, and loss of control.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "B",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_B_SOURCE,
      },
    });

    const r5 = resolveCurrentAreaVIITaskBAktrCode("PA.VII.B.R5");
    expect(r5.status).toBe("current");

    const r8 = resolveCurrentAreaVIITaskBAktrCode("pa.vii.b.r8");
    expect(r8).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.B.R8",
        description:
          "Distractions, task prioritization, loss of situational awareness, or disorientation.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "B",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_B_SOURCE,
      },
    });

    const s1 = resolveCurrentAreaVIITaskBAktrCode("pa.vii.b.s1");
    expect(s1).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.B.S1",
        description: "Clear the area.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "B",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_B_SOURCE,
      },
    });

    const s11 = resolveCurrentAreaVIITaskBAktrCode("PA.VII.B.S11");
    expect(s11).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.B.S11",
        description:
          "Use single-pilot resource management (SRM) or crew resource management (CRM), as appropriate.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "B",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_B_SOURCE,
      },
    });

    const mixedCase = resolveCurrentAreaVIITaskBAktrCode("Pa.ViI.b.S6");
    expect(mixedCase.status).toBe("current");
  });

  it("leaves out-of-slice codes and invalid tokens unresolved", () => {
    expect(resolveCurrentAreaVIITaskBAktrCode("PA.VII.B.K5")).toEqual({
      status: "unresolved",
      code: "PA.VII.B.K5",
    });
    expect(resolveCurrentAreaVIITaskBAktrCode("PA.VII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VII.A.K1",
    });
    expect(resolveCurrentAreaVIITaskBAktrCode("PA.VII.B.R9")).toEqual({
      status: "unresolved",
      code: "PA.VII.B.R9",
    });
    expect(resolveCurrentAreaVIITaskBAktrCode("PA.VII.B.S12")).toEqual({
      status: "unresolved",
      code: "PA.VII.B.S12",
    });
    expect(resolveCurrentAreaVIITaskBAktrCode("PA.VII.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.VII.C.K1",
    });
    expect(resolveCurrentAreaVIITaskBAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaVIITaskBAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
