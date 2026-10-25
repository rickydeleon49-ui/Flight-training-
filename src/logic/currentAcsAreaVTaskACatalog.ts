/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation V (Performance Maneuvers and Ground Reference Maneuvers), Task A (Steep Turns).
 *
 * Source: FAA-S-ACS-6C, printed page 36 / PDF page 44.
 *
 * This is an explicit partial slice limited to PA.V.A, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_V_TASK_A_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "36",
  pdfPages: "44",
  areaOfOperation: "Area of Operation V: Performance Maneuvers and Ground Reference Maneuvers",
  task: "Task A. Steep Turns",
  coverageLabel: "PA.V.A",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaVTaskAAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "V";
  task: "A";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_V_TASK_A_SOURCE;
}

const currentAreaVTaskAEntries = [
  ["PA.V.A.K1", "How to conduct a proper steep turn."],
  ["PA.V.A.K2", "Aerodynamics associated with steep turns, including:"],
  ["PA.V.A.K2a", "Maintaining coordinated flight"],
  ["PA.V.A.K2b", "Overbanking tendencies"],
  ["PA.V.A.K2c", "Maneuvering speed, including the impact of weight changes"],
  ["PA.V.A.K2d", "Load factor and accelerated stalls"],
  ["PA.V.A.K2e", "Rate and radius of turn"],
  ["PA.V.A.R1", "Division of attention between aircraft control and orientation."],
  ["PA.V.A.R2", "Collision hazards."],
  ["PA.V.A.R3", "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT)."],
  ["PA.V.A.R4", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.V.A.R5", "Uncoordinated flight."],
  ["PA.V.A.S1", "Clear the area."],
  ["PA.V.A.S2", "Establish the manufacturer's recommended airspeed; or if one is not available, an airspeed not to exceed the maneuvering speed (VA)."],
  ["PA.V.A.S3", "Roll into a coordinated 360° steep turn with approximately a 45° bank."],
  ["PA.V.A.S4", "Perform the Task in the opposite direction, as specified by evaluator."],
  ["PA.V.A.S5", "Maintain the entry altitude ±100 feet, airspeed ±10 knots, bank ±5°, and roll out on the entry heading ±10°."],
] as const;

/** All 17 current PA.V.A codes from FAA-S-ACS-6C page 36. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_A_CODES: readonly CurrentAreaVTaskAAktrCode[] =
  currentAreaVTaskAEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "V",
    task: "A",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_V_TASK_A_SOURCE,
  }));

export type CurrentAreaVTaskACodeResolution =
  | { status: "current"; entry: CurrentAreaVTaskAAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.V.A slice.
 * Anything outside these 17 current entries remains unresolved.
 */
export function resolveCurrentAreaVTaskAAktrCode(
  code: string,
): CurrentAreaVTaskACodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_A_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
