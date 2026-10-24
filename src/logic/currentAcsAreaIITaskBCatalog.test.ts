import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_B_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_B_SOURCE,
  resolveCurrentAreaIITaskBAktrCode,
} from "./currentAcsAreaIITaskBCatalog";

describe("Private Pilot Airplane ACS 6C Area II Task B (PA.II.B) catalog slice", () => {
  const expectedCodes = [
    "PA.II.B.K1",
    "PA.II.B.K2",
    "PA.II.B.K3",
    "PA.II.B.K4",
    "PA.II.B.R1",
    "PA.II.B.R2",
    "PA.II.B.R3",
    "PA.II.B.S1",
    "PA.II.B.S2",
    "PA.II.B.S3",
    "PA.II.B.S4",
  ] as const;

  it("contains exactly the 11 verified Area II Task B codes once each with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_B_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(11);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_B_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("II");
      expect(entry.task).toBe("B");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_B_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.II.B coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_B_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPage: 12,
      pdfPage: 20,
      areaOfOperation: "Area of Operation II: Preflight Procedures",
      task: "Task B. Flight Deck Management",
      coverageLabel: "PA.II.B",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.II.B.K1": "Passenger briefing requirements, including operation and required use of safety restraint systems.",
      "PA.II.B.K2": "Use of appropriate checklists.",
      "PA.II.B.K3": "Requirements for current and appropriate navigation data.",
      "PA.II.B.K4": "Securing items and cargo.",
      "PA.II.B.R1": "Use of systems or equipment, including automation and portable electronic devices.",
      "PA.II.B.R2": "Inoperative equipment.",
      "PA.II.B.R3": "Passenger distractions.",
      "PA.II.B.S1": "Secure all items in the aircraft.",
      "PA.II.B.S2": "Conduct an appropriate passenger briefing, including identifying the pilot-in-command (PIC), use of safety belts, shoulder harnesses, doors, passenger conduct, sterile aircraft, propeller blade avoidance, and emergency procedures.",
      "PA.II.B.S3": "Properly program and manage the aircraft’s automation, as applicable.",
      "PA.II.B.S4": "Appropriately manage risks by utilizing ADM, including SRM/CRM.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_II_TASK_B_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area II Task B code with case-insensitive ASCII matching", () => {
    const res = resolveCurrentAreaIITaskBAktrCode("pa.ii.b.k1");
    expect(res).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.B.K1",
        description: "Passenger briefing requirements, including operation and required use of safety restraint systems.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "II",
        task: "B",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_II_TASK_B_SOURCE,
      },
    });

    const resRisk = resolveCurrentAreaIITaskBAktrCode("PA.II.B.R1");
    expect(resRisk).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.B.R1",
        description: "Use of systems or equipment, including automation and portable electronic devices.",
      },
    });

    const resSkill = resolveCurrentAreaIITaskBAktrCode("pa.ii.b.s2");
    expect(resSkill).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.B.S2",
        description: "Conduct an appropriate passenger briefing, including identifying the pilot-in-command (PIC), use of safety belts, shoulder harnesses, doors, passenger conduct, sterile aircraft, propeller blade avoidance, and emergency procedures.",
      },
    });

    const resSkill3 = resolveCurrentAreaIITaskBAktrCode("PA.II.B.S3");
    expect(resSkill3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.II.B.S3",
        description: "Properly program and manage the aircraft’s automation, as applicable.",
      },
    });
  });

  it("leaves out-of-slice current codes unresolved (including Area I Task A–I and Area II Task A)", () => {
    // Area I Task A
    expect(resolveCurrentAreaIITaskBAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
    // Area I Task B
    expect(resolveCurrentAreaIITaskBAktrCode("PA.I.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.B.K1",
    });
    // Area I Task C
    expect(resolveCurrentAreaIITaskBAktrCode("PA.I.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.C.K1",
    });
    // Area I Task D
    expect(resolveCurrentAreaIITaskBAktrCode("PA.I.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.D.K1",
    });
    // Area I Task E
    expect(resolveCurrentAreaIITaskBAktrCode("PA.I.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.E.K1",
    });
    // Area I Task F
    expect(resolveCurrentAreaIITaskBAktrCode("PA.I.F.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.F.K1",
    });
    // Area I Task G
    expect(resolveCurrentAreaIITaskBAktrCode("PA.I.G.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.G.K1",
    });
    // Area I Task H
    expect(resolveCurrentAreaIITaskBAktrCode("PA.I.H.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.H.K1",
    });
    // Area I Task I
    expect(resolveCurrentAreaIITaskBAktrCode("PA.I.I.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.I.K1",
    });
    // Area II Task A
    expect(resolveCurrentAreaIITaskBAktrCode("PA.II.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.A.K1",
    });
    // Area II Task C (future task)
    expect(resolveCurrentAreaIITaskBAktrCode("PA.II.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.II.C.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    expect(resolveCurrentAreaIITaskBAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIITaskBAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIITaskBAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
