import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_TASK_I_CODES,
  PRIVATE_AIRPLANE_ACS_6C_TASK_I_SOURCE,
  resolveCurrentTaskIAktrCode,
} from "./currentAcsTaskICatalog";

describe("Private Pilot Airplane ACS 6C Task I (PA.I.I) catalog slice", () => {
  const expectedCodes = [
    "PA.I.I.K1",
    "PA.I.I.K1a",
    "PA.I.I.K1b",
    "PA.I.I.K1c",
    "PA.I.I.K1d",
    "PA.I.I.K1e",
    "PA.I.I.K1f",
    "PA.I.I.K1g",
    "PA.I.I.K1h",
    "PA.I.I.K1i",
    "PA.I.I.K2",
    "PA.I.I.K3",
    "PA.I.I.K4",
    "PA.I.I.K5",
    "PA.I.I.K6",
    "PA.I.I.K7",
    "PA.I.I.K8",
    "PA.I.I.K9",
    "PA.I.I.R1",
    "PA.I.I.R2",
    "PA.I.I.R3",
    "PA.I.I.R4",
    "PA.I.I.S1",
    "PA.I.I.S2",
    "PA.I.I.S3",
    "PA.I.I.S4",
    "PA.I.I.S5",
    "PA.I.I.S6",
  ] as const;

  it("contains exactly the 28 verified Task I codes once each with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_TASK_I_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(28);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_I_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("I");
      expect(entry.task).toBe("I");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_TASK_I_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.I.I coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_TASK_I_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "9–10",
      pdfPages: "17–18",
      areaOfOperation: "Area of Operation I: Preflight Preparation",
      task: "Task I. Water and Seaplane Characteristics, Seaplane Bases, Maritime Rules, and Aids to Marine Navigation",
      coverageLabel: "PA.I.I",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.I.I.K1":
        "The characteristics of a water surface as affected by features, such as:",
      "PA.I.I.K1a": "Size and location",
      "PA.I.I.K1b": "Protected and unprotected areas",
      "PA.I.I.K1c": "Surface wind",
      "PA.I.I.K1d": "Direction and strength of water current",
      "PA.I.I.K1e": "Floating and partially submerged debris",
      "PA.I.I.K1f": "Sandbars, islands, and shoals",
      "PA.I.I.K1g": "Vessel traffic and wakes",
      "PA.I.I.K1h": "Other characteristics specific to the area",
      "PA.I.I.K1i": "Direction and height of waves",
      "PA.I.I.K2":
        "Float and hull construction, and its effect on seaplane performance.",
      "PA.I.I.K3":
        "Causes of porpoising and skipping, and the pilot action needed to prevent or correct these occurrences.",
      "PA.I.I.K4":
        "How to locate and identify seaplane bases on charts or in directories.",
      "PA.I.I.K5": "Operating restrictions at various bases.",
      "PA.I.I.K6":
        "Right-of-way, steering, and sailing rules pertinent to seaplane operation.",
      "PA.I.I.K7":
        "Marine navigation aids, such as buoys, beacons, lights, sound signals, and range markers.",
      "PA.I.I.K8": "Naval vessel protection zones.",
      "PA.I.I.K9": "No wake zones.",
      "PA.I.I.R1": "Local conditions.",
      "PA.I.I.R2": "Impact of marine traffic.",
      "PA.I.I.R3":
        "Right-of-way and sailing rules pertinent to seaplane operations.",
      "PA.I.I.R4":
        "Limited services and assistance available at seaplane bases.",
      "PA.I.I.S1":
        "Assess the water surface characteristics for the proposed flight.",
      "PA.I.I.S2": "Identify restrictions at local seaplane bases.",
      "PA.I.I.S3": "Identify marine navigation aids.",
      "PA.I.I.S4":
        "Describe correct right-of-way, steering, and sailing operations.",
      "PA.I.I.S5":
        "Explain how float and hull construction can affect seaplane performance.",
      "PA.I.I.S6": "Describe how to correct for porpoising and skipping.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_I_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Task I code with case-insensitive ASCII matching", () => {
    const res = resolveCurrentTaskIAktrCode("pa.i.i.k1");
    expect(res).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.I.K1",
        description:
          "The characteristics of a water surface as affected by features, such as:",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        source: PRIVATE_AIRPLANE_ACS_6C_TASK_I_SOURCE,
      },
    });

    const resUpper = resolveCurrentTaskIAktrCode("PA.I.I.S2");
    expect(resUpper).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.I.S2",
        description: "Identify restrictions at local seaplane bases.",
      },
    });

    const resContinuation = resolveCurrentTaskIAktrCode("pa.i.i.s6");
    expect(resContinuation).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.I.S6",
        description: "Describe how to correct for porpoising and skipping.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        source: PRIVATE_AIRPLANE_ACS_6C_TASK_I_SOURCE,
      },
    });

    const resSub = resolveCurrentTaskIAktrCode("pa.i.i.k1i");
    expect(resSub).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.I.K1i",
        description: "Direction and height of waves",
      },
    });
  });

  it("leaves out-of-slice current codes unresolved (including Tasks A, B, C, D, E, F, G, and H)", () => {
    // PA.I.A.K1 is Task A
    expect(resolveCurrentTaskIAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });

    // PA.I.B.K1 is Task B
    expect(resolveCurrentTaskIAktrCode("PA.I.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.B.K1",
    });

    // PA.I.C.K1 is Task C
    expect(resolveCurrentTaskIAktrCode("PA.I.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.C.K1",
    });

    // PA.I.D.K1 is Task D
    expect(resolveCurrentTaskIAktrCode("PA.I.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.D.K1",
    });

    // PA.I.E.K1 is Task E
    expect(resolveCurrentTaskIAktrCode("PA.I.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.E.K1",
    });

    // PA.I.F.K1 is Task F
    expect(resolveCurrentTaskIAktrCode("PA.I.F.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.F.K1",
    });

    // PA.I.G.K1 is Task G
    expect(resolveCurrentTaskIAktrCode("PA.I.G.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.G.K1",
    });

    // PA.I.H.K1 is Task H
    expect(resolveCurrentTaskIAktrCode("PA.I.H.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.H.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    // PA.III.A.R3 is an archived code in the archived catalog
    expect(resolveCurrentTaskIAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentTaskIAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentTaskIAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
