import { describe, expect, it } from "vitest";
import {
  CURRENT_PRIVATE_AIRPLANE_TASK_C_CODES,
  PRIVATE_AIRPLANE_ACS_6C_TASK_C_SOURCE,
  resolveCurrentTaskCAktrCode,
} from "./currentAcsTaskCCatalog";

describe("Private Pilot Airplane ACS 6C Task C (PA.I.C) catalog slice", () => {
  const expectedCodes = [
    "PA.I.C.K1",
    "PA.I.C.K2",
    "PA.I.C.K2a",
    "PA.I.C.K2b",
    "PA.I.C.K2c",
    "PA.I.C.K2d",
    "PA.I.C.K2e",
    "PA.I.C.K2f",
    "PA.I.C.K2g",
    "PA.I.C.K3",
    "PA.I.C.K3a",
    "PA.I.C.K3b",
    "PA.I.C.K3c",
    "PA.I.C.K3d",
    "PA.I.C.K3e",
    "PA.I.C.K3f",
    "PA.I.C.K3g",
    "PA.I.C.K3h",
    "PA.I.C.K3i",
    "PA.I.C.K3j",
    "PA.I.C.K3k",
    "PA.I.C.K3l",
    "PA.I.C.K4",
    "PA.I.C.R1",
    "PA.I.C.R1a",
    "PA.I.C.R1b",
    "PA.I.C.R1c",
    "PA.I.C.R2",
    "PA.I.C.R2a",
    "PA.I.C.R2b",
    "PA.I.C.R2c",
    "PA.I.C.S1",
    "PA.I.C.S2",
    "PA.I.C.S3",
  ] as const;

  it("contains exactly the 34 verified Task C codes once each with status 'current'", () => {
    const codes = CURRENT_PRIVATE_AIRPLANE_TASK_C_CODES.map(({ code }) => code);
    expect(codes).toEqual(expectedCodes);
    expect(new Set(codes).size).toBe(34);

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_C_CODES) {
      expect(entry.status).toBe("current");
      expect(entry.certificate).toBe("Private Pilot");
      expect(entry.category).toBe("Airplane");
      expect(entry.areaOfOperation).toBe("I");
      expect(entry.task).toBe("C");
      expect(entry.source).toBe(PRIVATE_AIRPLANE_ACS_6C_TASK_C_SOURCE);
    }
  });

  it("has complete FAA-S-ACS-6C source metadata with explicit PA.I.C coverage", () => {
    expect(PRIVATE_AIRPLANE_ACS_6C_TASK_C_SOURCE).toMatchObject({
      document: "FAA-S-ACS-6C",
      title: "Private Pilot for Airplane Category Airman Certification Standards",
      effectiveFrom: "2024-05-31",
      printedPages: "3–4",
      pdfPages: "11–12",
      areaOfOperation: "Area of Operation I: Preflight Preparation",
      task: "Task C. Weather Information",
      coverageLabel: "PA.I.C",
      documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
    });
  });

  it("matches all official descriptions exactly as published", () => {
    const expectedMap: Record<string, string> = {
      "PA.I.C.K1": "Sources of weather data (e.g., National Weather Service, Flight Service) for flight planning purposes.",
      "PA.I.C.K2": "Acceptable weather products and resources required for preflight planning, current and forecast weather for departure, en route, and arrival phases of flight such as:",
      "PA.I.C.K2a": "Airport Observations (METAR and SPECI) and Pilot Observations (PIREP)",
      "PA.I.C.K2b": "Surface Analysis Chart, Ceiling and Visibility Chart (CVA)",
      "PA.I.C.K2c": "Terminal Aerodrome Forecasts (TAF)",
      "PA.I.C.K2d": "Graphical Forecasts for Aviation (GFA)",
      "PA.I.C.K2e": "Wind and Temperature Aloft Forecast (FB)",
      "PA.I.C.K2f": "Convective Outlook (AC)",
      "PA.I.C.K2g": "Inflight Aviation Weather Advisories including Airmen's Meteorological Information (AIRMET), Significant Meteorological Information (SIGMET), and Convective SIGMET",
      "PA.I.C.K3": "Meteorology applicable to the departure, en route, alternate, and destination under visual flight rules (VFR) in Visual Meteorological Conditions (VMC), including expected climate and hazardous conditions such as:",
      "PA.I.C.K3a": "Atmospheric composition and stability",
      "PA.I.C.K3b": "Wind (e.g., windshear, mountain wave, factors affecting wind, etc.)",
      "PA.I.C.K3c": "Temperature and heat exchange",
      "PA.I.C.K3d": "Moisture/precipitation",
      "PA.I.C.K3e": "Weather system formation, including air masses and fronts",
      "PA.I.C.K3f": "Clouds",
      "PA.I.C.K3g": "Turbulence",
      "PA.I.C.K3h": "Thunderstorms and microbursts",
      "PA.I.C.K3i": "Icing and freezing level information",
      "PA.I.C.K3j": "Fog/mist",
      "PA.I.C.K3k": "Frost",
      "PA.I.C.K3l": "Obstructions to visibility (e.g., smoke, haze, volcanic ash, etc.)",
      "PA.I.C.K4": "Flight deck instrument displays of digital weather and aeronautical information.",
      "PA.I.C.R1": "Making the go/no-go and continue/divert decisions, including:",
      "PA.I.C.R1a": "Circumstances that would make diversion prudent",
      "PA.I.C.R1b": "Personal weather minimums",
      "PA.I.C.R1c": "Hazardous weather conditions, including known or forecast icing or turbulence aloft",
      "PA.I.C.R2": "Use and limitations of:",
      "PA.I.C.R2a": "Installed onboard weather equipment",
      "PA.I.C.R2b": "Aviation weather reports and forecasts",
      "PA.I.C.R2c": "Inflight weather resources",
      "PA.I.C.S1": "Use available aviation weather resources to obtain an adequate weather briefing.",
      "PA.I.C.S2": "Analyze the implications of at least three of the conditions listed in K3a through K3l, using actual weather or weather conditions provided by the evaluator.",
      "PA.I.C.S3": "Correlate weather information to make a go/no-go decision.",
    };

    for (const entry of CURRENT_PRIVATE_AIRPLANE_TASK_C_CODES) {
      expect(entry.description).toBe(expectedMap[entry.code]);
    }
  });

  it("resolves an exact Task C code with case-insensitive ASCII matching", () => {
    const res = resolveCurrentTaskCAktrCode("pa.i.c.k1");
    expect(res).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.C.K1",
        description: "Sources of weather data (e.g., National Weather Service, Flight Service) for flight planning purposes.",
        status: "current",
        certificate: "Private Pilot",
        category: "Airplane",
        source: PRIVATE_AIRPLANE_ACS_6C_TASK_C_SOURCE,
      },
    });

    const resUpper = resolveCurrentTaskCAktrCode("PA.I.C.S3");
    expect(resUpper).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.C.S3",
        description: "Correlate weather information to make a go/no-go decision.",
      },
    });

    const resSub = resolveCurrentTaskCAktrCode("pa.i.c.k3l");
    expect(resSub).toMatchObject({
      status: "current",
      entry: {
        code: "PA.I.C.K3l",
        description: "Obstructions to visibility (e.g., smoke, haze, volcanic ash, etc.)",
      },
    });
  });

  it("leaves out-of-slice current codes unresolved (including Task A and Task B)", () => {
    // PA.I.A.K1 is Task A, outside the PA.I.C slice
    expect(resolveCurrentTaskCAktrCode("PA.I.A.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.A.K1",
    });

    // PA.I.B.K1 is Task B, outside the PA.I.C slice
    expect(resolveCurrentTaskCAktrCode("PA.I.B.K1")).toEqual({
      status: "unresolved",
      code: "PA.I.B.K1",
    });
  });

  it("leaves archived codes unresolved", () => {
    // PA.III.A.R3 is an archived code in the archived catalog
    expect(resolveCurrentTaskCAktrCode("PA.III.A.R3")).toEqual({
      status: "unresolved",
      code: "PA.III.A.R3",
    });
  });

  it("leaves invalid tokens and non-code strings unresolved", () => {
    expect(resolveCurrentTaskCAktrCode("PLT044")).toEqual({
      status: "unresolved",
      code: "PLT044",
    });
    expect(resolveCurrentTaskCAktrCode("not a code")).toEqual({
      status: "unresolved",
      code: "NOT A CODE",
    });
  });
});
