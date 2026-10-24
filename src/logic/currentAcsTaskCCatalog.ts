/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation I (Preflight Preparation), Task C (Weather Information).
 *
 * Source: FAA-S-ACS-6C, printed pages 3–4 / PDF pages 11–12.
 *
 * This is an explicit partial slice limited to PA.I.C, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_TASK_C_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "3–4",
  pdfPages: "11–12",
  areaOfOperation: "Area of Operation I: Preflight Preparation",
  task: "Task C. Weather Information",
  coverageLabel: "PA.I.C",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentTaskCAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "I";
  task: "C";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_TASK_C_SOURCE;
}

const currentTaskCEntries = [
  ["PA.I.C.K1", "Sources of weather data (e.g., National Weather Service, Flight Service) for flight planning purposes."],
  ["PA.I.C.K2", "Acceptable weather products and resources required for preflight planning, current and forecast weather for departure, en route, and arrival phases of flight such as:"],
  ["PA.I.C.K2a", "Airport Observations (METAR and SPECI) and Pilot Observations (PIREP)"],
  ["PA.I.C.K2b", "Surface Analysis Chart, Ceiling and Visibility Chart (CVA)"],
  ["PA.I.C.K2c", "Terminal Aerodrome Forecasts (TAF)"],
  ["PA.I.C.K2d", "Graphical Forecasts for Aviation (GFA)"],
  ["PA.I.C.K2e", "Wind and Temperature Aloft Forecast (FB)"],
  ["PA.I.C.K2f", "Convective Outlook (AC)"],
  ["PA.I.C.K2g", "Inflight Aviation Weather Advisories including Airmen's Meteorological Information (AIRMET), Significant Meteorological Information (SIGMET), and Convective SIGMET"],
  ["PA.I.C.K3", "Meteorology applicable to the departure, en route, alternate, and destination under visual flight rules (VFR) in Visual Meteorological Conditions (VMC), including expected climate and hazardous conditions such as:"],
  ["PA.I.C.K3a", "Atmospheric composition and stability"],
  ["PA.I.C.K3b", "Wind (e.g., windshear, mountain wave, factors affecting wind, etc.)"],
  ["PA.I.C.K3c", "Temperature and heat exchange"],
  ["PA.I.C.K3d", "Moisture/precipitation"],
  ["PA.I.C.K3e", "Weather system formation, including air masses and fronts"],
  ["PA.I.C.K3f", "Clouds"],
  ["PA.I.C.K3g", "Turbulence"],
  ["PA.I.C.K3h", "Thunderstorms and microbursts"],
  ["PA.I.C.K3i", "Icing and freezing level information"],
  ["PA.I.C.K3j", "Fog/mist"],
  ["PA.I.C.K3k", "Frost"],
  ["PA.I.C.K3l", "Obstructions to visibility (e.g., smoke, haze, volcanic ash, etc.)"],
  ["PA.I.C.K4", "Flight deck instrument displays of digital weather and aeronautical information."],
  ["PA.I.C.R1", "Making the go/no-go and continue/divert decisions, including:"],
  ["PA.I.C.R1a", "Circumstances that would make diversion prudent"],
  ["PA.I.C.R1b", "Personal weather minimums"],
  ["PA.I.C.R1c", "Hazardous weather conditions, including known or forecast icing or turbulence aloft"],
  ["PA.I.C.R2", "Use and limitations of:"],
  ["PA.I.C.R2a", "Installed onboard weather equipment"],
  ["PA.I.C.R2b", "Aviation weather reports and forecasts"],
  ["PA.I.C.R2c", "Inflight weather resources"],
  ["PA.I.C.S1", "Use available aviation weather resources to obtain an adequate weather briefing."],
  ["PA.I.C.S2", "Analyze the implications of at least three of the conditions listed in K3a through K3l, using actual weather or weather conditions provided by the evaluator."],
  ["PA.I.C.S3", "Correlate weather information to make a go/no-go decision."],
] as const;

/** All 34 current PA.I.C codes from FAA-S-ACS-6C pages 3–4. */
export const CURRENT_PRIVATE_AIRPLANE_TASK_C_CODES: readonly CurrentTaskCAktrCode[] =
  currentTaskCEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "I",
    task: "C",
    source: PRIVATE_AIRPLANE_ACS_6C_TASK_C_SOURCE,
  }));

export type CurrentTaskCCodeResolution =
  | { status: "current"; entry: CurrentTaskCAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.I.C slice.
 * Anything outside these 34 current entries remains unresolved.
 */
export function resolveCurrentTaskCAktrCode(code: string): CurrentTaskCCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_TASK_C_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
