import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_A_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_III_TASK_A_SOURCE,
  resolveCurrentAreaIIITaskAAktrCode,
} from "./currentAcsAreaIIITaskACatalog";

describe("Private Pilot Airplane ACS 6C Area III Task A (PA.III.A) catalog slice", () => {
  const expectedCodes = [
    "PA.III.A.K1",
    "PA.III.A.K2",
    "PA.III.A.K3",
    "PA.III.A.K4",
    "PA.III.A.K5",
    "PA.III.A.K6",
    "PA.III.A.K7",
    "PA.III.A.K8",
    "PA.III.A.K9",
    "PA.III.A.R1",
    "PA.III.A.R2",
    "PA.III.A.R4",
    "PA.III.A.S1",
    "PA.III.A.S2",
    "PA.III.A.S3",
  ] as const;

  it("contains exactly the 15 verified Area III Task A codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_A_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(15);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_A_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("III");
      expect(entry.task).toBe("A");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_III_TASK_A_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.III.A coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_III_TASK_A_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "16",
      pdfPages: "24",
      areaOfOperation: "Area of Operation III: Airport and Seaplane Base Operations",
      task: "Task A. Communications, Light Signals, and Runway Lighting Systems",
      coverageLabel: "PA.III.A",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.III.A.K1": "How to obtain appropriate radio frequencies.",
      "PA.III.A.K2":
        "Proper radio communication procedures and air traffic control (ATC) phraseology.",
      "PA.III.A.K3": "ATC light signal recognition.",
      "PA.III.A.K4": "Appropriate use of transponder(s).",
      "PA.III.A.K5": "Lost communication procedures.",
      "PA.III.A.K6": "Equipment issues that could cause loss of communication.",
      "PA.III.A.K7": "Radar assistance.",
      "PA.III.A.K8":
        "National Transportation Safety Board (NTSB) accident/incident reporting.",
      "PA.III.A.K9": "Runway Status Lighting Systems.",
      "PA.III.A.R1": "Communication.",
      "PA.III.A.R2": "Deciding if and when to declare an emergency.",
      "PA.III.A.R4": "Use of non-standard phraseology.",
      "PA.III.A.S1": "Select and activate appropriate frequencies.",
      "PA.III.A.S2":
        "Transmit using standard phraseology and procedures as specified in the Aeronautical Information Manual (AIM) and Pilot/Controller Glossary.",
      "PA.III.A.S3":
        "Acknowledge radio communications and comply with ATC instructions or as directed by the evaluator.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_A_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area III Task A code with case-insensitive ASCII matching", () => {
    const resK1 = resolveCurrentAreaIIITaskAAktrCode("pa.iii.a.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.III.A.K1",
        description: "How to obtain appropriate radio frequencies.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "III",
        task: "A",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_III_TASK_A_SOURCE,
      },
    });

    const resK9 = resolveCurrentAreaIIITaskAAktrCode("pa.iii.a.k9");
    expect(resK9).toMatchObject({
      status: "current",
      entry: {
        code: "PA.III.A.K9",
        description: "Runway Status Lighting Systems.",
      },
    });

    const resR1 = resolveCurrentAreaIIITaskAAktrCode("PA.III.A.R1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.III.A.R1",
        description: "Communication.",
      },
    });

    const resR2 = resolveCurrentAreaIIITaskAAktrCode("pa.iii.a.r2");
    expect(resR2).toMatchObject({
      status: "current",
      entry: {
        code: "PA.III.A.R2",
        description: "Deciding if and when to declare an emergency.",
      },
    });

    const resR4 = resolveCurrentAreaIIITaskAAktrCode("pa.iii.a.r4");
    expect(resR4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.III.A.R4",
        description: "Use of non-standard phraseology.",
      },
    });

    const resS1 = resolveCurrentAreaIIITaskAAktrCode("pa.iii.a.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.III.A.S1",
        description: "Select and activate appropriate frequencies.",
      },
    });

    const resS3 = resolveCurrentAreaIIITaskAAktrCode("PA.III.A.S3");
    expect(resS3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.III.A.S3",
        description:
          "Acknowledge radio communications and comply with ATC instructions or as directed by the evaluator.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Representative current code outside this slice: Task B
    expect(resolveCurrentAreaIIITaskAAktrCode("PA.III.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.III.B.K1",
    });

    // Representative current code outside this slice: Area II Task F
    expect(resolveCurrentAreaIIITaskAAktrCode("PA.II.F.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.F.K1",
    });

    // Representative current code outside this slice: Area I Task A
    expect(resolveCurrentAreaIIITaskAAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived R3 unresolved and does not add it to current catalog", () => {
    expect(resolveCurrentAreaIIITaskAAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
    expect(resolveCurrentAreaIIITaskAAktrCode("pa.iii.a.r3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
    expect(
      CURRENT_PRIVATE_AIRPLANE_AREA_III_TASK_A_CODES.some(
        (entry) => entry.code.toUpperCase() === "PA.III.A.R3",
      ),
    ).toBe(false);
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIIITaskAAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIIITaskAAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
