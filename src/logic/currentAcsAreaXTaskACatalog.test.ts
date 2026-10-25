import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_A_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_A_SOURCE,
  resolveCurrentAreaXTaskAAktrCode,
} from "./currentAcsAreaXTaskACatalog";

describe("Private Pilot Airplane ACS 6C Area X Task A (PA.X.A) catalog slice", () => {
  const expectedCodes = [
    "PA.X.A.K1",
    "PA.X.A.K2",
    "PA.X.A.K3",
    "PA.X.A.K4",
    "PA.X.A.K5",
    "PA.X.A.R1",
    "PA.X.A.R2",
    "PA.X.A.R3",
    "PA.X.A.R4",
    "PA.X.A.R5",
    "PA.X.A.S1",
    "PA.X.A.S2",
    "PA.X.A.S3",
    "PA.X.A.S4",
    "PA.X.A.S5",
    "PA.X.A.S6",
    "PA.X.A.S7",
    "PA.X.A.S8",
  ] as const;

  it("contains exactly the 18 verified Area X Task A codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_A_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(18);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_A_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("X");
      expect(entry.task).toBe("A");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_A_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.X.A coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_A_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "58–59",
      pdfPages: "65–66",
      areaOfOperation: "Area of Operation X: Multiengine Operations",
      task: "Task A. Maneuvering with One Engine Inoperative (AMEL, AMES)",
      coverageLabel: "PA.X.A",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.X.A.K1": "Factors affecting minimum controllable speed (VMC).",
      "PA.X.A.K2":
        "VMC (red line) and best single-engine rate of climb airspeed (VYSE) (blue line).",
      "PA.X.A.K3":
        "How to identify, verify, feather, and secure an inoperative engine.",
      "PA.X.A.K4":
        "Importance of drag reduction, including propeller feathering, gear and flap retraction, the manufacturer’s recommended control input and its relation to zero sideslip.",
      "PA.X.A.K5": "Feathering, securing, unfeathering, and restarting.",
      "PA.X.A.R1": "Potential engine failure during flight.",
      "PA.X.A.R2": "Collision hazards.",
      "PA.X.A.R3": "Configuring the airplane.",
      "PA.X.A.R4":
        "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.X.A.R5":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.X.A.S1":
        "Recognize an engine failure, maintain control, use manufacturer’s memory item procedures, and use appropriate emergency procedures.",
      "PA.X.A.S2":
        "Set the engine controls, identify and verify the inoperative engine, and feather the appropriate propeller.",
      "PA.X.A.S3":
        "Use flight controls in the proper combination as recommended by the manufacturer, or as required to maintain best performance, and trim as required.",
      "PA.X.A.S4":
        "Attempt to determine and resolve the reason for the engine failure.",
      "PA.X.A.S5":
        "Secure the inoperative engine and monitor the operating engine and make necessary adjustments.",
      "PA.X.A.S6":
        "Restart the inoperative engine using manufacturer’s restart procedures.",
      "PA.X.A.S7":
        "Maintain altitude ±100 feet or minimum sink rate if applicable, airspeed ±10 knots, and selected headings ±10°.",
      "PA.X.A.S8": "Complete the appropriate checklist(s).",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_A_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area X Task A code with case-insensitive ASCII matching", () => {
    // Knowledge codes
    const resK1 = resolveCurrentAreaXTaskAAktrCode("pa.x.a.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.A.K1",
        description: "Factors affecting minimum controllable speed (VMC).",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "X",
        task: "A",
      },
    });

    const resK5 = resolveCurrentAreaXTaskAAktrCode("PA.X.A.K5");
    expect(resK5).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.A.K5",
        description: "Feathering, securing, unfeathering, and restarting.",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaXTaskAAktrCode("pa.x.a.r1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.A.R1",
        description: "Potential engine failure during flight.",
      },
    });

    const resR5 = resolveCurrentAreaXTaskAAktrCode("PA.X.A.R5");
    expect(resR5).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.A.R5",
        description:
          "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      },
    });

    // Skill codes
    const resS1 = resolveCurrentAreaXTaskAAktrCode("pa.x.a.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.A.S1",
        description:
          "Recognize an engine failure, maintain control, use manufacturer’s memory item procedures, and use appropriate emergency procedures.",
      },
    });

    const resS8 = resolveCurrentAreaXTaskAAktrCode("PA.X.A.S8");
    expect(resS8).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.A.S8",
        description: "Complete the appropriate checklist(s).",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area X Task B
    expect(resolveCurrentAreaXTaskAAktrCode("PA.X.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.X.B.K1",
    });

    // Area IX Task A
    expect(resolveCurrentAreaXTaskAAktrCode("PA.IX.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.A.K1",
    });

    // Area IX Task G
    expect(resolveCurrentAreaXTaskAAktrCode("PA.IX.G.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.G.K1",
    });

    // Area VIII Task A
    expect(resolveCurrentAreaXTaskAAktrCode("PA.VIII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaXTaskAAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes and non-existent sub-elements unresolved", () => {
    expect(resolveCurrentAreaXTaskAAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
    expect(resolveCurrentAreaXTaskAAktrCode("PA.X.A.K6")).toEqual({
      status: "unresolved",
      code: "PA.X.A.K6",
    });
    expect(resolveCurrentAreaXTaskAAktrCode("PA.X.A.R6")).toEqual({
      status: "unresolved",
      code: "PA.X.A.R6",
    });
    expect(resolveCurrentAreaXTaskAAktrCode("PA.X.A.S9")).toEqual({
      status: "unresolved",
      code: "PA.X.A.S9",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaXTaskAAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaXTaskAAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
    expect(resolveCurrentAreaXTaskAAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
