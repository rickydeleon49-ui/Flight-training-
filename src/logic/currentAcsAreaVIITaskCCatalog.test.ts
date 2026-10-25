import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_C_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_C_SOURCE,
  resolveCurrentAreaVIITaskCAktrCode,
} from "./currentAcsAreaVIITaskCCatalog";

describe("Private Pilot Airplane ACS 6C Area VII Task C (PA.VII.C) catalog slice", () => {
  const expectedCodes = [
    "PA.VII.C.K1",
    "PA.VII.C.K2",
    "PA.VII.C.K3",
    "PA.VII.C.K4",
    "PA.VII.C.R1",
    "PA.VII.C.R2",
    "PA.VII.C.R3",
    "PA.VII.C.R4",
    "PA.VII.C.R5",
    "PA.VII.C.R6",
    "PA.VII.C.R7",
    "PA.VII.C.R8",
    "PA.VII.C.S1",
    "PA.VII.C.S2",
    "PA.VII.C.S3",
    "PA.VII.C.S4",
    "PA.VII.C.S5",
    "PA.VII.C.S6",
    "PA.VII.C.S7",
    "PA.VII.C.S8",
    "PA.VII.C.S9",
    "PA.VII.C.S10",
    "PA.VII.C.S11",
  ] as const;

  const expectedDescriptions: Record<(typeof expectedCodes)[number], string> = {
    "PA.VII.C.K1":
      "Aerodynamics associated with stalls in various airplane configurations, including the relationship between angle of attack, airspeed, load factor, power setting, airplane weight and center of gravity, airplane attitude, and yaw effects.",
    "PA.VII.C.K2":
      "Stall characteristics as they relate to airplane design, and recognition impending stall and full stall indications using sight, sound, or feel.",
    "PA.VII.C.K3":
      "Factors and situations that can lead to a power-on stall and actions that can be taken to prevent it.",
    "PA.VII.C.K4": "Fundamentals of stall recovery.",
    "PA.VII.C.R1":
      "Factors and situations that could lead to an inadvertent power-on stall, spin, and loss of control.",
    "PA.VII.C.R2":
      "Range and limitations of stall warning indicators (e.g., aircraft buffet, stall horn, etc.).",
    "PA.VII.C.R3": "Stall warning(s) during normal operations.",
    "PA.VII.C.R4": "Stall recovery procedure.",
    "PA.VII.C.R5":
      "Secondary stalls, accelerated stalls, elevator trim stalls, and cross-control stalls.",
    "PA.VII.C.R6":
      "Effect of environmental elements on airplane performance related to power-on stalls (e.g., turbulence, microbursts, and high-density altitude).",
    "PA.VII.C.R7": "Collision hazards.",
    "PA.VII.C.R8":
      "Distractions, task prioritization, loss of situational awareness, or disorientation.",
    "PA.VII.C.S1": "Clear the area.",
    "PA.VII.C.S2":
      "Select an entry altitude that allows the Task to be completed no lower than 1,500 feet above ground level (AGL) (ASEL, ASES) or 3,000 feet AGL (AMEL, AMES).",
    "PA.VII.C.S3":
      "Establish the takeoff, departure, or cruise configuration, as specified by the evaluator, and maintain coordinated flight throughout the maneuver.",
    "PA.VII.C.S4":
      "Set power (as assigned by the evaluator) to no less than 65 percent power.",
    "PA.VII.C.S5":
      "Transition smoothly from the takeoff or departure attitude to the pitch attitude that induces a stall.",
    "PA.VII.C.S6":
      "Maintain a specified heading, ±10° if in straight flight; maintain a specified angle of bank not to exceed 20°, ±10° if in turning flight, while inducing the stall.",
    "PA.VII.C.S7":
      "Acknowledge cues of the impending stall and then recover promptly after a full stall occurs.",
    "PA.VII.C.S8":
      "Execute a stall recovery in accordance with procedures set forth in the Pilot's Operating Handbook (POH)/Flight Manual (FM).",
    "PA.VII.C.S9":
      "Configure the airplane as recommended by the manufacturer, and accelerate to best angle of climb speed (VX) or best rate of climb speed (VY).",
    "PA.VII.C.S10":
      "Return to the altitude, heading, and airspeed specified by the evaluator.",
    "PA.VII.C.S11":
      "Use single-pilot resource management (SRM) or crew resource management (CRM), as appropriate.",
  };

  it("contains exactly the 23 verified Area VII Task C codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_C_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(23);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_C_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("VII");
      expect(entry.task).toBe("C");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_C_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.VII.C coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_C_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "44–45",
      pdfPages: "52–53",
      areaOfOperation: "Area of Operation VII: Slow Flight and Stalls",
      task: "Task C. Power-On Stalls",
      coverageLabel: "PA.VII.C",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("preserves exact descriptions for every code in the slice", () => {
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VII_TASK_C_CODES) {
      expect(entry.description).toBe(
        expectedDescriptions[entry.code as (typeof expectedCodes)[number]],
      );
    }
  });

  it("resolves codes with ASCII case-insensitivity for K, R, and S codes", () => {
    const k1 = resolveCurrentAreaVIITaskCAktrCode("pa.vii.c.k1");
    expect(k1).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.C.K1",
        description:
          "Aerodynamics associated with stalls in various airplane configurations, including the relationship between angle of attack, airspeed, load factor, power setting, airplane weight and center of gravity, airplane attitude, and yaw effects.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "C",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_C_SOURCE,
      },
    });

    const k4 = resolveCurrentAreaVIITaskCAktrCode("Pa.ViI.c.K4");
    expect(k4).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.C.K4",
        description: "Fundamentals of stall recovery.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "C",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_C_SOURCE,
      },
    });

    const r1 = resolveCurrentAreaVIITaskCAktrCode("pa.vii.c.r1");
    expect(r1).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.C.R1",
        description:
          "Factors and situations that could lead to an inadvertent power-on stall, spin, and loss of control.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "C",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_C_SOURCE,
      },
    });

    const r5 = resolveCurrentAreaVIITaskCAktrCode("PA.VII.C.R5");
    expect(r5.status).toBe("current");

    const r8 = resolveCurrentAreaVIITaskCAktrCode("pa.vii.c.r8");
    expect(r8).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.C.R8",
        description:
          "Distractions, task prioritization, loss of situational awareness, or disorientation.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "C",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_C_SOURCE,
      },
    });

    const s1 = resolveCurrentAreaVIITaskCAktrCode("pa.vii.c.s1");
    expect(s1).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.C.S1",
        description: "Clear the area.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "C",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_C_SOURCE,
      },
    });

    const s11 = resolveCurrentAreaVIITaskCAktrCode("PA.VII.C.S11");
    expect(s11).toEqual({
      status: "current",
      entry: {
        code: "PA.VII.C.S11",
        description:
          "Use single-pilot resource management (SRM) or crew resource management (CRM), as appropriate.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VII",
        task: "C",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VII_TASK_C_SOURCE,
      },
    });

    const mixedCase = resolveCurrentAreaVIITaskCAktrCode("Pa.ViI.c.S6");
    expect(mixedCase.status).toBe("current");
  });

  it("leaves out-of-slice codes and invalid tokens unresolved", () => {
    expect(resolveCurrentAreaVIITaskCAktrCode("PA.VII.C.K5")).toEqual({
      status: "unresolved",
      code: "PA.VII.C.K5",
    });
    expect(resolveCurrentAreaVIITaskCAktrCode("PA.VII.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.VII.B.K1",
    });
    expect(resolveCurrentAreaVIITaskCAktrCode("PA.VII.C.R9")).toEqual({
      status: "unresolved",
      code: "PA.VII.C.R9",
    });
    expect(resolveCurrentAreaVIITaskCAktrCode("PA.VII.C.S12")).toEqual({
      status: "unresolved",
      code: "PA.VII.C.S12",
    });
    expect(resolveCurrentAreaVIITaskCAktrCode("PA.VII.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.VII.D.K1",
    });
    expect(resolveCurrentAreaVIITaskCAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaVIITaskCAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
