import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_F_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_F_SOURCE,
  resolveCurrentAreaIITaskFAktrCode,
} from "./currentAcsAreaIITaskFCatalog";

describe("Private Pilot Airplane ACS 6C Area II Task F (PA.II.F) catalog slice", () => {
  const expectedCodes = [
    "PA.II.F.K1",
    "PA.II.F.K1a",
    "PA.II.F.K1b",
    "PA.II.F.K1c",
    "PA.II.F.R1",
    "PA.II.F.R2",
    "PA.II.F.R3",
    "PA.II.F.R4",
    "PA.II.F.S1",
    "PA.II.F.S2",
    "PA.II.F.S3",
    "PA.II.F.S4",
    "PA.II.F.S5",
  ] as const;

  it("contains exactly the 13 verified Area II Task F codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_F_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(13);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_F_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("II");
      expect(entry.task).toBe("F");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_F_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.II.F coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_F_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "15",
      pdfPages: "23",
      areaOfOperation: "Area of Operation II: Preflight Procedures",
      task: "Task F. Before Takeoff Check",
      coverageLabel: "PA.II.F",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.II.F.K1": "Purpose of before takeoff checklist items, including:",
      "PA.II.F.K1a": "Reasons for checking each item",
      "PA.II.F.K1b": "Detecting malfunctions",
      "PA.II.F.K1c":
        "Ensuring the aircraft is in safe operating condition as recommended by the manufacturer",
      "PA.II.F.R1": "Division of attention while conducting before takeoff checks.",
      "PA.II.F.R2": "Unexpected runway changes by air traffic control (ATC).",
      "PA.II.F.R3": "Wake turbulence.",
      "PA.II.F.R4":
        "Potential powerplant failure during takeoff or other malfunction considering operational factors such as airplane characteristics, runway/takeoff path length, surface conditions, environmental conditions, and obstructions.",
      "PA.II.F.S1": "Review takeoff performance.",
      "PA.II.F.S2": "Complete the appropriate checklist(s).",
      "PA.II.F.S3":
        "Position the airplane appropriately considering wind direction and the presence of any aircraft, vessels, or buildings as applicable.",
      "PA.II.F.S4": "Divide attention inside and outside the flight deck.",
      "PA.II.F.S5": "Verify that engine parameters and airplane configuration are suitable.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_F_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area II Task F code with case-insensitive ASCII matching", () => {
    const resK1 = resolveCurrentAreaIITaskFAktrCode("pa.ii.f.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.F.K1",
        description: "Purpose of before takeoff checklist items, including:",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "II",
        task: "F",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_F_SOURCE,
      },
    });

    const resK1a = resolveCurrentAreaIITaskFAktrCode("pa.ii.f.k1a");
    expect(resK1a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.F.K1a",
        description: "Reasons for checking each item",
      },
    });

    const resK1b = resolveCurrentAreaIITaskFAktrCode("PA.II.F.K1B");
    expect(resK1b).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.F.K1b",
        description: "Detecting malfunctions",
      },
    });

    const resK1c = resolveCurrentAreaIITaskFAktrCode("pa.ii.f.k1c");
    expect(resK1c).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.F.K1c",
        description:
          "Ensuring the aircraft is in safe operating condition as recommended by the manufacturer",
      },
    });

    const resR1 = resolveCurrentAreaIITaskFAktrCode("PA.II.F.R1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.F.R1",
        description: "Division of attention while conducting before takeoff checks.",
      },
    });

    const resR4 = resolveCurrentAreaIITaskFAktrCode("pa.ii.f.r4");
    expect(resR4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.F.R4",
        description:
          "Potential powerplant failure during takeoff or other malfunction considering operational factors such as airplane characteristics, runway/takeoff path length, surface conditions, environmental conditions, and obstructions.",
      },
    });

    const resS1 = resolveCurrentAreaIITaskFAktrCode("pa.ii.f.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.F.S1",
        description: "Review takeoff performance.",
      },
    });

    const resS5 = resolveCurrentAreaIITaskFAktrCode("PA.II.F.S5");
    expect(resS5).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.F.S5",
        description: "Verify that engine parameters and airplane configuration are suitable.",
      },
    });
  });

  it("leaves out-of-slice current codes unresolved (including Area II Task E and Task G)", () => {
    // Area II Task E codes
    expect(resolveCurrentAreaIITaskFAktrCode("PA.II.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.E.K1",
    });
    expect(resolveCurrentAreaIITaskFAktrCode("PA.II.E.S1")).toEqual({
      status: "unresolved",
      code: "PA.II.E.S1",
    });

    // Area II Task G code
    expect(resolveCurrentAreaIITaskFAktrCode("PA.II.G.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.G.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaIITaskFAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    expect(resolveCurrentAreaIITaskFAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIITaskFAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIITaskFAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
