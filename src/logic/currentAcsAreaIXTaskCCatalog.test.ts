import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_C_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_C_SOURCE,
  resolveCurrentAreaIXTaskCAktrCode,
} from "./currentAcsAreaIXTaskCCatalog";

describe("Private Pilot Airplane ACS 6C Area IX Task C (PA.IX.C) catalog slice", () => {
  const expectedCodes = [
    "PA.IX.C.K1",
    "PA.IX.C.K2",
    "PA.IX.C.K2a",
    "PA.IX.C.K2b",
    "PA.IX.C.K2c",
    "PA.IX.C.K2d",
    "PA.IX.C.K2e",
    "PA.IX.C.K2f",
    "PA.IX.C.K3",
    "PA.IX.C.K4",
    "PA.IX.C.K5",
    "PA.IX.C.R1",
    "PA.IX.C.R2",
    "PA.IX.C.R3",
    "PA.IX.C.R4",
    "PA.IX.C.S1",
    "PA.IX.C.S2",
  ] as const;

  it("contains exactly the 17 verified Area IX Task C codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_C_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(17);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_C_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IX");
      expect(entry.task).toBe("C");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_C_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IX.C coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_C_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "53–54",
      pdfPages: "60–61",
      areaOfOperation: "Area of Operation IX: Emergency Operations",
      task: "Task C. Systems and Equipment Malfunctions",
      coverageLabel: "PA.IX.C",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IX.C.K1":
        "Causes of partial or complete power loss related to the specific type of powerplant(s).",
      "PA.IX.C.K2": "System and equipment malfunctions specific to the aircraft, including:",
      "PA.IX.C.K2a": "Electrical malfunction",
      "PA.IX.C.K2b": "Vacuum/pressure and associated flight instrument malfunctions",
      "PA.IX.C.K2c": "Pitot-static system malfunction",
      "PA.IX.C.K2d": "Electronic flight deck display malfunction",
      "PA.IX.C.K2e": "Landing gear or flap malfunction",
      "PA.IX.C.K2f": "Inoperative trim",
      "PA.IX.C.K3": "Causes and remedies for smoke or fire onboard the aircraft.",
      "PA.IX.C.K4": "Any other system specific to the aircraft (e.g., supplemental oxygen, deicing).",
      "PA.IX.C.K5": "Inadvertent door or window opening.",
      "PA.IX.C.R1": "Checklist usage for a system or equipment malfunction.",
      "PA.IX.C.R2":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IX.C.R3": "Undesired aircraft state.",
      "PA.IX.C.R4": "Startle response.",
      "PA.IX.C.S1":
        "Determine appropriate action for simulated emergencies specified by the evaluator, from at least three of the elements or sub-elements listed in K1 through K5.",
      "PA.IX.C.S2": "Complete the appropriate checklist(s).",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_C_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area IX Task C code with case-insensitive ASCII matching", () => {
    // Knowledge codes
    const resK1 = resolveCurrentAreaIXTaskCAktrCode("pa.ix.c.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.K1",
        description:
          "Causes of partial or complete power loss related to the specific type of powerplant(s).",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "IX",
        task: "C",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_C_SOURCE,
      },
    });

    const resK2 = resolveCurrentAreaIXTaskCAktrCode("PA.IX.C.K2");
    expect(resK2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.K2",
        description: "System and equipment malfunctions specific to the aircraft, including:",
      },
    });

    const resK2a = resolveCurrentAreaIXTaskCAktrCode("pa.ix.c.k2a");
    expect(resK2a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.K2a",
        description: "Electrical malfunction",
      },
    });

    const resK2b = resolveCurrentAreaIXTaskCAktrCode("PA.IX.C.K2B");
    expect(resK2b).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.K2b",
        description: "Vacuum/pressure and associated flight instrument malfunctions",
      },
    });

    const resK2c = resolveCurrentAreaIXTaskCAktrCode("pa.ix.c.k2c");
    expect(resK2c).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.K2c",
        description: "Pitot-static system malfunction",
      },
    });

    const resK2d = resolveCurrentAreaIXTaskCAktrCode("PA.IX.C.K2D");
    expect(resK2d).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.K2d",
        description: "Electronic flight deck display malfunction",
      },
    });

    const resK2e = resolveCurrentAreaIXTaskCAktrCode("pa.ix.c.k2e");
    expect(resK2e).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.K2e",
        description: "Landing gear or flap malfunction",
      },
    });

    const resK2f = resolveCurrentAreaIXTaskCAktrCode("PA.IX.C.K2F");
    expect(resK2f).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.K2f",
        description: "Inoperative trim",
      },
    });

    const resK3 = resolveCurrentAreaIXTaskCAktrCode("PA.IX.C.K3");
    expect(resK3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.K3",
        description: "Causes and remedies for smoke or fire onboard the aircraft.",
      },
    });

    const resK4 = resolveCurrentAreaIXTaskCAktrCode("pa.ix.c.k4");
    expect(resK4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.K4",
        description:
          "Any other system specific to the aircraft (e.g., supplemental oxygen, deicing).",
      },
    });

    const resK5 = resolveCurrentAreaIXTaskCAktrCode("PA.IX.C.K5");
    expect(resK5).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.K5",
        description: "Inadvertent door or window opening.",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaIXTaskCAktrCode("pa.ix.c.r1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.R1",
        description: "Checklist usage for a system or equipment malfunction.",
      },
    });

    const resR2 = resolveCurrentAreaIXTaskCAktrCode("PA.IX.C.R2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.R2",
        description:
          "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      },
    });

    const resR3 = resolveCurrentAreaIXTaskCAktrCode("pa.ix.c.r3");
    expect(resR3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.R3",
        description: "Undesired aircraft state.",
      },
    });

    const resR4 = resolveCurrentAreaIXTaskCAktrCode("PA.IX.C.R4");
    expect(resR4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.R4",
        description: "Startle response.",
      },
    });

    // Skill codes
    const resS1 = resolveCurrentAreaIXTaskCAktrCode("pa.ix.c.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.S1",
        description:
          "Determine appropriate action for simulated emergencies specified by the evaluator, from at least three of the elements or sub-elements listed in K1 through K5.",
      },
    });

    const resS2 = resolveCurrentAreaIXTaskCAktrCode("PA.IX.C.S2");
    expect(resS2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.C.S2",
        description: "Complete the appropriate checklist(s).",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area IX Task A
    expect(resolveCurrentAreaIXTaskCAktrCode("PA.IX.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.A.K1",
    });
    expect(resolveCurrentAreaIXTaskCAktrCode("PA.IX.A.S1")).toEqual({
      status: "unresolved",
      code: "PA.IX.A.S1",
    });

    // Area IX Task B
    expect(resolveCurrentAreaIXTaskCAktrCode("PA.IX.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.B.K1",
    });

    // Area VIII Task A
    expect(resolveCurrentAreaIXTaskCAktrCode("PA.VIII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaIXTaskCAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    expect(resolveCurrentAreaIXTaskCAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
    // Explicitly archived K1a-d in PA.IX.C
    expect(resolveCurrentAreaIXTaskCAktrCode("PA.IX.C.K1a")).toEqual({
      status: "unresolved",
      code: "PA.IX.C.K1A",
    });
    expect(resolveCurrentAreaIXTaskCAktrCode("PA.IX.C.K1b")).toEqual({
      status: "unresolved",
      code: "PA.IX.C.K1B",
    });
    expect(resolveCurrentAreaIXTaskCAktrCode("PA.IX.C.K1c")).toEqual({
      status: "unresolved",
      code: "PA.IX.C.K1C",
    });
    expect(resolveCurrentAreaIXTaskCAktrCode("PA.IX.C.K1d")).toEqual({
      status: "unresolved",
      code: "PA.IX.C.K1D",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIXTaskCAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIXTaskCAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
