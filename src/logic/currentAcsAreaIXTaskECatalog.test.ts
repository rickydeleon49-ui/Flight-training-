import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_E_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_E_SOURCE,
  resolveCurrentAreaIXTaskEAktrCode,
} from "./currentAcsAreaIXTaskECatalog";

describe("Private Pilot Airplane ACS 6C Area IX Task E (PA.IX.E) catalog slice", () => {
  const expectedCodes = [
    "PA.IX.E.K1",
    "PA.IX.E.K2",
    "PA.IX.E.K3",
    "PA.IX.E.R1",
    "PA.IX.E.R2",
    "PA.IX.E.R3",
    "PA.IX.E.S1",
    "PA.IX.E.S2",
  ] as const;

  it("contains exactly the 8 verified Area IX Task E codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_E_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(8);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_E_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IX");
      expect(entry.task).toBe("E");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_E_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IX.E coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_E_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "55–56",
      pdfPages: "62–63",
      areaOfOperation: "Area of Operation IX: Emergency Operations",
      task: "Task E. Engine Failure During Takeoff Before VMC (Simulated) (AMEL, AMES)",
      coverageLabel: "PA.IX.E",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IX.E.K1":
        "Factors affecting minimum control airspeed with an inoperative engine (VMC).",
      "PA.IX.E.K2":
        "VMC (red line) and best single-engine rate of climb airspeed (VYSE) (blue line).",
      "PA.IX.E.K3": "Accelerate/stop distance.",
      "PA.IX.E.R1": "Potential engine failure during takeoff.",
      "PA.IX.E.R2": "Configuring the airplane.",
      "PA.IX.E.R3":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IX.E.S1":
        "Close the throttles smoothly and promptly when a simulated engine failure occurs.",
      "PA.IX.E.S2":
        "Maintain directional control and apply brakes (AMEL), or flight controls (AMES), as necessary.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_E_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area IX Task E code with case-insensitive ASCII matching", () => {
    // Knowledge codes
    const resK1 = resolveCurrentAreaIXTaskEAktrCode("pa.ix.e.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.E.K1",
        description:
          "Factors affecting minimum control airspeed with an inoperative engine (VMC).",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "IX",
        task: "E",
      },
    });

    const resK2 = resolveCurrentAreaIXTaskEAktrCode("PA.IX.E.K2");
    expect(resK2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.E.K2",
        description:
          "VMC (red line) and best single-engine rate of climb airspeed (VYSE) (blue line).",
      },
    });

    const resK3 = resolveCurrentAreaIXTaskEAktrCode("pa.ix.e.k3");
    expect(resK3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.E.K3",
        description: "Accelerate/stop distance.",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaIXTaskEAktrCode("pa.ix.e.r1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.E.R1",
        description: "Potential engine failure during takeoff.",
      },
    });

    const resR2 = resolveCurrentAreaIXTaskEAktrCode("PA.IX.E.R2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.E.R2",
        description: "Configuring the airplane.",
      },
    });

    const resR3 = resolveCurrentAreaIXTaskEAktrCode("pa.ix.e.r3");
    expect(resR3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.E.R3",
        description:
          "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      },
    });

    // Skill codes
    const resS1 = resolveCurrentAreaIXTaskEAktrCode("pa.ix.e.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.E.S1",
        description:
          "Close the throttles smoothly and promptly when a simulated engine failure occurs.",
      },
    });

    const resS2 = resolveCurrentAreaIXTaskEAktrCode("PA.IX.E.S2");
    expect(resS2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.E.S2",
        description:
          "Maintain directional control and apply brakes (AMEL), or flight controls (AMES), as necessary.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area IX Task A
    expect(resolveCurrentAreaIXTaskEAktrCode("PA.IX.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.A.K1",
    });

    // Area IX Task B
    expect(resolveCurrentAreaIXTaskEAktrCode("PA.IX.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.B.K1",
    });

    // Area IX Task C
    expect(resolveCurrentAreaIXTaskEAktrCode("PA.IX.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.C.K1",
    });

    // Area IX Task D
    expect(resolveCurrentAreaIXTaskEAktrCode("PA.IX.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.D.K1",
    });

    // Area IX Task F (if any)
    expect(resolveCurrentAreaIXTaskEAktrCode("PA.IX.F.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.F.K1",
    });

    // Area VIII Task A
    expect(resolveCurrentAreaIXTaskEAktrCode("PA.VIII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaIXTaskEAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes and non-existent sub-elements unresolved", () => {
    expect(resolveCurrentAreaIXTaskEAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
    expect(resolveCurrentAreaIXTaskEAktrCode("PA.IX.E.K4")).toEqual({
      status: "unresolved",
      code: "PA.IX.E.K4",
    });
    expect(resolveCurrentAreaIXTaskEAktrCode("PA.IX.E.R4")).toEqual({
      status: "unresolved",
      code: "PA.IX.E.R4",
    });
    expect(resolveCurrentAreaIXTaskEAktrCode("PA.IX.E.S3")).toEqual({
      status: "unresolved",
      code: "PA.IX.E.S3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIXTaskEAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIXTaskEAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
    expect(resolveCurrentAreaIXTaskEAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
