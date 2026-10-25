import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_D_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_D_SOURCE,
  resolveCurrentAreaIXTaskDAktrCode,
} from "./currentAcsAreaIXTaskDCatalog";

describe("Private Pilot Airplane ACS 6C Area IX Task D (PA.IX.D) catalog slice", () => {
  const expectedCodes = [
    "PA.IX.D.K1",
    "PA.IX.D.K2",
    "PA.IX.D.K3",
    "PA.IX.D.K3a",
    "PA.IX.D.K3b",
    "PA.IX.D.K3c",
    "PA.IX.D.K4",
    "PA.IX.D.K5",
    "PA.IX.D.R1",
    "PA.IX.D.R2",
    "PA.IX.D.R3",
    "PA.IX.D.S1",
    "PA.IX.D.S2",
    "PA.IX.D.S3",
  ] as const;

  it("contains exactly the 14 verified Area IX Task D codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_D_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(14);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_D_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IX");
      expect(entry.task).toBe("D");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_D_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IX.D coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_D_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "54–55",
      pdfPages: "61–62",
      areaOfOperation: "Area of Operation IX: Emergency Operations",
      task: "Task D. Emergency Equipment and Survival Gear",
      coverageLabel: "PA.IX.D",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IX.D.K1":
        "Emergency Locator Transmitter (ELT) operations, limitations, and testing requirements.",
      "PA.IX.D.K2": "Fire extinguisher operations and limitations.",
      "PA.IX.D.K3": "Emergency equipment and survival gear needed for:",
      "PA.IX.D.K3a": "Climate extremes (hot/cold)",
      "PA.IX.D.K3b": "Mountainous terrain",
      "PA.IX.D.K3c": "Overwater operations",
      "PA.IX.D.K4":
        "When to deploy a ballistic parachute and associated passenger briefings, if equipped.",
      "PA.IX.D.K5":
        "When to activate an emergency auto-land system and brief passengers, if equipped.",
      "PA.IX.D.R1": "Survival gear (water, clothing, shelter) for 48 to 72 hours.",
      "PA.IX.D.R2": "Use of a ballistic parachute system.",
      "PA.IX.D.R3": "Use of an emergency auto-land system, if installed.",
      "PA.IX.D.S1": "Identify appropriate equipment and personal gear.",
      "PA.IX.D.S2":
        "Brief passengers on proper use of on-board emergency equipment and survival gear.",
      "PA.IX.D.S3": "Simulate ballistic parachute deployment procedures, if equipped.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_D_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area IX Task D code with case-insensitive ASCII matching", () => {
    // Knowledge codes
    const resK1 = resolveCurrentAreaIXTaskDAktrCode("pa.ix.d.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.D.K1",
        description:
          "Emergency Locator Transmitter (ELT) operations, limitations, and testing requirements.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "IX",
        task: "D",
      },
    });

    const resK2 = resolveCurrentAreaIXTaskDAktrCode("PA.IX.D.K2");
    expect(resK2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.D.K2",
        description: "Fire extinguisher operations and limitations.",
      },
    });

    const resK3 = resolveCurrentAreaIXTaskDAktrCode("pa.ix.d.k3");
    expect(resK3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.D.K3",
        description: "Emergency equipment and survival gear needed for:",
      },
    });

    const resK3a = resolveCurrentAreaIXTaskDAktrCode("pa.ix.d.k3a");
    expect(resK3a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.D.K3a",
        description: "Climate extremes (hot/cold)",
      },
    });

    const resK3b = resolveCurrentAreaIXTaskDAktrCode("PA.IX.D.K3B");
    expect(resK3b).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.D.K3b",
        description: "Mountainous terrain",
      },
    });

    const resK3c = resolveCurrentAreaIXTaskDAktrCode("pa.ix.d.k3c");
    expect(resK3c).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.D.K3c",
        description: "Overwater operations",
      },
    });

    const resK4 = resolveCurrentAreaIXTaskDAktrCode("pa.ix.d.k4");
    expect(resK4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.D.K4",
        description:
          "When to deploy a ballistic parachute and associated passenger briefings, if equipped.",
      },
    });

    const resK5 = resolveCurrentAreaIXTaskDAktrCode("PA.IX.D.K5");
    expect(resK5).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.D.K5",
        description:
          "When to activate an emergency auto-land system and brief passengers, if equipped.",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaIXTaskDAktrCode("pa.ix.d.r1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.D.R1",
        description: "Survival gear (water, clothing, shelter) for 48 to 72 hours.",
      },
    });

    const resR2 = resolveCurrentAreaIXTaskDAktrCode("PA.IX.D.R2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.D.R2",
        description: "Use of a ballistic parachute system.",
      },
    });

    const resR3 = resolveCurrentAreaIXTaskDAktrCode("pa.ix.d.r3");
    expect(resR3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.D.R3",
        description: "Use of an emergency auto-land system, if installed.",
      },
    });

    // Skill codes
    const resS1 = resolveCurrentAreaIXTaskDAktrCode("pa.ix.d.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.D.S1",
        description: "Identify appropriate equipment and personal gear.",
      },
    });

    const resS2 = resolveCurrentAreaIXTaskDAktrCode("PA.IX.D.S2");
    expect(resS2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.D.S2",
        description:
          "Brief passengers on proper use of on-board emergency equipment and survival gear.",
      },
    });

    const resS3 = resolveCurrentAreaIXTaskDAktrCode("pa.ix.d.s3");
    expect(resS3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.D.S3",
        description: "Simulate ballistic parachute deployment procedures, if equipped.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area IX Task A
    expect(resolveCurrentAreaIXTaskDAktrCode("PA.IX.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.A.K1",
    });

    // Area IX Task B
    expect(resolveCurrentAreaIXTaskDAktrCode("PA.IX.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.B.K1",
    });

    // Area IX Task C
    expect(resolveCurrentAreaIXTaskDAktrCode("PA.IX.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.C.K1",
    });

    // Area IX Task E (if any)
    expect(resolveCurrentAreaIXTaskDAktrCode("PA.IX.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.E.K1",
    });

    // Area VIII Task A
    expect(resolveCurrentAreaIXTaskDAktrCode("PA.VIII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaIXTaskDAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes and non-existent sub-elements unresolved", () => {
    expect(resolveCurrentAreaIXTaskDAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
    expect(resolveCurrentAreaIXTaskDAktrCode("PA.IX.D.K3d")).toEqual({
      status: "unresolved",
      code: "PA.IX.D.K3D",
    });
    expect(resolveCurrentAreaIXTaskDAktrCode("PA.IX.D.K6")).toEqual({
      status: "unresolved",
      code: "PA.IX.D.K6",
    });
    expect(resolveCurrentAreaIXTaskDAktrCode("PA.IX.D.R4")).toEqual({
      status: "unresolved",
      code: "PA.IX.D.R4",
    });
    expect(resolveCurrentAreaIXTaskDAktrCode("PA.IX.D.S4")).toEqual({
      status: "unresolved",
      code: "PA.IX.D.S4",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIXTaskDAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIXTaskDAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
    expect(resolveCurrentAreaIXTaskDAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
