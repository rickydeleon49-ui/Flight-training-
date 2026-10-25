import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_B_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_B_SOURCE,
  resolveCurrentAreaXTaskBAktrCode,
} from "./currentAcsAreaXTaskBCatalog";

describe("Private Pilot Airplane ACS 6C Area X Task B (PA.X.B) catalog slice", () => {
  const expectedCodes = [
    "PA.X.B.K1",
    "PA.X.B.K2",
    "PA.X.B.K3",
    "PA.X.B.K4",
    "PA.X.B.R1",
    "PA.X.B.R2",
    "PA.X.B.R3",
    "PA.X.B.S1",
    "PA.X.B.S1a",
    "PA.X.B.S1b",
    "PA.X.B.S1c",
    "PA.X.B.S1d",
    "PA.X.B.S1e",
    "PA.X.B.S1f",
    "PA.X.B.S1g",
    "PA.X.B.S2",
    "PA.X.B.S3",
    "PA.X.B.S4",
    "PA.X.B.S5",
    "PA.X.B.S6",
    "PA.X.B.S7",
    "PA.X.B.S8",
  ] as const;

  it("contains exactly the 22 verified Area X Task B codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_B_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(22);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_B_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("X");
      expect(entry.task).toBe("B");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_B_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.X.B coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_B_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "60–61",
      pdfPages: "67–68",
      areaOfOperation: "Area of Operation X: Multiengine Operations",
      task: "Task B. VMC Demonstration (AMEL, AMES)",
      coverageLabel: "PA.X.B",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published with list markers stripped from child descriptions", () => {
    const expectedMap: Record<string, string> = {
      "PA.X.B.K1": "Factors affecting VMC and how VMC differs from stall speed (VS).",
      "PA.X.B.K2":
        "VMC (red line), VYSE (blue line), and safe single-engine speed (VSSE).",
      "PA.X.B.K3": "Cause of loss of directional control at airspeeds below VMC.",
      "PA.X.B.K4": "Proper procedures for maneuver entry and safe recovery.",
      "PA.X.B.R1": "Configuring the airplane.",
      "PA.X.B.R2": "Maneuvering with one engine inoperative.",
      "PA.X.B.R3":
        "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.X.B.S1":
        "Configure the airplane in accordance with the manufacturer’s recommendations, in the absence of the manufacturer’s recommendations, then at safe single-engine speed (VSSE/VYSE), as appropriate, and:",
      "PA.X.B.S1a": "Landing gear retracted",
      "PA.X.B.S1b": "Flaps set for takeoff",
      "PA.X.B.S1c": "Cowl flaps set for takeoff",
      "PA.X.B.S1d": "Trim set for takeoff",
      "PA.X.B.S1e": "Propellers set for high revolutions per minute (rpm)",
      "PA.X.B.S1f": "Power on critical engine reduced to idle and propeller windmilling",
      "PA.X.B.S1g": "Power on operating engine set to takeoff or maximum available power",
      "PA.X.B.S2":
        "Establish a single-engine climb attitude with the airspeed at approximately 10 knots above VSSE.",
      "PA.X.B.S3":
        "Establish a bank angle not to exceed 5° toward the operating engine, as required for best performance and controllability.",
      "PA.X.B.S4":
        "Increase the pitch attitude slowly to reduce the airspeed at approximately 1 knot per second while applying increased rudder pressure as needed to maintain directional control.",
      "PA.X.B.S5":
        "Recognize and recover at the first indication of loss of directional control, stall warning, or buffet.",
      "PA.X.B.S6":
        "Recover promptly by simultaneously reducing power sufficiently on the operating engine, decreasing the angle of attack as necessary to regain airspeed and directional control, and without adding power on the simulated failed engine.",
      "PA.X.B.S7": "Recover within 20° of entry heading.",
      "PA.X.B.S8":
        "Advance power smoothly on the operating engine and accelerate to VSSE/VYSE, as appropriate, +10/-5 knots during recovery.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_B_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area X Task B code with case-insensitive ASCII matching", () => {
    // Knowledge codes
    const resK1 = resolveCurrentAreaXTaskBAktrCode("pa.x.b.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.B.K1",
        description: "Factors affecting VMC and how VMC differs from stall speed (VS).",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "X",
        task: "B",
      },
    });

    const resK4 = resolveCurrentAreaXTaskBAktrCode("PA.X.B.K4");
    expect(resK4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.B.K4",
        description: "Proper procedures for maneuver entry and safe recovery.",
      },
    });

    // Risk codes
    const resR1 = resolveCurrentAreaXTaskBAktrCode("pa.x.b.r1");
    expect(resR1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.B.R1",
        description: "Configuring the airplane.",
      },
    });

    const resR3 = resolveCurrentAreaXTaskBAktrCode("PA.X.B.R3");
    expect(resR3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.B.R3",
        description:
          "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      },
    });

    // Skill codes (parent and child subcodes)
    const resS1 = resolveCurrentAreaXTaskBAktrCode("pa.x.b.s1");
    expect(resS1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.B.S1",
        description:
          "Configure the airplane in accordance with the manufacturer’s recommendations, in the absence of the manufacturer’s recommendations, then at safe single-engine speed (VSSE/VYSE), as appropriate, and:",
      },
    });

    const resS1a = resolveCurrentAreaXTaskBAktrCode("pa.x.b.s1a");
    expect(resS1a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.B.S1a",
        description: "Landing gear retracted",
      },
    });

    const resS1g = resolveCurrentAreaXTaskBAktrCode("PA.X.B.S1G");
    expect(resS1g).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.B.S1g",
        description: "Power on operating engine set to takeoff or maximum available power",
      },
    });

    const resS8 = resolveCurrentAreaXTaskBAktrCode("PA.X.B.S8");
    expect(resS8).toMatchObject({
      status: "current",
      entry: {
        code: "PA.X.B.S8",
        description:
          "Advance power smoothly on the operating engine and accelerate to VSSE/VYSE, as appropriate, +10/-5 knots during recovery.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Area X Task A
    expect(resolveCurrentAreaXTaskBAktrCode("PA.X.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.X.A.K1",
    });

    // Area IX Task A
    expect(resolveCurrentAreaXTaskBAktrCode("PA.IX.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.A.K1",
    });

    // Area IX Task G
    expect(resolveCurrentAreaXTaskBAktrCode("PA.IX.G.K1")).toEqual({
      status: "unresolved",
      code: "PA.IX.G.K1",
    });

    // Area VIII Task A
    expect(resolveCurrentAreaXTaskBAktrCode("PA.VIII.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.VIII.A.K1",
    });

    // Area I Task A
    expect(resolveCurrentAreaXTaskBAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });
  });

  it("leaves archived codes and non-existent sub-elements unresolved", () => {
    expect(resolveCurrentAreaXTaskBAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
    expect(resolveCurrentAreaXTaskBAktrCode("PA.X.B.K5")).toEqual({
      status: "unresolved",
      code: "PA.X.B.K5",
    });
    expect(resolveCurrentAreaXTaskBAktrCode("PA.X.B.R4")).toEqual({
      status: "unresolved",
      code: "PA.X.B.R4",
    });
    expect(resolveCurrentAreaXTaskBAktrCode("PA.X.B.S1h")).toEqual({
      status: "unresolved",
      code: "PA.X.B.S1H",
    });
    expect(resolveCurrentAreaXTaskBAktrCode("PA.X.B.S9")).toEqual({
      status: "unresolved",
      code: "PA.X.B.S9",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaXTaskBAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaXTaskBAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
    expect(resolveCurrentAreaXTaskBAktrCode("")).toEqual({
      status: "unresolved",
      code: "",
    });
  });
});
