import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_TASK_G_CODES,
  PRIVATE_AIRPLANE_ACS_6C_TASK_G_SOURCE,
  resolveCurrentTaskGAktrCode,
} from "./currentAcsTaskGCatalog";

describe("Private Pilot Airplane ACS 6C Task G (PA.I.G) catalog slice", () => {
  const expectedCodes = [
    "PA.I.G.K1",
    "PA.I.G.K1a",
    "PA.I.G.K1b",
    "PA.I.G.K1c",
    "PA.I.G.K1d",
    "PA.I.G.K1e",
    "PA.I.G.K1f",
    "PA.I.G.K1g",
    "PA.I.G.K1h",
    "PA.I.G.K1i",
    "PA.I.G.K1j",
    "PA.I.G.K1k",
    "PA.I.G.K1l",
    "PA.I.G.K2",
    "PA.I.G.R1",
    "PA.I.G.R2",
    "PA.I.G.R3",
    "PA.I.G.S1",
    "PA.I.G.S2",
  ] as const;

  it("contains exactly the 19 verified Task G codes once each with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_TASK_G_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(19);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_G_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("I");
      expect(entry.task).toBe("G");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_TASK_G_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.I.G coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_TASK_G_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "7",
      pdfPages: "15",
      areaOfOperation: "Area of Operation I: Preflight Preparation",
      task: "Task G. Operation of Systems",
      coverageLabel: "PA.I.G",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.I.G.K1": "Airplane systems, including:",
      "PA.I.G.K1a": "Primary flight controls",
      "PA.I.G.K1b": "Secondary flight controls",
      "PA.I.G.K1c": "Powerplant and propeller",
      "PA.I.G.K1d": "Landing gear",
      "PA.I.G.K1e": "Fuel, oil, and hydraulic",
      "PA.I.G.K1f": "Electrical",
      "PA.I.G.K1g": "Avionics",
      "PA.I.G.K1h": "Pitot-static, vacuum/pressure, and associated flight instruments",
      "PA.I.G.K1i": "Environmental",
      "PA.I.G.K1j": "Deicing and anti-icing",
      "PA.I.G.K1k": "Water rudders (ASES, AMES)",
      "PA.I.G.K1l": "Oxygen system",
      "PA.I.G.K2": "Indications of and procedures for managing system abnormalities or failures.",
      "PA.I.G.R1": "Detection of system malfunctions or failures.",
      "PA.I.G.R2": "Management of a system failure.",
      "PA.I.G.R3": "Monitoring and management of automated systems.",
      "PA.I.G.S1": "Operate at least three of the systems listed in K1a through K1l appropriately.",
      "PA.I.G.S2": "Complete the appropriate checklist(s).",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_G_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Task G code with case-insensitive ASCII matching", () => {
    const res = resolveCurrentTaskGAktrCode("pa.i.g.k1");
    expect(res).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.G.K1",
        description: "Airplane systems, including:",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        source: PRIVATE_AIRPLANE_ACS_6C_TASK_G_SOURCE,
      },
    });

    const resUpper = resolveCurrentTaskGAktrCode("PA.I.G.S2");
    expect(resUpper).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.G.S2",
        description: "Complete the appropriate checklist(s).",
      },
    });

    const resSub = resolveCurrentTaskGAktrCode("pa.i.g.k1k");
    expect(resSub).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.G.K1k",
        description: "Water rudders (ASES, AMES)",
      },
    });
  });

  it("leaves out-of-slice current codes unresolved (including Tasks A, B, C, D, E, and F)", () => {
    // PA.I.A.K1 is Task A
    expect(resolveCurrentTaskGAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });

    // PA.I.B.K1 is Task B
    expect(resolveCurrentTaskGAktrCode("PA.I.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.B.K1",
    });

    // PA.I.C.K1 is Task C
    expect(resolveCurrentTaskGAktrCode("PA.I.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.C.K1",
    });

    // PA.I.D.K1 is Task D
    expect(resolveCurrentTaskGAktrCode("PA.I.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.D.K1",
    });

    // PA.I.E.K1 is Task E
    expect(resolveCurrentTaskGAktrCode("PA.I.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.E.K1",
    });

    // PA.I.F.K1 is Task F
    expect(resolveCurrentTaskGAktrCode("PA.I.F.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.F.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    // PA.III.A.R3 is an archived code in the archived catalog
    expect(resolveCurrentTaskGAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentTaskGAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentTaskGAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
