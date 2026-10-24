import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_A_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_A_SOURCE,
  resolveCurrentAreaVITaskAAktrCode,
} from "./currentAcsAreaVITaskACatalog";

describe("Private Pilot Airplane ACS 6C Area VI Task A (PA.VI.A) catalog slice", () => {
  const expectedCodes = [
    "PA.VI.A.K1",
    "PA.VI.A.K2",
    "PA.VI.A.K3",
    "PA.VI.A.K4",
    "PA.VI.A.K4a",
    "PA.VI.A.K4b",
    "PA.VI.A.K4c",
    "PA.VI.A.K5",
    "PA.VI.A.K5a",
    "PA.VI.A.K5b",
    "PA.VI.A.K5c",
    "PA.VI.A.K5d",
    "PA.VI.A.K6",
    "PA.VI.A.K7",
    "PA.VI.A.R1",
    "PA.VI.A.R2",
    "PA.VI.A.R3",
    "PA.VI.A.S1",
    "PA.VI.A.S2",
    "PA.VI.A.S3",
    "PA.VI.A.S4",
    "PA.VI.A.S5",
    "PA.VI.A.S6",
    "PA.VI.A.S7",
  ] as const;

  const expectedDescriptions: Record<(typeof expectedCodes)[number], string> = {
    "PA.VI.A.K1": "Pilotage and dead reckoning.",
    "PA.VI.A.K2": "Magnetic compass errors.",
    "PA.VI.A.K3": "Topography.",
    "PA.VI.A.K4": "Selection of appropriate:",
    "PA.VI.A.K4a": "Route",
    "PA.VI.A.K4b": "Altitude(s)",
    "PA.VI.A.K4c": "Checkpoints",
    "PA.VI.A.K5": "Plotting a course, including:",
    "PA.VI.A.K5a": "Determining heading, speed, and course",
    "PA.VI.A.K5b": "Wind correction angle",
    "PA.VI.A.K5c": "Estimating time, speed, and distance",
    "PA.VI.A.K5d": "True airspeed and density altitude",
    "PA.VI.A.K6": "Power setting selection.",
    "PA.VI.A.K7": "Planned calculations versus actual results and required corrections.",
    "PA.VI.A.R1": "Collision hazards.",
    "PA.VI.A.R2": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
    "PA.VI.A.R3": "Unplanned fuel/power consumption, if applicable.",
    "PA.VI.A.S1": "Prepare and use a flight log.",
    "PA.VI.A.S2": "Navigate by pilotage.",
    "PA.VI.A.S3": "Navigate by means of pre-computed headings, groundspeeds, elapsed time, and reference to landmarks or checkpoints.",
    "PA.VI.A.S4": "Use the magnetic direction indicator in navigation, including turns to headings.",
    "PA.VI.A.S5": "Verify position within three nautical miles of the flight-planned route.",
    "PA.VI.A.S6": "Arrive at the en route checkpoints within five minutes of the initial or revised estimated time of arrival (ETA) and provide a destination estimate.",
    "PA.VI.A.S7": "Maintain the selected altitude, ±200 feet and heading, ±15°.",
  };

  it("contains exactly the 24 verified Area VI Task A codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_A_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(24);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_A_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("VI");
      expect(entry.task).toBe("A");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_A_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.VI.A coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_A_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "38–39",
      pdfPages: "46–47",
      areaOfOperation: "Area of Operation VI: Navigation",
      task: "Task A. Pilotage and Dead Reckoning",
      coverageLabel: "PA.VI.A",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("preserves exact descriptions for every code in the slice", () => {
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_A_CODES) {
      expect(entry.description).toBe(
        expectedDescriptions[entry.code as (typeof expectedCodes)[number]],
      );
    }
  });

  it("normalizes child list labels like 'a.' out of child descriptions", () => {
    const k4a = CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_A_CODES.find((e) => e.code === "PA.VI.A.K4a");
    const k4b = CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_A_CODES.find((e) => e.code === "PA.VI.A.K4b");
    const k4c = CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_A_CODES.find((e) => e.code === "PA.VI.A.K4c");
    const k5a = CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_A_CODES.find((e) => e.code === "PA.VI.A.K5a");
    const k5b = CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_A_CODES.find((e) => e.code === "PA.VI.A.K5b");
    const k5c = CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_A_CODES.find((e) => e.code === "PA.VI.A.K5c");
    const k5d = CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_A_CODES.find((e) => e.code === "PA.VI.A.K5d");

    expect(k4a?.description).toBe("Route");
    expect(k4b?.description).toBe("Altitude(s)");
    expect(k4c?.description).toBe("Checkpoints");
    expect(k5a?.description).toBe("Determining heading, speed, and course");
    expect(k5b?.description).toBe("Wind correction angle");
    expect(k5c?.description).toBe("Estimating time, speed, and distance");
    expect(k5d?.description).toBe("True airspeed and density altitude");
  });

  it("resolves codes with ASCII case-insensitivity for parents and nested children", () => {
    const parent = resolveCurrentAreaVITaskAAktrCode("pa.vi.a.k1");
    expect(parent).toEqual({
      status: "current",
      entry: {
        code: "PA.VI.A.K1",
        description: "Pilotage and dead reckoning.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VI",
        task: "A",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_A_SOURCE,
      },
    });

    const childK4a = resolveCurrentAreaVITaskAAktrCode("pa.vi.a.k4a");
    expect(childK4a).toEqual({
      status: "current",
      entry: {
        code: "PA.VI.A.K4a",
        description: "Route",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VI",
        task: "A",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_A_SOURCE,
      },
    });

    const childK5d = resolveCurrentAreaVITaskAAktrCode("PA.VI.A.K5D");
    expect(childK5d).toEqual({
      status: "current",
      entry: {
        code: "PA.VI.A.K5d",
        description: "True airspeed and density altitude",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VI",
        task: "A",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_A_SOURCE,
      },
    });

    const risk = resolveCurrentAreaVITaskAAktrCode("pa.vi.a.r1");
    expect(risk.status).toBe("current");

    const skill = resolveCurrentAreaVITaskAAktrCode("pa.vi.a.s7");
    expect(skill.status).toBe("current");
  });

  it("leaves out-of-slice codes and invalid tokens unresolved", () => {
    expect(resolveCurrentAreaVITaskAAktrCode("PA.VI.A.K8")).toEqual({
      status: "unresolved",
      code: "PA.VI.A.K8",
    });
    expect(resolveCurrentAreaVITaskAAktrCode("PA.VI.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.VI.B.K1",
    });
    expect(resolveCurrentAreaVITaskAAktrCode("PA.V.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.V.A.K1",
    });
    expect(resolveCurrentAreaVITaskAAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaVITaskAAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
