import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_C_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_C_SOURCE,
  resolveCurrentAreaVITaskCAktrCode,
} from "./currentAcsAreaVITaskCCatalog";

describe("Private Pilot Airplane ACS 6C Area VI Task C (PA.VI.C) catalog slice", () => {
  const expectedCodes = [
    "PA.VI.C.K1",
    "PA.VI.C.K2",
    "PA.VI.C.R1",
    "PA.VI.C.R2",
    "PA.VI.C.R3",
    "PA.VI.C.R4",
    "PA.VI.C.R5",
    "PA.VI.C.S1",
    "PA.VI.C.S2",
    "PA.VI.C.S3",
    "PA.VI.C.S4",
    "PA.VI.C.S5",
    "PA.VI.C.S6",
  ] as const;

  const expectedDescriptions: Record<(typeof expectedCodes)[number], string> = {
    "PA.VI.C.K1": "Selecting an alternate destination.",
    "PA.VI.C.K2":
      "Situations that require deviations from flight plan or air traffic control (ATC) instructions.",
    "PA.VI.C.R1": "Collision hazards.",
    "PA.VI.C.R2":
      "Distractions, task prioritization, loss of situational awareness, or disorientation.",
    "PA.VI.C.R3": "Circumstances that would make diversion prudent.",
    "PA.VI.C.R4": "Selecting an appropriate airport or seaplane base.",
    "PA.VI.C.R5":
      "Using available resources (e.g., automation, ATC, and flight deck planning aids).",
    "PA.VI.C.S1": "Select a suitable destination and route for diversion.",
    "PA.VI.C.S2":
      "Make a reasonable estimate of heading, groundspeed, arrival time, and fuel required to the “divert to” destination.",
    "PA.VI.C.S3": "Maintain the selected altitude, ±200 feet and heading, ±15°.",
    "PA.VI.C.S4": "Update/interpret weather in flight.",
    "PA.VI.C.S5":
      "Use displays of digital weather and aeronautical information, as applicable to maintain situational awareness.",
    "PA.VI.C.S6": "Promptly divert toward the destination.",
  };

  it("contains exactly the 13 verified Area VI Task C codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_C_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(13);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_C_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("VI");
      expect(entry.task).toBe("C");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_C_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.VI.C coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_C_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "40–41",
      pdfPages: "48–49",
      areaOfOperation: "Area of Operation VI: Navigation",
      task: "Task C. Diversion",
      coverageLabel: "PA.VI.C",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("preserves exact descriptions for every code in the slice", () => {
    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_C_CODES) {
      expect(entry.description).toBe(
        expectedDescriptions[entry.code as (typeof expectedCodes)[number]],
      );
    }
  });

  it("resolves codes with ASCII case-insensitivity for K, R, and S codes", () => {
    const k1 = resolveCurrentAreaVITaskCAktrCode("pa.vi.c.k1");
    expect(k1).toEqual({
      status: "current",
      entry: {
        code: "PA.VI.C.K1",
        description: "Selecting an alternate destination.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VI",
        task: "C",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_C_SOURCE,
      },
    });

    const k2 = resolveCurrentAreaVITaskCAktrCode("PA.VI.C.K2");
    expect(k2.status).toBe("current");

    const r1 = resolveCurrentAreaVITaskCAktrCode("pa.vi.c.r1");
    expect(r1).toEqual({
      status: "current",
      entry: {
        code: "PA.VI.C.R1",
        description: "Collision hazards.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VI",
        task: "C",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_C_SOURCE,
      },
    });

    const s3 = resolveCurrentAreaVITaskCAktrCode("PA.VI.C.S3");
    expect(s3).toEqual({
      status: "current",
      entry: {
        code: "PA.VI.C.S3",
        description: "Maintain the selected altitude, ±200 feet and heading, ±15°.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VI",
        task: "C",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_C_SOURCE,
      },
    });

    const s6 = resolveCurrentAreaVITaskCAktrCode("pa.vi.c.s6");
    expect(s6).toEqual({
      status: "current",
      entry: {
        code: "PA.VI.C.S6",
        description: "Promptly divert toward the destination.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VI",
        task: "C",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_C_SOURCE,
      },
    });

    const mixedCase = resolveCurrentAreaVITaskCAktrCode("Pa.Vi.C.s2");
    expect(mixedCase.status).toBe("current");
  });

  it("leaves out-of-slice codes and invalid tokens unresolved", () => {
    expect(resolveCurrentAreaVITaskCAktrCode("PA.VI.C.K3")).toEqual({
      status: "unresolved",
      code: "PA.VI.C.K3",
    });
    expect(resolveCurrentAreaVITaskCAktrCode("PA.VI.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.VI.B.K1",
    });
    expect(resolveCurrentAreaVITaskCAktrCode("PA.VI.C.R6")).toEqual({
      status: "unresolved",
      code: "PA.VI.C.R6",
    });
    expect(resolveCurrentAreaVITaskCAktrCode("PA.VI.C.S7")).toEqual({
      status: "unresolved",
      code: "PA.VI.C.S7",
    });
    expect(resolveCurrentAreaVITaskCAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaVITaskCAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
