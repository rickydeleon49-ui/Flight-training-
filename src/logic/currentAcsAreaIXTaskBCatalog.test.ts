import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_B_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_B_SOURCE,
  resolveCurrentAreaIXTaskBAktrCode,
} from "./currentAcsAreaIXTaskBCatalog";

describe("Private Pilot Airplane ACS 6C Area IX Task B (PA.IX.B) catalog slice", () => {
  const expectedCodes = [
    "PA.IX.B.K1",
    "PA.IX.B.K2",
    "PA.IX.B.K2a",
    "PA.IX.B.K2b",
    "PA.IX.B.K2c",
    "PA.IX.B.K3",
    "PA.IX.B.K4",
    "PA.IX.B.K5",
    "PA.IX.B.K6",
    "PA.IX.B.R1",
    "PA.IX.B.R2",
    "PA.IX.B.R3",
    "PA.IX.B.R4",
    "PA.IX.B.R5",
    "PA.IX.B.R6",
    "PA.IX.B.S1",
    "PA.IX.B.S2",
    "PA.IX.B.S3",
    "PA.IX.B.S4",
    "PA.IX.B.S5",
    "PA.IX.B.S6",
  ] as const;

  it("contains exactly the 21 verified Area IX Task B codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_B_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(21);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_B_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IX");
      expect(entry.task).toBe("B");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_B_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IX.B coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_B_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "52–53",
      pdfPages: "59–60",
      areaOfOperation: "Area of Operation IX: Emergency Operations",
      task: "Task B. Emergency Approach and Landing (Simulated) (ASEL, ASES)",
      coverageLabel: "PA.IX.B",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IX.B.K1": "Immediate action items and emergency procedures.",
      "PA.IX.B.K2": "Airspeed, including:",
      "PA.IX.B.K2a": "Importance of best glide speed and its relationship to distance",
      "PA.IX.B.K2b": "Difference between best glide speed and minimum sink speed",
      "PA.IX.B.K2c": "Effects of wind on glide distance",
      "PA.IX.B.K3": "Effects of atmospheric conditions on emergency approach and landing.",
      "PA.IX.B.K4": "A stabilized approach, including energy management concepts.",
      "PA.IX.B.K5": "Emergency Locator Transmitters (ELTs) and other emergency locating devices.",
      "PA.IX.B.K6": "Air traffic control (ATC) services to aircraft in distress.",
      "PA.IX.B.R1":
        "Altitude, wind, terrain, obstructions, gliding distance, and available landing distance considerations.",
      "PA.IX.B.R2": "Following or changing the planned flightpath to the selected landing area.",
      "PA.IX.B.R3": "Collision hazards.",
      "PA.IX.B.R4": "Configuring the airplane.",
      "PA.IX.B.R5":
        "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IX.B.R6":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IX.B.S1": "Establish and maintain the recommended best glide airspeed, ±10 knots.",
      "PA.IX.B.S2":
        "Configure the airplane in accordance with the Pilot's Operating Handbook (POH)/Airplane Flight Manual (AFM) and existing conditions.",
      "PA.IX.B.S3":
        "Select a suitable landing area considering altitude, wind, terrain, obstructions, and available glide distance.",
      "PA.IX.B.S4":
        "Plan and follow a flightpath to the selected landing area considering altitude, wind, terrain, and obstructions.",
      "PA.IX.B.S5": "Prepare for landing as specified by the evaluator.",
      "PA.IX.B.S6": "Complete the appropriate checklist(s).",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_B_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area IX Task B code with case-insensitive ASCII matching", () => {
    // Knowledge codes
    const resK1 = resolveCurrentAreaIXTaskBAktrCode("pa.ix.b.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.K1",
        description: "Immediate action items and emergency procedures.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "IX",
        task: "B",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_B_SOURCE,
      },
    });

    const resK2 = resolveCurrentAreaIXTaskBAktrCode("PA.IX.B.K2");
    expect(resK2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.K2",
        description: "Airspeed, including:",
      },
    });

    const resK2a = resolveCurrentAreaIXTaskBAktrCode("pa.ix.b.k2a");
    expect(resK2a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.K2a",
        description: "Importance of best glide speed and its relationship to distance",
      },
    });

    const resK2b = resolveCurrentAreaIXTaskBAktrCode("PA.IX.B.K2B");
    expect(resK2b).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.K2b",
        description: "Difference between best glide speed and minimum sink speed",
      },
    });

    const resK2c = resolveCurrentAreaIXTaskBAktrCode("pa.ix.b.k2c");
    expect(resK2c).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.K2c",
        description: "Effects of wind on glide distance",
      },
    });

    const resK3 = resolveCurrentAreaIXTaskBAktrCode("PA.IX.B.K3");
    expect(resK3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.K3",
        description: "Effects of atmospheric conditions on emergency approach and landing.",
      },
    });

    const resK4 = resolveCurrentAreaIXTaskBAktrCode("pa.ix.b.k4");
    expect(resK4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.K4",
        description: "A stabilized approach, including energy management concepts.",
      },
    });

    const resK5 = resolveCurrentAreaIXTaskBAktrCode("PA.IX.B.K5");
    expect(resK5).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.K5",
        description: "Emergency Locator Transmitters (ELTs) and other emergency locating devices.",
      },
    });

    const resK6 = resolveCurrentAreaIXTaskBAktrCode("pa.ix.b.k6");
    expect(resK6).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.K6",
        description: "Air traffic control (ATC) services to aircraft in distress.",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaIXTaskBAktrCode("pa.ix.b.r1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.R1",
        description:
          "Altitude, wind, terrain, obstructions, gliding distance, and available landing distance considerations.",
      },
    });

    const resR2 = resolveCurrentAreaIXTaskBAktrCode("PA.IX.B.R2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.R2",
        description: "Following or changing the planned flightpath to the selected landing area.",
      },
    });

    const resR3 = resolveCurrentAreaIXTaskBAktrCode("pa.ix.b.r3");
    expect(resR3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.R3",
        description: "Collision hazards.",
      },
    });

    const resR4 = resolveCurrentAreaIXTaskBAktrCode("PA.IX.B.R4");
    expect(resR4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.R4",
        description: "Configuring the airplane.",
      },
    });

    const resR5 = resolveCurrentAreaIXTaskBAktrCode("pa.ix.b.r5");
    expect(resR5).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.R5",
        description:
          "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      },
    });

    const resR6 = resolveCurrentAreaIXTaskBAktrCode("PA.IX.B.R6");
    expect(resR6).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.R6",
        description:
          "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      },
    });

    // Skill codes
    const resS1 = resolveCurrentAreaIXTaskBAktrCode("pa.ix.b.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.S1",
        description: "Establish and maintain the recommended best glide airspeed, ±10 knots.",
      },
    });

    const resS2 = resolveCurrentAreaIXTaskBAktrCode("PA.IX.B.S2");
    expect(resS2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.S2",
        description:
          "Configure the airplane in accordance with the Pilot's Operating Handbook (POH)/Airplane Flight Manual (AFM) and existing conditions.",
      },
    });

    const resS3 = resolveCurrentAreaIXTaskBAktrCode("pa.ix.b.s3");
    expect(resS3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.S3",
        description:
          "Select a suitable landing area considering altitude, wind, terrain, obstructions, and available glide distance.",
      },
    });

    const resS4 = resolveCurrentAreaIXTaskBAktrCode("PA.IX.B.S4");
    expect(resS4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.S4",
        description:
          "Plan and follow a flightpath to the selected landing area considering altitude, wind, terrain, and obstructions.",
      },
    });

    const resS5 = resolveCurrentAreaIXTaskBAktrCode("pa.ix.b.s5");
    expect(resS5).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.S5",
        description: "Prepare for landing as specified by the evaluator.",
      },
    });

    const resS6 = resolveCurrentAreaIXTaskBAktrCode("PA.IX.B.S6");
    expect(resS6).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.B.S6",
        description: "Complete the appropriate checklist(s).",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area IX Task A
    expect(resolveCurrentAreaIXTaskBAktrCode("PA.IX.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.A.K1",
    });
    expect(resolveCurrentAreaIXTaskBAktrCode("PA.IX.A.S1")).toEqual({
      status: "unresolved",
      code: "PA.IX.A.S1",
    });

    // Area IX Task C
    expect(resolveCurrentAreaIXTaskBAktrCode("PA.IX.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.C.K1",
    });

    // Area VIII Task A
    expect(resolveCurrentAreaIXTaskBAktrCode("PA.VIII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaIXTaskBAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    expect(resolveCurrentAreaIXTaskBAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
    expect(resolveCurrentAreaIXTaskBAktrCode("PA.IX.C.K1a")).toEqual({
      status: "unresolved",
      code: "PA.IX.C.K1A",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIXTaskBAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIXTaskBAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
