import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_D_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_D_SOURCE,
  resolveCurrentAreaIITaskDAktrCode,
} from "./currentAcsAreaIITaskDCatalog";

describe("Private Pilot Airplane ACS 6C Area II Task D (PA.II.D) catalog slice", () => {
  const expectedCodes = [
    "PA.II.D.K1",
    "PA.II.D.K2",
    "PA.II.D.K3",
    "PA.II.D.K4",
    "PA.II.D.K5",
    "PA.II.D.K6",
    "PA.II.D.K6a",
    "PA.II.D.K6b",
    "PA.II.D.K6c",
    "PA.II.D.K6d",
    "PA.II.D.K6e",
    "PA.II.D.R1",
    "PA.II.D.R2",
    "PA.II.D.R3",
    "PA.II.D.R4",
    "PA.II.D.S1",
    "PA.II.D.S2",
    "PA.II.D.S3",
    "PA.II.D.S4",
    "PA.II.D.S5",
    "PA.II.D.S6",
    "PA.II.D.S7",
    "PA.II.D.S8",
  ] as const;

  it("contains exactly the 23 verified Area II Task D codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_D_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(23);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_D_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("II");
      expect(entry.task).toBe("D");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_D_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.II.D coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_D_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPage: 13,
      pdfPage: 21,
      areaOfOperation: "Area of Operation II: Preflight Procedures",
      task: "Task D. Taxiing (ASEL, AMEL)",
      coverageLabel: "PA.II.D",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.II.D.K1":
        "Current airport aeronautical references and information resources such as the Chart Supplement, airport diagram, and Notices to Air Missions (NOTAMs).",
      "PA.II.D.K2": "Taxi instructions/clearances.",
      "PA.II.D.K3": "Airport markings, signs, and lights.",
      "PA.II.D.K4": "Visual indicators for wind.",
      "PA.II.D.K5": "Aircraft lighting, as appropriate.",
      "PA.II.D.K6": "Procedures for:",
      "PA.II.D.K6a":
        "Appropriate flight deck activities prior to taxi, including route planning and identifying the location of Hot Spots",
      "PA.II.D.K6b": "Radio communications at towered and nontowered airports",
      "PA.II.D.K6c": "Entering or crossing runways",
      "PA.II.D.K6d": "Night taxi operations",
      "PA.II.D.K6e": "Low visibility taxi operations",
      "PA.II.D.R1": "Activities and distractions.",
      "PA.II.D.R2": "Confirmation or expectation bias as related to taxi instructions.",
      "PA.II.D.R3": "A taxi route or departure runway change.",
      "PA.II.D.R4": "Runway incursion.",
      "PA.II.D.S1": "Receive and correctly read back clearances/instructions, if applicable.",
      "PA.II.D.S2":
        "Use an airport diagram or taxi chart during taxi, if published, and maintain situational awareness.",
      "PA.II.D.S3": "Position the flight controls for the existing wind, if applicable.",
      "PA.II.D.S4": "Complete the appropriate checklist(s).",
      "PA.II.D.S5": "Perform a brake check immediately after the airplane begins moving.",
      "PA.II.D.S6":
        "Maintain positive control of the airplane during ground operations by controlling direction and speed without excessive use of brakes.",
      "PA.II.D.S7":
        "Comply with airport/taxiway markings, signals, and air traffic control (ATC) clearances and instructions.",
      "PA.II.D.S8": "Position the airplane properly relative to hold lines.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_D_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area II Task D code with case-insensitive ASCII matching", () => {
    const resK1 = resolveCurrentAreaIITaskDAktrCode("pa.ii.d.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.D.K1",
        description:
          "Current airport aeronautical references and information resources such as the Chart Supplement, airport diagram, and Notices to Air Missions (NOTAMs).",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "II",
        task: "D",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_D_SOURCE,
      },
    });

    const resK6a = resolveCurrentAreaIITaskDAktrCode("pa.ii.d.k6a");
    expect(resK6a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.D.K6a",
        description:
          "Appropriate flight deck activities prior to taxi, including route planning and identifying the location of Hot Spots",
      },
    });

    const resR2 = resolveCurrentAreaIITaskDAktrCode("PA.II.D.R2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.D.R2",
        description: "Confirmation or expectation bias as related to taxi instructions.",
      },
    });

    const resS6 = resolveCurrentAreaIITaskDAktrCode("pa.ii.d.s6");
    expect(resS6).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.D.S6",
        description:
          "Maintain positive control of the airplane during ground operations by controlling direction and speed without excessive use of brakes.",
      },
    });
  });

  it("leaves out-of-slice current codes unresolved (including Area I Tasks and Area II Tasks A–C)", () => {
    // Area I Task A
    expect(resolveCurrentAreaIITaskDAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
    // Area I Task B
    expect(resolveCurrentAreaIITaskDAktrCode("PA.I.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.B.K1",
    });
    // Area I Task C
    expect(resolveCurrentAreaIITaskDAktrCode("PA.I.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.C.K1",
    });
    // Area I Task D
    expect(resolveCurrentAreaIITaskDAktrCode("PA.I.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.D.K1",
    });
    // Area I Task E
    expect(resolveCurrentAreaIITaskDAktrCode("PA.I.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.E.K1",
    });
    // Area I Task F
    expect(resolveCurrentAreaIITaskDAktrCode("PA.I.F.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.F.K1",
    });
    // Area I Task G
    expect(resolveCurrentAreaIITaskDAktrCode("PA.I.G.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.G.K1",
    });
    // Area I Task H
    expect(resolveCurrentAreaIITaskDAktrCode("PA.I.H.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.H.K1",
    });
    // Area I Task I
    expect(resolveCurrentAreaIITaskDAktrCode("PA.I.I.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.I.K1",
    });
    // Area II Task A
    expect(resolveCurrentAreaIITaskDAktrCode("PA.II.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.A.K1",
    });
    // Area II Task B
    expect(resolveCurrentAreaIITaskDAktrCode("PA.II.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.B.K1",
    });
    // Area II Task C
    expect(resolveCurrentAreaIITaskDAktrCode("PA.II.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.C.K1",
    });
    // Future Area II Task E
    expect(resolveCurrentAreaIITaskDAktrCode("PA.II.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.E.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    expect(resolveCurrentAreaIITaskDAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIITaskDAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIITaskDAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
