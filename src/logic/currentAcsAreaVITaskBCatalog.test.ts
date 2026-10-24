import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_B_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_B_SOURCE,
  resolveCurrentAreaVITaskBAktrCode,
} from "./currentAcsAreaVITaskBCatalog";

describe("Private Pilot Airplane ACS 6C Area VI Task B (PA.VI.B) catalog slice", () => {
  const expectedCodes = [
    "PA.VI.B.K1",
    "PA.VI.B.K2",
    "PA.VI.B.K3",
    "PA.VI.B.K4",
    "PA.VI.B.R1",
    "PA.VI.B.R2",
    "PA.VI.B.R3",
    "PA.VI.B.R4",
    "PA.VI.B.R5",
    "PA.VI.B.S1",
    "PA.VI.B.S2",
    "PA.VI.B.S3",
    "PA.VI.B.S4",
    "PA.VI.B.S5",
    "PA.VI.B.S6",
    "PA.VI.B.S7",
  ] as const;

  const expectedDescriptions: Record<(typeof expectedCodes)[number], string> = {
    "PA.VI.B.K1":
      "Ground-based navigation (identification, orientation, course determination, equipment, tests, regulations, interference, appropriate use of navigation data, and signal integrity).",
    "PA.VI.B.K2":
      "Satellite-based navigation (e.g., equipment, regulations, authorized use of databases, and Receiver Autonomous Integrity Monitoring (RAIM)).",
    "PA.VI.B.K3":
      "Radar assistance to visual flight rules (VFR) aircraft (e.g., operations, equipment, available services, traffic advisories).",
    "PA.VI.B.K4":
      "Transponder (Mode(s) A, C, and S) and Automatic Dependent Surveillance-Broadcast (ADS-B).",
    "PA.VI.B.R1": "Management of automated navigation and autoflight systems.",
    "PA.VI.B.R2":
      "Distractions, task prioritization, loss of situational awareness, or disorientation.",
    "PA.VI.B.R3": "Limitations of the navigation system in use.",
    "PA.VI.B.R4": "Loss of a navigation signal.",
    "PA.VI.B.R5": "Use of an electronic flight bag (EFB), if used.",
    "PA.VI.B.S1": "Use an airborne electronic navigation system.",
    "PA.VI.B.S2": "Determine the airplane’s position using the navigation system.",
    "PA.VI.B.S3": "Intercept and track a given course, radial, or bearing.",
    "PA.VI.B.S4": "Recognize and describe the indication of station or waypoint passage.",
    "PA.VI.B.S5":
      "Recognize signal loss or interference and take appropriate action, if applicable.",
    "PA.VI.B.S6": "Use proper communication procedures when utilizing radar services.",
    "PA.VI.B.S7": "Maintain the selected altitude, ±200 feet and heading, ±15°.",
  };

  it("contains exactly the 16 verified Area VI Task B codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_B_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(16);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_B_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("VI");
      expect(entry.task).toBe("B");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_B_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.VI.B coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_B_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "39–40",
      pdfPages: "47–48",
      areaOfOperation: "Area of Operation VI: Navigation",
      task: "Task B. Navigation Systems and Radar Services",
      coverageLabel: "PA.VI.B",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("preserves exact descriptions for every code in the slice", () => {
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_B_CODES) {
      expect(entry.description).toBe(
        expectedDescriptions[entry.code as (typeof expectedCodes)[number]],
      );
    }
  });

  it("resolves codes with ASCII case-insensitivity for K, R, and S codes", () => {
    const k1 = resolveCurrentAreaVITaskBAktrCode("pa.vi.b.k1");
    expect(k1).toEqual({
      status: "current",
      entry: {
        code: "PA.VI.B.K1",
        description:
          "Ground-based navigation (identification, orientation, course determination, equipment, tests, regulations, interference, appropriate use of navigation data, and signal integrity).",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VI",
        task: "B",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_B_SOURCE,
      },
    });

    const k4 = resolveCurrentAreaVITaskBAktrCode("PA.VI.B.K4");
    expect(k4.status).toBe("current");

    const r1 = resolveCurrentAreaVITaskBAktrCode("pa.vi.b.r1");
    expect(r1).toEqual({
      status: "current",
      entry: {
        code: "PA.VI.B.R1",
        description: "Management of automated navigation and autoflight systems.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VI",
        task: "B",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_B_SOURCE,
      },
    });

    const s7 = resolveCurrentAreaVITaskBAktrCode("PA.VI.B.S7");
    expect(s7).toEqual({
      status: "current",
      entry: {
        code: "PA.VI.B.S7",
        description: "Maintain the selected altitude, ±200 feet and heading, ±15°.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VI",
        task: "B",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_B_SOURCE,
      },
    });

    const mixedCase = resolveCurrentAreaVITaskBAktrCode("Pa.Vi.B.s2");
    expect(mixedCase.status).toBe("current");
  });

  it("leaves out-of-slice codes and invalid tokens unresolved", () => {
    expect(resolveCurrentAreaVITaskBAktrCode("PA.VI.B.K5")).toEqual({
      status: "unresolved",
      code: "PA.VI.B.K5",
    });
    expect(resolveCurrentAreaVITaskBAktrCode("PA.VI.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VI.A.K1",
    });
    expect(resolveCurrentAreaVITaskBAktrCode("PA.VI.B.R6")).toEqual({
      status: "unresolved",
      code: "PA.VI.B.R6",
    });
    expect(resolveCurrentAreaVITaskBAktrCode("PA.VI.B.S8")).toEqual({
      status: "unresolved",
      code: "PA.VI.B.S8",
    });
    expect(resolveCurrentAreaVITaskBAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaVITaskBAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
