/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation VI (Navigation), Task A (Pilotage and Dead Reckoning).
 *
 * Source: FAA-S-ACS-6C, printed pages 38–39 / PDF pages 46–47.
 *
 * This is an explicit partial slice limited to PA.VI.A, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_A_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "38–39",
  pdfPages: "46–47",
  areaOfOperation: "Area of Operation VI: Navigation",
  task: "Task A. Pilotage and Dead Reckoning",
  coverageLabel: "PA.VI.A",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaVITaskAAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "VI";
  task: "A";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_A_SOURCE;
}

const currentAreaVITaskAEntries = [
  ["PA.VI.A.K1", "Pilotage and dead reckoning."],
  ["PA.VI.A.K2", "Magnetic compass errors."],
  ["PA.VI.A.K3", "Topography."],
  ["PA.VI.A.K4", "Selection of appropriate:"],
  ["PA.VI.A.K4a", "Route"],
  ["PA.VI.A.K4b", "Altitude(s)"],
  ["PA.VI.A.K4c", "Checkpoints"],
  ["PA.VI.A.K5", "Plotting a course, including:"],
  ["PA.VI.A.K5a", "Determining heading, speed, and course"],
  ["PA.VI.A.K5b", "Wind correction angle"],
  ["PA.VI.A.K5c", "Estimating time, speed, and distance"],
  ["PA.VI.A.K5d", "True airspeed and density altitude"],
  ["PA.VI.A.K6", "Power setting selection."],
  ["PA.VI.A.K7", "Planned calculations versus actual results and required corrections."],
  ["PA.VI.A.R1", "Collision hazards."],
  ["PA.VI.A.R2", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.VI.A.R3", "Unplanned fuel/power consumption, if applicable."],
  ["PA.VI.A.S1", "Prepare and use a flight log."],
  ["PA.VI.A.S2", "Navigate by pilotage."],
  ["PA.VI.A.S3", "Navigate by means of pre-computed headings, groundspeeds, elapsed time, and reference to landmarks or checkpoints."],
  ["PA.VI.A.S4", "Use the magnetic direction indicator in navigation, including turns to headings."],
  ["PA.VI.A.S5", "Verify position within three nautical miles of the flight-planned route."],
  ["PA.VI.A.S6", "Arrive at the en route checkpoints within five minutes of the initial or revised estimated time of arrival (ETA) and provide a destination estimate."],
  ["PA.VI.A.S7", "Maintain the selected altitude, ±200 feet and heading, ±15°."],
] as const;

/** All 24 current PA.VI.A codes from FAA-S-ACS-6C pages 38–39. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_A_CODES: readonly CurrentAreaVITaskAAktrCode[] =
  currentAreaVITaskAEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "VI",
    task: "A",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_A_SOURCE,
  }));

export type CurrentAreaVITaskACodeResolution =
  | { status: "current"; entry: CurrentAreaVITaskAAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.VI.A slice.
 * Anything outside these 24 current entries remains unresolved.
 */
export function resolveCurrentAreaVITaskAAktrCode(
  code: string,
): CurrentAreaVITaskACodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_A_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
