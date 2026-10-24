/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IV (Takeoffs, Landings, and Go-Arounds), Task F (Short-Field Approach and Landing (ASEL, AMEL)).
 *
 * Source: FAA-S-ACS-6C, printed pages 24–25 / PDF pages 32–33.
 *
 * This is an explicit partial slice limited to PA.IV.F, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_F_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "24–25",
  pdfPages: "32–33",
  areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
  task: "Task F. Short-Field Approach and Landing (ASEL, AMEL)",
  coverageLabel: "PA.IV.F",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIVTaskFAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IV";
  task: "F";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_F_SOURCE;
}

const currentAreaIVTaskFEntries = [
  ["PA.IV.F.K1", "A stabilized approach, including energy management concepts."],
  ["PA.IV.F.K2", "Effects of atmospheric conditions, including wind, on approach and landing performance."],
  ["PA.IV.F.K3", "Wind correction techniques on approach and landing."],
  ["PA.IV.F.R1", "Selection of runway based on pilot capability, airplane performance and limitations, available distance, and wind."],
  ["PA.IV.F.R2", "Effects of:"],
  ["PA.IV.F.R2a", "Crosswind"],
  ["PA.IV.F.R2b", "Windshear"],
  ["PA.IV.F.R2c", "Tailwind"],
  ["PA.IV.F.R2d", "Wake turbulence"],
  ["PA.IV.F.R2e", "Landing surface/condition"],
  ["PA.IV.F.R3", "Planning for:"],
  ["PA.IV.F.R3a", "Rejected landing and go-around"],
  ["PA.IV.F.R3b", "Land and hold short operations (LAHSO)"],
  ["PA.IV.F.R4", "Collision hazards."],
  ["PA.IV.F.R5", "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT)."],
  ["PA.IV.F.R6", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.IV.F.S1", "Complete the appropriate checklist(s)."],
  ["PA.IV.F.S2", "Make radio calls as appropriate."],
  ["PA.IV.F.S3", "Ensure the airplane is aligned with the correct/assigned runway."],
  ["PA.IV.F.S4", "Scan the landing runway and adjoining area for traffic and obstructions."],
  ["PA.IV.F.S5", "Select and aim for a suitable touchdown point considering the wind conditions, landing surface, and obstructions."],
  ["PA.IV.F.S6", "Establish the recommended approach and landing configuration, airspeed, and trim, and adjust pitch attitude and power as required to maintain a stabilized approach."],
  ["PA.IV.F.S7", "Maintain manufacturer’s published approach airspeed or in its absence not more than 1.3 VSO, +10/-5 knots with gust factor applied."],
  ["PA.IV.F.S8", "Maintain directional control and appropriate crosswind correction throughout the approach and landing."],
  ["PA.IV.F.S9", "Make smooth, timely, and correct control application before, during, and after touchdown."],
  ["PA.IV.F.S10", "Touch down at a proper pitch attitude within 200 feet beyond or on the specified point, threshold markings, or runway numbers, with no side drift, minimum float, and with the airplane's longitudinal axis aligned with and over the runway centerline."],
  ["PA.IV.F.S11", "Use manufacturer’s recommended procedures for airplane configuration and braking."],
  ["PA.IV.F.S12", "Execute a timely go-around if the approach cannot be made within the tolerances specified above or for any other condition that may result in an unsafe approach or landing."],
  ["PA.IV.F.S13", "Use runway incursion avoidance procedures, if applicable."],
] as const;

/** All 29 current PA.IV.F codes from FAA-S-ACS-6C pages 24–25. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_F_CODES: readonly CurrentAreaIVTaskFAktrCode[] =
  currentAreaIVTaskFEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IV",
    task: "F",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_F_SOURCE,
  }));

export type CurrentAreaIVTaskFCodeResolution =
  | { status: "current"; entry: CurrentAreaIVTaskFAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IV.F slice.
 * Anything outside these 29 current entries remains unresolved.
 */
export function resolveCurrentAreaIVTaskFAktrCode(
  code: string,
): CurrentAreaIVTaskFCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_F_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
