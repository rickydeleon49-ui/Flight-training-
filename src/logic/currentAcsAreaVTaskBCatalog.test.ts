import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_B_CODES,
  PRIVATE_AIRPLANE_ACS_6C_AREA_V_TASK_B_SOURCE,
  resolveCurrentAreaVTaskBAktrCode,
} from "./currentAcsAreaVTaskBCatalog";

describe("Private Pilot Airplane ACS 6C Area V Task B (PA.V.B) catalog slice", () => {
  const expectedCodes = [
    "PA.V.B.K1",
    "PA.V.B.K2",
    "PA.V.B.K3",
    "PA.V.B.K4",
    "PA.V.B.R1",
    "PA.V.B.R2",
    "PA.V.B.R3",
    "PA.V.B.R4",
    "PA.V.B.R5",
    "PA.V.B.S1",
    "PA.V.B.S2",
    "PA.V.B.S3",
    "PA.V.B.S3a",
    "PA.V.B.S3b",
    "PA.V.B.S3c",
    "PA.V.B.S4",
    "PA.V.B.S5",
    "PA.V.B.S6",
    "PA.V.B.S7",
  ] as const;

  it("contains exactly the 19 verified Area V Task B codes once each in order with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_B_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(19);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_B_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("V");
      expect(entry.task).toBe("B");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_AREA_V_TASK_B_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.V.B coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_AREA_V_TASK_B_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "36–37",
      pdfPages: "44–45",
      areaOfOperation: "Area of Operation V: Performance Maneuvers and Ground Reference Maneuvers",
      task: "Task B. Ground Reference Maneuvers",
      coverageLabel: "PA.V.B",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published with normalized child markers", () => {
    const expectedMap: Record<string, string> = {
      "PA.V.B.K1": "Purpose of ground reference maneuvers.",
      "PA.V.B.K2": "Effects of wind on ground track and relation to a ground reference.",
      "PA.V.B.K3": "Effects of bank angle and groundspeed on rate and radius of turn.",
      "PA.V.B.K4": "Relationship of rectangular course to airport traffic pattern.",
      "PA.V.B.R1": "Division of attention between aircraft control and orientation.",
      "PA.V.B.R2": "Collision hazards.",
      "PA.V.B.R3": "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      "PA.V.B.R4": "Distractions, task prioritization, loss of situational awareness, or disorientation.",
      "PA.V.B.R5": "Uncoordinated flight.",
      "PA.V.B.S1": "Clear the area.",
      "PA.V.B.S2": "Select a suitable ground reference area, line, or point as appropriate.",
      "PA.V.B.S3": "Plan the maneuver:",
      "PA.V.B.S3a":
        "Rectangular course: enter a left or right pattern, 600 to 1,000 feet above ground level (AGL) at an appropriate distance from the selected reference area, 45° to the downwind leg",
      "PA.V.B.S3b":
        "S-turns: enter perpendicular to the selected reference line, 600 to 1,000 feet AGL at an appropriate distance from the selected reference area",
      "PA.V.B.S3c":
        "Turns around a point: enter at an appropriate distance from the reference point, 600 to 1,000 feet AGL at an appropriate distance from the selected reference area",
      "PA.V.B.S4":
        "Apply adequate wind-drift correction during straight and turning flight to maintain a constant ground track around a rectangular reference area, or to maintain a constant radius turn on each side of a selected reference line or point.",
      "PA.V.B.S5":
        "If performing S-Turns, reverse the turn directly over the selected reference line; if performing turns around a point, complete turns in either direction, as specified by the evaluator.",
      "PA.V.B.S6":
        "Divide attention between airplane control, traffic avoidance and the ground track while maintaining coordinated flight.",
      "PA.V.B.S7": "Maintain altitude ±100 feet; maintain airspeed ±10 knots.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_B_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Area V Task B code with case-insensitive ASCII matching, including child codes", () => {
    const resK1 = resolveCurrentAreaVTaskBAktrCode("pa.v.b.k1");
    expect(resK1).toMatchObject({
      status: "current",
      entry: {
        code: "PA.V.B.K1",
        description: "Purpose of ground reference maneuvers.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        areaOfOperation: "V",
        task: "B",
        source: PRIVATE_AIRPLANE_ACS_6C_AREA_V_TASK_B_SOURCE,
      },
    });

    const resK4 = resolveCurrentAreaVTaskBAktrCode("PA.V.B.K4");
    expect(resK4).toMatchObject({
      status: "current",
      entry: {
        code: "PA.V.B.K4",
        description: "Relationship of rectangular course to airport traffic pattern.",
      },
    });

    const resR3 = resolveCurrentAreaVTaskBAktrCode("pa.v.b.r3");
    expect(resR3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.V.B.R3",
        description: "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
      },
    });

    const resS3 = resolveCurrentAreaVTaskBAktrCode("pa.v.b.s3");
    expect(resS3).toMatchObject({
      status: "current",
      entry: {
        code: "PA.V.B.S3",
        description: "Plan the maneuver:",
      },
    });

    const resS3a = resolveCurrentAreaVTaskBAktrCode("pa.v.b.s3a");
    expect(resS3a).toMatchObject({
      status: "current",
      entry: {
        code: "PA.V.B.S3a",
        description:
          "Rectangular course: enter a left or right pattern, 600 to 1,000 feet above ground level (AGL) at an appropriate distance from the selected reference area, 45° to the downwind leg",
      },
    });

    const resS3b = resolveCurrentAreaVTaskBAktrCode("PA.V.B.S3B");
    expect(resS3b).toMatchObject({
      status: "current",
      entry: {
        code: "PA.V.B.S3b",
        description:
          "S-turns: enter perpendicular to the selected reference line, 600 to 1,000 feet AGL at an appropriate distance from the selected reference area",
      },
    });

    const resS3c = resolveCurrentAreaVTaskBAktrCode("pa.v.b.s3C");
    expect(resS3c).toMatchObject({
      status: "current",
      entry: {
        code: "PA.V.B.S3c",
        description:
          "Turns around a point: enter at an appropriate distance from the reference point, 600 to 1,000 feet AGL at an appropriate distance from the selected reference area",
      },
    });

    const resS7 = resolveCurrentAreaVTaskBAktrCode("pa.v.b.s7");
    expect(resS7).toMatchObject({
      status: "current",
      entry: {
        code: "PA.V.B.S7",
        description: "Maintain altitude ±100 feet; maintain airspeed ±10 knots.",
      },
    });
  });

  it("leaves out-of-slice and unverified code-like tokens unresolved", () => {
    // Representative current code outside this slice: Area V Task A
    expect(resolveCurrentAreaVTaskBAktrCode("PA.V.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.V.A.K1",
    });

    // Representative current code outside this slice: Area IV Task A
    expect(resolveCurrentAreaVTaskBAktrCode("PA.IV.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.IV.A.K1",
    });

    // Representative current code outside this slice: Area I Task A
    expect(resolveCurrentAreaVTaskBAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });

    // Nonexistent Area V Task B code
    expect(resolveCurrentAreaVTaskBAktrCode("PA.V.B.S8")).toEqual({
      status: "unresolved",
      code: "PA.V.B.S8",
    });

    // Nonexistent child code
    expect(resolveCurrentAreaVTaskBAktrCode("PA.V.B.S3d")).toEqual({
      status: "unresolved",
      code: "PA.V.B.S3D",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentAreaVTaskBAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentAreaVTaskBAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
