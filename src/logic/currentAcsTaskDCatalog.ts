/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation I (Preflight Preparation), Task D (Cross-Country Flight Planning).
 *
 * Source: FAA-S-ACS-6C, printed page 5 / PDF page 13.
 *
 * This is an explicit partial slice limited to PA.I.D, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_TASK_D_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "5",
  pdfPages: "13",
  areaOfOperation: "Area of Operation I: Preflight Preparation",
  task: "Task D. Cross-Country Flight Planning",
  coverageLabel: "PA.I.D",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentTaskDAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "I";
  task: "D";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_TASK_D_SOURCE;
}

const currentTaskDEntries = [
  ["PA.I.D.K1", "Route planning, including consideration of different classes and special use airspace (SUA) and selection of appropriate and available navigation/communication systems and facilities."],
  ["PA.I.D.K1a", "Use of an electronic flight bag (EFB), if used"],
  ["PA.I.D.K2", "Altitude selection accounting for terrain and obstacles, glide distance of airplane, VFR cruising altitudes, and effect of wind."],
  ["PA.I.D.K3", "Calculating:"],
  ["PA.I.D.K3a", "Time, climb and descent rates, course, distance, heading, true airspeed, and groundspeed"],
  ["PA.I.D.K3b", "Estimated time of arrival, including conversion to universal coordinated time (UTC)"],
  ["PA.I.D.K3c", "Fuel requirements, including reserve"],
  ["PA.I.D.K4", "Elements of a VFR flight plan."],
  ["PA.I.D.K5", "Procedures for filing, activating, and closing a VFR flight plan."],
  ["PA.I.D.K6", "Inflight intercept procedures."],
  ["PA.I.D.R1", "Pilot."],
  ["PA.I.D.R2", "Aircraft."],
  ["PA.I.D.R3", "Environment (e.g., weather, airports, airspace, terrain, obstacles)."],
  ["PA.I.D.R4", "External pressures."],
  ["PA.I.D.R5", "Limitations of air traffic control (ATC) services."],
  ["PA.I.D.R6", "Fuel planning."],
  ["PA.I.D.R7", "Use of an electronic flight bag (EFB), if used."],
  ["PA.I.D.S1", "Prepare, present, and explain a cross-country flight plan assigned by the evaluator, including a risk analysis based on real-time weather, to the first fuel stop."],
  ["PA.I.D.S2", "Apply pertinent information from appropriate and current aeronautical charts, Chart Supplements; Notices to Air Missions (NOTAMs) relative to airport, runway and taxiway closures; and other flight publications."],
  ["PA.I.D.S3", "Create a navigation plan and simulate filing a VFR flight plan."],
  ["PA.I.D.S4", "Recalculate fuel reserves based on a scenario provided by the evaluator."],
  ["PA.I.D.S5", "Use an electronic flight bag (EFB), if applicable."],
] as const;

/** All 22 current PA.I.D codes from FAA-S-ACS-6C page 5. */
export const CURRENT_PRIVATE_AIRPLANE_TASK_D_CODES: readonly CurrentTaskDAktrCode[] =
  currentTaskDEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "I",
    task: "D",
    source: PRIVATE_AIRPLANE_ACS_6C_TASK_D_SOURCE,
  }));

export type CurrentTaskDCodeResolution =
  | { status: "current"; entry: CurrentTaskDAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.I.D slice.
 * Anything outside these 22 current entries remains unresolved.
 */
export function resolveCurrentTaskDAktrCode(code: string): CurrentTaskDCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_TASK_D_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
