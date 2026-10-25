import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_A_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_A_SOURCE,
  resolveCurrentAreaIXTaskAAktrCode,
} from "./currentAcsAreaIXTaskACatalog";

describe("Private Pilot Airplane ACS 6C Area IX Task A (PA.IX.A) catalog slice", () => {
  const expectedCodes = [
    "PA.IX.A.K1",
    "PA.IX.A.K2",
    "PA.IX.A.K3",
    "PA.IX.A.K4",
    "PA.IX.A.R1",
    "PA.IX.A.R2",
    "PA.IX.A.R3",
    "PA.IX.A.R4",
    "PA.IX.A.S1",
    "PA.IX.A.S2",
    "PA.IX.A.S3",
    "PA.IX.A.S4",
    "PA.IX.A.S5",
    "PA.IX.A.S6",
    "PA.IX.A.S7",
    "PA.IX.A.S8",
  ] as const;

  it("contains exactly the 16 verified Area IX Task A codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_A_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(16);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_A_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IX");
      expect(entry.task).toBe("A");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_A_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IX.A coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_A_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "51–52",
      pdfPages: "58–59",
      areaOfOperation: "Area of Operation IX: Emergency Operations",
      task: "Task A. Emergency Descent",
      coverageLabel: "PA.IX.A",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IX.A.K1":
        "Situations that would require an emergency descent (e.g., depressurization, smoke, or engine fire).",
      "PA.IX.A.K2": "Immediate action items and emergency procedures.",
      "PA.IX.A.K3": "Airspeed, including airspeed limitations.",
      "PA.IX.A.K4": "Aircraft performance and limitations.",
      "PA.IX.A.R1":
        "Altitude, wind, terrain, obstructions, gliding distance, and available landing distance considerations.",
      "PA.IX.A.R2": "Collision hazards.",
      "PA.IX.A.R3": "Configuring the airplane.",
      "PA.IX.A.R4":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IX.A.S1": "Clear the area.",
      "PA.IX.A.S2":
        "Establish and maintain the appropriate airspeed and configuration appropriate to the scenario specified by the evaluator and as covered in Pilot's Operating Handbook (POH)/Airplane Flight Manual (AFM) for the emergency descent.",
      "PA.IX.A.S3":
        "Maintain orientation, divide attention appropriately, and plan and execute a smooth recovery.",
      "PA.IX.A.S4":
        "Use bank angle between 30° and 45° to maintain positive load factors during the descent.",
      "PA.IX.A.S5":
        "Maintain appropriate airspeed +0/-10 knots, and level off at a specified altitude ±100 feet.",
      "PA.IX.A.S6": "Complete the appropriate checklist(s).",
      "PA.IX.A.S7": "Make radio calls as appropriate.",
      "PA.IX.A.S8":
        "Use single-pilot resource management (SRM) or crew resource management (CRM), as appropriate.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_A_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area IX Task A code with case-insensitive ASCII matching", () => {
    // Knowledge codes
    const resK1 = resolveCurrentAreaIXTaskAAktrCode("pa.ix.a.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.A.K1",
        description:
          "Situations that would require an emergency descent (e.g., depressurization, smoke, or engine fire).",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "IX",
        task: "A",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_A_SOURCE,
      },
    });

    const resK2 = resolveCurrentAreaIXTaskAAktrCode("PA.IX.A.K2");
    expect(resK2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.A.K2",
        description: "Immediate action items and emergency procedures.",
      },
    });

    const resK3 = resolveCurrentAreaIXTaskAAktrCode("pa.ix.a.k3");
    expect(resK3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.A.K3",
        description: "Airspeed, including airspeed limitations.",
      },
    });

    const resK4 = resolveCurrentAreaIXTaskAAktrCode("PA.IX.A.K4");
    expect(resK4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.A.K4",
        description: "Aircraft performance and limitations.",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaIXTaskAAktrCode("PA.IX.A.R1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.A.R1",
        description:
          "Altitude, wind, terrain, obstructions, gliding distance, and available landing distance considerations.",
      },
    });

    const resR2 = resolveCurrentAreaIXTaskAAktrCode("pa.ix.a.r2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.A.R2",
        description: "Collision hazards.",
      },
    });

    const resR3 = resolveCurrentAreaIXTaskAAktrCode("PA.IX.A.R3");
    expect(resR3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.A.R3",
        description: "Configuring the airplane.",
      },
    });

    const resR4 = resolveCurrentAreaIXTaskAAktrCode("pa.ix.a.r4");
    expect(resR4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.A.R4",
        description:
          "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      },
    });

    // Skill codes
    const resS1 = resolveCurrentAreaIXTaskAAktrCode("pa.ix.a.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.A.S1",
        description: "Clear the area.",
      },
    });

    const resS2 = resolveCurrentAreaIXTaskAAktrCode("PA.IX.A.S2");
    expect(resS2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.A.S2",
        description:
          "Establish and maintain the appropriate airspeed and configuration appropriate to the scenario specified by the evaluator and as covered in Pilot's Operating Handbook (POH)/Airplane Flight Manual (AFM) for the emergency descent.",
      },
    });

    const resS3 = resolveCurrentAreaIXTaskAAktrCode("pa.ix.a.s3");
    expect(resS3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.A.S3",
        description:
          "Maintain orientation, divide attention appropriately, and plan and execute a smooth recovery.",
      },
    });

    const resS4 = resolveCurrentAreaIXTaskAAktrCode("PA.IX.A.S4");
    expect(resS4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.A.S4",
        description:
          "Use bank angle between 30° and 45° to maintain positive load factors during the descent.",
      },
    });

    const resS5 = resolveCurrentAreaIXTaskAAktrCode("pa.ix.a.s5");
    expect(resS5).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.A.S5",
        description:
          "Maintain appropriate airspeed +0/-10 knots, and level off at a specified altitude ±100 feet.",
      },
    });

    const resS6 = resolveCurrentAreaIXTaskAAktrCode("PA.IX.A.S6");
    expect(resS6).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.A.S6",
        description: "Complete the appropriate checklist(s).",
      },
    });

    const resS7 = resolveCurrentAreaIXTaskAAktrCode("pa.ix.a.s7");
    expect(resS7).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.A.S7",
        description: "Make radio calls as appropriate.",
      },
    });

    const resS8 = resolveCurrentAreaIXTaskAAktrCode("PA.IX.A.S8");
    expect(resS8).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.A.S8",
        description:
          "Use single-pilot resource management (SRM) or crew resource management (CRM), as appropriate.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area IX Task B
    expect(resolveCurrentAreaIXTaskAAktrCode("PA.IX.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.B.K1",
    });
    expect(resolveCurrentAreaIXTaskAAktrCode("PA.IX.B.S1")).toEqual({
      status: "unresolved",
      code: "PA.IX.B.S1",
    });

    // Area VIII Task A
    expect(resolveCurrentAreaIXTaskAAktrCode("PA.VIII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaIXTaskAAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    expect(resolveCurrentAreaIXTaskAAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
    expect(resolveCurrentAreaIXTaskAAktrCode("PA.IX.C.K1a")).toEqual({
      status: "unresolved",
      code: "PA.IX.C.K1A",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIXTaskAAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIXTaskAAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
