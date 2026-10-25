/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IV (Takeoffs, Landings, and Go-Arounds), Task D (Soft-Field Approach and Landing (ASEL)).
 *
 * Source: FAA-S-ACS-6C, printed pages 22–23 / PDF pages 30–31.
 *
 * This is an explicit partial slice limited to PA.IV.D, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_D_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "22–23",
  pdfPages: "30–31",
  areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
  task: "Task D. Soft-Field Approach and Landing (ASEL)",
  coverageLabel: "PA.IV.D",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIVTaskDAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IV";
  task: "D";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_D_SOURCE;
}

const currentAreaIVTaskDEntries = [
  ["PA.IV.D.K1", "A stabilized approach, including energy management concepts."],
  ["PA.IV.D.K2", "Effects of atmospheric conditions, including wind, on approach and landing performance."],
  ["PA.IV.D.K3", "Wind correction techniques on approach and landing."],
  ["PA.IV.D.R1", "Selection of runway based on pilot capability, airplane performance and limitations, available distance, and wind."],
  ["PA.IV.D.R2", "Effects of:"],
  ["PA.IV.D.R2a", "Crosswind"],
  ["PA.IV.D.R2b", "Windshear"],
  ["PA.IV.D.R2c", "Tailwind"],
  ["PA.IV.D.R2d", "Wake turbulence"],
  ["PA.IV.D.R2e", "Landing surface/condition"],
  ["PA.IV.D.R3", "Planning for:"],
  ["PA.IV.D.R3a", "Rejected landing and go-around"],
  ["PA.IV.D.R3b", "Land and hold short operations (LAHSO)"],
  ["PA.IV.D.R4", "Collision hazards."],
  ["PA.IV.D.R5", "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT)."],
  ["PA.IV.D.R6", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.IV.D.S1", "Complete the appropriate checklist(s)."],
  ["PA.IV.D.S2", "Make radio calls as appropriate."],
  ["PA.IV.D.S3", "Ensure the airplane is aligned with the correct/assigned runway."],
  ["PA.IV.D.S4", "Scan the landing runway and adjoining area for traffic and obstructions."],
  ["PA.IV.D.S5", "Select and aim for a suitable touchdown point considering the wind conditions, landing surface, and obstructions."],
  ["PA.IV.D.S6", "Establish the recommended approach and landing configuration, airspeed, and trim, and adjust pitch attitude and power as required to maintain a stabilized approach."],
  ["PA.IV.D.S7", "Maintain manufacturer’s published approach airspeed or in its absence not more than 1.3 VSO, +10/-5 knots with gust factor applied."],
  ["PA.IV.D.S8", "Maintain directional control and appropriate crosswind correction throughout the approach and landing."],
  ["PA.IV.D.S9", "Make smooth, timely, and correct control inputs during the round out and touchdown, and, for tricycle gear airplanes, keep the nose wheel off the surface until loss of elevator effectiveness."],
  ["PA.IV.D.S10", "Touch down at a proper pitch attitude with minimum sink rate, no side drift, and with the airplane’s longitudinal axis aligned with the center of the runway."],
  ["PA.IV.D.S11", "Maintain elevator as recommended by manufacturer during rollout and exit the “soft” area at a speed that would preclude sinking into the surface."],
  ["PA.IV.D.S12", "Execute a timely go-around if the approach cannot be made within the tolerances specified above or for any other condition that may result in an unsafe approach or landing."],
  ["PA.IV.D.S13", "Maintain proper position of the flight controls and sufficient speed to taxi while on the soft surface."],
] as const;

/** All 29 current PA.IV.D codes from FAA-S-ACS-6C pages 22–23. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_D_CODES: readonly CurrentAreaIVTaskDAktrCode[] =
  currentAreaIVTaskDEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IV",
    task: "D",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_D_SOURCE,
  }));

export type CurrentAreaIVTaskDCodeResolution =
  | { status: "current"; entry: CurrentAreaIVTaskDAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IV.D slice.
 * Anything outside these 29 current entries remains unresolved.
 */
export function resolveCurrentAreaIVTaskDAktrCode(
  code: string,
): CurrentAreaIVTaskDCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_D_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
