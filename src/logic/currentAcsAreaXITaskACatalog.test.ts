import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_XI_TASK_A_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_XI_TASK_A_SOURCE,
  resolveCurrentAreaXITaskAAktrCode,
} from "./currentAcsAreaXITaskACatalog";

describe("Private Pilot Airplane ACS 6C Area XI Task A (PA.XI.A) catalog slice", () => {
  const expectedCodes = [
    "PA.XI.A.K1",
    "PA.XI.A.K2",
    "PA.XI.A.K3",
    "PA.XI.A.K4",
    "PA.XI.A.K5",
    "PA.XI.A.K6",
    "PA.XI.A.K7",
    "PA.XI.A.K8",
    "PA.XI.A.R1",
    "PA.XI.A.R2",
    "PA.XI.A.R3",
    "PA.XI.A.R4",
    "PA.XI.A.R5",
    "PA.XI.A.R6",
    "PA.XI.A.R7",
  ] as const;

  it("contains exactly the 15 verified Area XI Task A codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_XI_TASK_A_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(15);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_XI_TASK_A_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("XI");
      expect(entry.task).toBe("A");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_XI_TASK_A_SOURCE);
    }
  });

  it("asserts that no S (Skill) code is present in Area XI Task A", () => {
    const sCodes = CURRENT_PRIVATE_AIRPLANE_AREA_XI_TASK_A_CODES.filter((entry) =>
      entry.code.includes(".S"),
    );
    expect(sCodes).toHaveLength(0);
    expect(
      CURRENT_PRIVATE_AIRPLANE_AREA_XI_TASK_A_CODES.some((entry) =>
        /\.S\d+$/i.test(entry.code),
      ),
    ).toBe(false);
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.XI.A coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_XI_TASK_A_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "63–64",
      pdfPages: "71–72",
      areaOfOperation: "Area of Operation XI: Night Operations",
      task: "Task A. Night Operations",
      coverageLabel: "PA.XI.A",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.XI.A.K1": "Physiological aspects of vision related to night flying.",
      "PA.XI.A.K2":
        "Lighting systems identifying airports, runways, taxiways and obstructions, as well as pilot controlled lighting.",
      "PA.XI.A.K3":
        "Airplane equipment and lighting requirements for night operations.",
      "PA.XI.A.K4": "Personal equipment essential for night flight.",
      "PA.XI.A.K5":
        "Night orientation, navigation, chart reading techniques and methods for maintaining night vision effectiveness.",
      "PA.XI.A.K6": "Night taxi operations.",
      "PA.XI.A.K7":
        "Interpretation of traffic position and direction based solely on position lights.",
      "PA.XI.A.K8": "Visual illusions at night.",
      "PA.XI.A.R1": "Collision hazards.",
      "PA.XI.A.R2":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.XI.A.R3":
        "Effect of visual illusions and night adaptation during all phases of night flying.",
      "PA.XI.A.R4": "Runway incursion.",
      "PA.XI.A.R5": "Night currency versus proficiency.",
      "PA.XI.A.R6": "Weather considerations specific to night operations.",
      "PA.XI.A.R7": "Inoperative equipment.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_XI_TASK_A_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area XI Task A code with case-insensitive ASCII matching", () => {
    // Knowledge codes
    const resK1 = resolveCurrentAreaXITaskAAktrCode("pa.xi.a.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.XI.A.K1",
        description: "Physiological aspects of vision related to night flying.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "XI",
        task: "A",
      },
    });

    const resK8Upper = resolveCurrentAreaXITaskAAktrCode("PA.XI.A.K8");
    expect(resK8Upper).toMatchObject({
      status: "current",
      entry: {
        code: "PA.XI.A.K8",
        description: "Visual illusions at night.",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaXITaskAAktrCode("pa.xi.a.r1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.XI.A.R1",
        description: "Collision hazards.",
      },
    });

    const resR7 = resolveCurrentAreaXITaskAAktrCode("PA.XI.A.R7");
    expect(resR7).toMatchObject({
      status: "current",
      entry: {
        code: "PA.XI.A.R7",
        description: "Inoperative equipment.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area X Task D
    expect(resolveCurrentAreaXITaskAAktrCode("PA.X.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.X.D.K1",
    });

    // Area X Task A
    expect(resolveCurrentAreaXITaskAAktrCode("PA.X.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.X.A.K1",
    });

    // Area IX Task A
    expect(resolveCurrentAreaXITaskAAktrCode("PA.IX.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.A.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaXITaskAAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves hypothetical S codes, archived codes, and non-existent sub-elements unresolved", () => {
    expect(resolveCurrentAreaXITaskAAktrCode("PA.XI.A.S1")).toEqual({
      status: "unresolved",
      code: "PA.XI.A.S1",
    });
    expect(resolveCurrentAreaXITaskAAktrCode("pa.xi.a.s1")).toEqual({
      status: "unresolved",
      code: "PA.XI.A.S1",
    });
    expect(resolveCurrentAreaXITaskAAktrCode("PA.XI.A.K9")).toEqual({
      status: "unresolved",
      code: "PA.XI.A.K9",
    });
    expect(resolveCurrentAreaXITaskAAktrCode("PA.XI.A.R8")).toEqual({
      status: "unresolved",
      code: "PA.XI.A.R8",
    });
    expect(resolveCurrentAreaXITaskAAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaXITaskAAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaXITaskAAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
    expect(resolveCurrentAreaXITaskAAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
