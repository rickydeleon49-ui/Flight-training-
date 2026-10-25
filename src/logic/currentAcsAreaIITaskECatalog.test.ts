import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_E_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_E_SOURCE,
  resolveCurrentAreaIITaskEAktrCode,
} from "./currentAcsAreaIITaskECatalog";

describe("Private Pilot Airplane ACS 6C Area II Task E (PA.II.E) catalog slice", () => {
  const expectedCodes = [
    "PA.II.E.K1",
    "PA.II.E.K2",
    "PA.II.E.K3",
    "PA.II.E.K4",
    "PA.II.E.K5",
    "PA.II.E.K6",
    "PA.II.E.K6a",
    "PA.II.E.K6b",
    "PA.II.E.R1",
    "PA.II.E.R2",
    "PA.II.E.R3",
    "PA.II.E.R4",
    "PA.II.E.R5",
    "PA.II.E.S1",
    "PA.II.E.S2",
    "PA.II.E.S3",
    "PA.II.E.S4",
    "PA.II.E.S5",
    "PA.II.E.S6",
    "PA.II.E.S7",
    "PA.II.E.S8",
    "PA.II.E.S9",
    "PA.II.E.S10",
  ] as const;

  it("contains exactly the 23 verified Area II Task E codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_E_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(23);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_E_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("II");
      expect(entry.task).toBe("E");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_E_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.II.E coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_E_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "14–15",
      pdfPages: "22–23",
      areaOfOperation: "Area of Operation II: Preflight Procedures",
      task: "Task E. Taxiing and Sailing (ASES, AMES)",
      coverageLabel: "PA.II.E",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.II.E.K1":
        "Airport information resources, including Chart Supplements, airport diagram, and appropriate references.",
      "PA.II.E.K2": "Taxi instructions/clearances.",
      "PA.II.E.K3": "Airport/seaplane base markings, signs, and lights.",
      "PA.II.E.K4": "Visual indicators for wind.",
      "PA.II.E.K5": "Airplane lighting.",
      "PA.II.E.K6": "Procedures for:",
      "PA.II.E.K6a": "Appropriate flight deck activities during taxiing or sailing",
      "PA.II.E.K6b": "Radio communications at towered and nontowered seaplane bases",
      "PA.II.E.R1": "Activities and distractions.",
      "PA.II.E.R2": "Porpoising and skipping.",
      "PA.II.E.R3": "Low visibility taxi and sailing operations.",
      "PA.II.E.R4": "Other aircraft, vessels, and hazards.",
      "PA.II.E.R5": "Confirmation or expectation bias as related to taxi instructions.",
      "PA.II.E.S1": "Receive and correctly read back clearances/instructions, if applicable.",
      "PA.II.E.S2": "Use an appropriate airport diagram or taxi chart, if published.",
      "PA.II.E.S3": "Comply with seaplane base/airport/taxiway markings, signals, and signs.",
      "PA.II.E.S4":
        "Depart the dock/mooring buoy or beach/ramp in a safe manner, considering wind, current, traffic, and hazards.",
      "PA.II.E.S5": "Complete the appropriate checklist(s).",
      "PA.II.E.S6":
        "Position the flight controls, flaps, doors, water rudders, and power correctly for the existing conditions to follow the desired course while sailing and to prevent or correct for porpoising and skipping during step taxi.",
      "PA.II.E.S7":
        "Exhibit procedures for steering and maneuvering while maintaining proper situational awareness and desired orientation, path, and position while taxiing using idle, plow, or step taxi technique, as appropriate.",
      "PA.II.E.S8": "Plan and follow the most favorable taxi or sailing course for current conditions.",
      "PA.II.E.S9":
        "Abide by right-of-way rules, maintain positive airplane control, proper speed, and separation between other aircraft, vessels, and persons.",
      "PA.II.E.S10":
        "Comply with applicable taxi elements in Task D if the practical test is conducted in an amphibious airplane.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_E_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area II Task E code with case-insensitive ASCII matching", () => {
    const resK1 = resolveCurrentAreaIITaskEAktrCode("pa.ii.e.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.E.K1",
        description:
          "Airport information resources, including Chart Supplements, airport diagram, and appropriate references.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "II",
        task: "E",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_E_SOURCE,
      },
    });

    const resK6a = resolveCurrentAreaIITaskEAktrCode("pa.ii.e.k6a");
    expect(resK6a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.E.K6a",
        description: "Appropriate flight deck activities during taxiing or sailing",
      },
    });

    const resR2 = resolveCurrentAreaIITaskEAktrCode("PA.II.E.R2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.E.R2",
        description: "Porpoising and skipping.",
      },
    });

    const resS6 = resolveCurrentAreaIITaskEAktrCode("pa.ii.e.s6");
    expect(resS6).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.E.S6",
        description:
          "Position the flight controls, flaps, doors, water rudders, and power correctly for the existing conditions to follow the desired course while sailing and to prevent or correct for porpoising and skipping during step taxi.",
      },
    });

    const resS9 = resolveCurrentAreaIITaskEAktrCode("pa.ii.e.s9");
    expect(resS9).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.E.S9",
        description:
          "Abide by right-of-way rules, maintain positive airplane control, proper speed, and separation between other aircraft, vessels, and persons.",
      },
    });

    const resS10 = resolveCurrentAreaIITaskEAktrCode("PA.II.E.S10");
    expect(resS10).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.E.S10",
        description:
          "Comply with applicable taxi elements in Task D if the practical test is conducted in an amphibious airplane.",
      },
    });
  });

  it("leaves out-of-slice current codes unresolved (including Area I Tasks and Area II Tasks A–D)", () => {
    // Area I Tasks
    expect(resolveCurrentAreaIITaskEAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
    expect(resolveCurrentAreaIITaskEAktrCode("PA.I.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.B.K1",
    });
    expect(resolveCurrentAreaIITaskEAktrCode("PA.I.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.C.K1",
    });
    expect(resolveCurrentAreaIITaskEAktrCode("PA.I.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.D.K1",
    });
    expect(resolveCurrentAreaIITaskEAktrCode("PA.I.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.E.K1",
    });
    expect(resolveCurrentAreaIITaskEAktrCode("PA.I.F.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.F.K1",
    });
    expect(resolveCurrentAreaIITaskEAktrCode("PA.I.G.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.G.K1",
    });
    expect(resolveCurrentAreaIITaskEAktrCode("PA.I.H.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.H.K1",
    });
    expect(resolveCurrentAreaIITaskEAktrCode("PA.I.I.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.I.K1",
    });

    // Area II Tasks A–D
    expect(resolveCurrentAreaIITaskEAktrCode("PA.II.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.A.K1",
    });
    expect(resolveCurrentAreaIITaskEAktrCode("PA.II.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.B.K1",
    });
    expect(resolveCurrentAreaIITaskEAktrCode("PA.II.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.C.K1",
    });
    expect(resolveCurrentAreaIITaskEAktrCode("PA.II.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.D.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    expect(resolveCurrentAreaIITaskEAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIITaskEAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIITaskEAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
