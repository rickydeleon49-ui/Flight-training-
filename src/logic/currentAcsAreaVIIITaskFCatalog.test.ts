import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_F_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_F_SOURCE,
  resolveCurrentAreaVIIITaskFAktrCode,
} from "./currentAcsAreaVIIITaskFCatalog";

describe("Private Pilot Airplane ACS 6C Area VIII Task F (PA.VIII.F) catalog slice", () => {
  const expectedCodes = [
    "PA.VIII.F.K1",
    "PA.VIII.F.K2",
    "PA.VIII.F.K3",
    "PA.VIII.F.R1",
    "PA.VIII.F.R2",
    "PA.VIII.F.S1",
    "PA.VIII.F.S2",
  ] as const;

  it("contains exactly the 7 verified Area VIII Task F codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_F_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(7);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_F_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("VIII");
      expect(entry.task).toBe("F");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_F_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.VIII.F coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_F_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "50–51",
      pdfPages: "57–58",
      areaOfOperation: "Area of Operation VIII: Basic Instrument Maneuvers",
      task: "Task F. Radio Communications, Navigation Systems/Facilities, and Radar Services",
      coverageLabel: "PA.VIII.F",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.VIII.F.K1":
        "Operating communications equipment, including identifying and selecting radio frequencies, requesting and following air traffic control (ATC) instructions.",
      "PA.VIII.F.K2":
        "Operating navigation equipment, including functions and displays, and following bearings, radials, or courses.",
      "PA.VIII.F.K3": "Air traffic control facilities and services.",
      "PA.VIII.F.R1":
        "When to seek assistance or declare an emergency in a deteriorating situation.",
      "PA.VIII.F.R2":
        "Using available resources (e.g., automation, ATC, and flight deck planning aids).",
      "PA.VIII.F.S1":
        "Maintain airplane control while selecting proper communications frequencies, identifying the appropriate facility, and managing navigation equipment.",
      "PA.VIII.F.S2": "Comply with ATC instructions.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_VIII_TASK_F_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area VIII Task F code with case-insensitive ASCII matching", () => {
    // Knowledge codes
    const resK1 = resolveCurrentAreaVIIITaskFAktrCode("pa.viii.f.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.F.K1",
        description:
          "Operating communications equipment, including identifying and selecting radio frequencies, requesting and following air traffic control (ATC) instructions.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "VIII",
        task: "F",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_VIII_TASK_F_SOURCE,
      },
    });

    const resK2 = resolveCurrentAreaVIIITaskFAktrCode("PA.VIII.F.K2");
    expect(resK2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.F.K2",
        description:
          "Operating navigation equipment, including functions and displays, and following bearings, radials, or courses.",
      },
    });

    const resK3 = resolveCurrentAreaVIIITaskFAktrCode("pa.VIII.f.K3");
    expect(resK3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.F.K3",
        description: "Air traffic control facilities and services.",
      },
    });

    // Risk management codes
    const resR1 = resolveCurrentAreaVIIITaskFAktrCode("PA.viii.F.r1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.F.R1",
        description:
          "When to seek assistance or declare an emergency in a deteriorating situation.",
      },
    });

    const resR2 = resolveCurrentAreaVIIITaskFAktrCode("pa.viii.f.r2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.F.R2",
        description:
          "Using available resources (e.g., automation, ATC, and flight deck planning aids).",
      },
    });

    // Skills codes
    const resS1 = resolveCurrentAreaVIIITaskFAktrCode("pa.viii.f.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.F.S1",
        description:
          "Maintain airplane control while selecting proper communications frequencies, identifying the appropriate facility, and managing navigation equipment.",
      },
    });

    const resS2 = resolveCurrentAreaVIIITaskFAktrCode("PA.VIII.F.S2");
    expect(resS2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.VIII.F.S2",
        description: "Comply with ATC instructions.",
      },
    });
  });

  it("leaves absent codes within Area VIII Task F unresolved", () => {
    expect(resolveCurrentAreaVIIITaskFAktrCode("PA.VIII.F.K4")).toEqual({
      status: "unresolved",
      code: "PA.VIII.F.K4",
    });
    expect(resolveCurrentAreaVIIITaskFAktrCode("PA.VIII.F.R3")).toEqual({
      status: "unresolved",
      code: "PA.VIII.F.R3",
    });
    expect(resolveCurrentAreaVIIITaskFAktrCode("PA.VIII.F.S4")).toEqual({
      status: "unresolved",
      code: "PA.VIII.F.S4",
    });
  });

  it("leaves codes outside Area VIII Task F unresolved", () => {
    expect(resolveCurrentAreaVIIITaskFAktrCode("PA.VIII.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.E.K1",
    });
    expect(resolveCurrentAreaVIIITaskFAktrCode("PA.VIII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.K1",
    });
    expect(resolveCurrentAreaVIIITaskFAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes unresolved (including explicitly archived S3)", () => {
    expect(resolveCurrentAreaVIIITaskFAktrCode("PA.VIII.F.S3")).toEqual({
      status: "unresolved",
      code: "PA.VIII.F.S3",
    });
    expect(resolveCurrentAreaVIIITaskFAktrCode("pa.viii.f.s3")).toEqual({
      status: "unresolved",
      code: "PA.VIII.F.S3",
    });
    expect(resolveCurrentAreaVIIITaskFAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaVIIITaskFAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaVIIITaskFAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
