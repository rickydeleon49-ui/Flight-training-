import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_F_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_F_SOURCE,
  resolveCurrentAreaIXTaskFAktrCode,
} from "./currentAcsAreaIXTaskFCatalog";

describe("Private Pilot Airplane ACS 6C Area IX Task F (PA.IX.F) catalog slice", () => {
  const expectedCodes = [
    "PA.IX.F.K1",
    "PA.IX.F.K2",
    "PA.IX.F.K3",
    "PA.IX.F.K4",
    "PA.IX.F.K5",
    "PA.IX.F.K6",
    "PA.IX.F.R1",
    "PA.IX.F.R2",
    "PA.IX.F.R3",
    "PA.IX.F.R4",
    "PA.IX.F.R5",
    "PA.IX.F.S1",
    "PA.IX.F.S2",
    "PA.IX.F.S3",
    "PA.IX.F.S4",
    "PA.IX.F.S5",
    "PA.IX.F.S6",
    "PA.IX.F.S7",
    "PA.IX.F.S8",
    "PA.IX.F.S9",
    "PA.IX.F.S10",
  ] as const;

  it("contains exactly the 21 verified Area IX Task F codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_F_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(21);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_F_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("IX");
      expect(entry.task).toBe("F");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_F_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.IX.F coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_F_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "56–57",
      pdfPages: "63–64",
      areaOfOperation: "Area of Operation IX: Emergency Operations",
      task: "Task F. Engine Failure After Liftoff (Simulated) (AMEL, AMES)",
      coverageLabel: "PA.IX.F",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.IX.F.K1": "Factors affecting minimum controllable speed (VMC).",
      "PA.IX.F.K2":
        "VMC (red line), VYSE (blue line), and safe single-engine speed (VSSE).",
      "PA.IX.F.K3": "Accelerate/stop and accelerate/go distances.",
      "PA.IX.F.K4":
        "How to identify, verify, feather, and secure an inoperative engine.",
      "PA.IX.F.K5":
        "Importance of drag reduction, including propeller feathering, gear and flap retraction, the manufacturer’s recommended control input and its relation to zero sideslip.",
      "PA.IX.F.K6":
        "Simulated propeller feathering and the evaluator’s zero-thrust procedures and responsibilities.",
      "PA.IX.F.R1": "Potential engine failure after lift-off.",
      "PA.IX.F.R2": "Collision hazards.",
      "PA.IX.F.R3": "Configuring the airplane.",
      "PA.IX.F.R4":
        "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.IX.F.R5":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.IX.F.S1":
        "Promptly recognize an engine failure, maintain control, and use appropriate emergency procedures.",
      "PA.IX.F.S2":
        "Establish VYSE; if obstructions are present, establish best single-engine angle of climb speed (VXSE) or VMC +5 knots, whichever is greater, until obstructions are cleared. Then transition to VYSE.",
      "PA.IX.F.S3":
        "Reduce drag by retracting landing gear and flaps in accordance with the manufacturer’s guidance.",
      "PA.IX.F.S4":
        "Simulate feathering the propeller on the inoperative engine (evaluator should then establish zero thrust on the inoperative engine).",
      "PA.IX.F.S5":
        "Use flight controls in the proper combination as recommended by the manufacturer, or as required to maintain best performance, and trim as required.",
      "PA.IX.F.S6":
        "Monitor the operating engine and aircraft systems and make adjustments as necessary.",
      "PA.IX.F.S7":
        "Recognize the airplane’s performance capabilities. If a climb is not possible at VYSE, maintain VYSE and return to the departure airport for landing, or initiate an approach to the most suitable landing area available.",
      "PA.IX.F.S8": "Simulate securing the inoperative engine.",
      "PA.IX.F.S9": "Maintain heading ±10° and airspeed ±5 knots.",
      "PA.IX.F.S10": "Complete the appropriate checklist(s).",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_F_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area IX Task F code with case-insensitive ASCII matching", () => {
    // Knowledge codes
    const resK1 = resolveCurrentAreaIXTaskFAktrCode("pa.ix.f.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.F.K1",
        description: "Factors affecting minimum controllable speed (VMC).",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "IX",
        task: "F",
      },
    });

    const resK6 = resolveCurrentAreaIXTaskFAktrCode("PA.IX.F.K6");
    expect(resK6).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.F.K6",
        description:
          "Simulated propeller feathering and the evaluator’s zero-thrust procedures and responsibilities.",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaIXTaskFAktrCode("pa.ix.f.r1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.F.R1",
        description: "Potential engine failure after lift-off.",
      },
    });

    const resR5 = resolveCurrentAreaIXTaskFAktrCode("PA.IX.F.R5");
    expect(resR5).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.F.R5",
        description:
          "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      },
    });

    // Skill codes
    const resS1 = resolveCurrentAreaIXTaskFAktrCode("pa.ix.f.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.F.S1",
        description:
          "Promptly recognize an engine failure, maintain control, and use appropriate emergency procedures.",
      },
    });

    const resS10 = resolveCurrentAreaIXTaskFAktrCode("PA.IX.F.S10");
    expect(resS10).toMatchObject({
      status: "current",
      entry: {
        code: "PA.IX.F.S10",
        description: "Complete the appropriate checklist(s).",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area IX Task A
    expect(resolveCurrentAreaIXTaskFAktrCode("PA.IX.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.A.K1",
    });

    // Area IX Task B
    expect(resolveCurrentAreaIXTaskFAktrCode("PA.IX.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.B.K1",
    });

    // Area IX Task C
    expect(resolveCurrentAreaIXTaskFAktrCode("PA.IX.C.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.C.K1",
    });

    // Area IX Task D
    expect(resolveCurrentAreaIXTaskFAktrCode("PA.IX.D.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.D.K1",
    });

    // Area IX Task E
    expect(resolveCurrentAreaIXTaskFAktrCode("PA.IX.E.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.E.K1",
    });

    // Area IX Task G (if any)
    expect(resolveCurrentAreaIXTaskFAktrCode("PA.IX.G.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.G.K1",
    });

    // Area VIII Task A
    expect(resolveCurrentAreaIXTaskFAktrCode("PA.VIII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaIXTaskFAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes and non-existent sub-elements unresolved", () => {
    expect(resolveCurrentAreaIXTaskFAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
    expect(resolveCurrentAreaIXTaskFAktrCode("PA.IX.F.K7")).toEqual({
      status: "unresolved",
      code: "PA.IX.F.K7",
    });
    expect(resolveCurrentAreaIXTaskFAktrCode("PA.IX.F.R6")).toEqual({
      status: "unresolved",
      code: "PA.IX.F.R6",
    });
    expect(resolveCurrentAreaIXTaskFAktrCode("PA.IX.F.S11")).toEqual({
      status: "unresolved",
      code: "PA.IX.F.S11",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaIXTaskFAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaIXTaskFAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
    expect(resolveCurrentAreaIXTaskFAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
