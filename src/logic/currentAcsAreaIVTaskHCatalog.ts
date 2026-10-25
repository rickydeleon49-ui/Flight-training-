/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IV (Takeoffs, Landings, and Go-Arounds), Task H (Confined Area Approach and Landing (ASES, AMES)).
 *
 * Source: FAA-S-ACS-6C, printed pages 27–28 / PDF pages 35–36.
 *
 * This is an explicit partial slice limited to PA.IV.H, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_H_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "27–28",
  pdfPages: "35–36",
  areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
  task: "Task H. Confined Area Approach and Landing (ASES, AMES)",
  coverageLabel: "PA.IV.H",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIVTaskHAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IV";
  task: "H";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_H_SOURCE;
}

const currentAreaIVTaskHEntries = [
  ["PA.IV.H.K1", "A stabilized approach, including energy management concepts."],
  ["PA.IV.H.K2", "Effects of atmospheric conditions, including wind, on approach and landing performance."],
  ["PA.IV.H.K3", "Wind correction techniques on approach and landing."],
  ["PA.IV.H.R1", "Selection of approach path and touchdown area based on pilot capability, airplane performance and limitations, available distance, and wind."],
  ["PA.IV.H.R2", "Effects of:"],
  ["PA.IV.H.R2a", "Crosswind"],
  ["PA.IV.H.R2b", "Windshear"],
  ["PA.IV.H.R2c", "Tailwind"],
  ["PA.IV.H.R2d", "Wake turbulence"],
  ["PA.IV.H.R2e", "Water surface/condition"],
  ["PA.IV.H.R3", "Planning for a go-around and rejected landing."],
  ["PA.IV.H.R4", "Collision hazards."],
  ["PA.IV.H.R5", "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT)."],
  ["PA.IV.H.R6", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.IV.H.S1", "Complete the appropriate checklist(s)."],
  ["PA.IV.H.S2", "Make radio calls as appropriate."],
  ["PA.IV.H.S3", "Ensure the airplane is aligned for an approach to the correct/assigned landing surface."],
  ["PA.IV.H.S4", "Scan the landing area for traffic and obstructions."],
  ["PA.IV.H.S5", "Select and aim for a suitable touchdown point considering the wind conditions, landing surface, and obstructions."],
  ["PA.IV.H.S6", "Establish the recommended approach and landing configuration, airspeed, and trim, and adjust pitch attitude and power as required to maintain a stabilized approach."],
  ["PA.IV.H.S7", "Maintain manufacturer’s published approach airspeed or in its absence not more than 1.3 VSO, +10/-5 knots with gust factor applied."],
  ["PA.IV.H.S8", "Maintain directional control and appropriate crosswind correction throughout the approach and landing."],
  ["PA.IV.H.S9", "Make smooth, timely, and correct control application before, during, and after touchdown."],
  ["PA.IV.H.S10", "Contact the water at the recommended airspeed with a proper pitch attitude for the surface conditions."],
  ["PA.IV.H.S11", "Touch down at a proper pitch attitude, within 200 feet beyond or on the specified point, with no side drift, minimum float, and with the airplane’s longitudinal axis aligned with the projected landing path."],
  ["PA.IV.H.S12", "Execute a timely go-around if the approach cannot be made within the tolerances specified above or for any other condition that may result in an unsafe approach or landing."],
  ["PA.IV.H.S13", "Apply elevator control as necessary to stop in the shortest distance consistent with safety."],
] as const;

/** All 27 current PA.IV.H codes from FAA-S-ACS-6C pages 27–28. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_H_CODES: readonly CurrentAreaIVTaskHAktrCode[] =
  currentAreaIVTaskHEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IV",
    task: "H",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_H_SOURCE,
  }));

export type CurrentAreaIVTaskHCodeResolution =
  | { status: "current"; entry: CurrentAreaIVTaskHAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IV.H slice.
 * Anything outside these 27 current entries remains unresolved.
 */
export function resolveCurrentAreaIVTaskHAktrCode(
  code: string,
): CurrentAreaIVTaskHCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_H_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
