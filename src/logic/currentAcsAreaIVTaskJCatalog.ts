/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IV (Takeoffs, Landings, and Go-Arounds), Task J (Glassy Water Approach and Landing (ASES, AMES)).
 *
 * Source: FAA-S-ACS-6C, printed page 30 / PDF page 38.
 *
 * This is an explicit partial slice limited to PA.IV.J, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_J_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "30",
  pdfPages: "38",
  areaOfOperation: "Area of Operation IV: Takeoffs, Landings, and Go-Arounds",
  task: "Task J. Glassy Water Approach and Landing (ASES, AMES)",
  coverageLabel: "PA.IV.J",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIVTaskJAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IV";
  task: "J";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_J_SOURCE;
}

const currentAreaIVTaskJEntries = [
  ["PA.IV.J.K1", "A stabilized approach, including energy management concepts."],
  ["PA.IV.J.K2", "Effects of atmospheric conditions, including wind, on approach and landing performance."],
  ["PA.IV.J.K3", "When and why glassy water techniques are used."],
  ["PA.IV.J.K4", "How a glassy water approach and landing is executed."],
  ["PA.IV.J.R1", "Selection of approach path and touchdown area based on pilot capability, airplane performance and limitations, and available distance."],
  ["PA.IV.J.R2", "Water surface/condition."],
  ["PA.IV.J.R3", "Planning for a go-around and rejected landing."],
  ["PA.IV.J.R4", "Collision hazards."],
  ["PA.IV.J.R5", "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT)."],
  ["PA.IV.J.R6", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.IV.J.R7", "Gear position in an amphibious airplane."],
  ["PA.IV.J.S1", "Complete the appropriate checklist(s)."],
  ["PA.IV.J.S2", "Make radio calls as appropriate."],
  ["PA.IV.J.S3", "Scan the landing area for traffic and obstructions."],
  ["PA.IV.J.S4", "Select a proper approach and landing path considering the landing surface, visual attitude references, water depth, and collision hazards."],
  ["PA.IV.J.S5", "Establish the recommended approach and landing configuration, airspeed, and trim, and adjust pitch attitude and power as required to maintain a stabilized approach."],
  ["PA.IV.J.S6", "Maintain manufacturer’s published approach airspeed or in its absence not more than 1.3 VSO, +10/-5 knots."],
  ["PA.IV.J.S7", "Make smooth, timely, and correct power and control adjustments to maintain proper pitch attitude and rate of descent to touchdown."],
  ["PA.IV.J.S8", "Contact the water in a proper pitch attitude, and slow to idle taxi speed."],
  ["PA.IV.J.S9", "Maintain directional control throughout the approach and landing."],
] as const;

/** All 20 current PA.IV.J codes from FAA-S-ACS-6C page 30. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_J_CODES: readonly CurrentAreaIVTaskJAktrCode[] =
  currentAreaIVTaskJEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IV",
    task: "J",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IV_TASK_J_SOURCE,
  }));

export type CurrentAreaIVTaskJCodeResolution =
  | { status: "current"; entry: CurrentAreaIVTaskJAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IV.J slice.
 * Anything outside these 20 current entries remains unresolved.
 */
export function resolveCurrentAreaIVTaskJAktrCode(
  code: string,
): CurrentAreaIVTaskJCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IV_TASK_J_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
