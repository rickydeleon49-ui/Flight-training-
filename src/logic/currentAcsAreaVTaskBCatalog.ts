/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation V (Performance Maneuvers and Ground Reference Maneuvers), Task B (Ground Reference Maneuvers).
 *
 * Source: FAA-S-ACS-6C, printed pages 36–37 / PDF pages 44–45.
 *
 * This is an explicit partial slice limited to PA.V.B, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_V_TASK_B_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "36–37",
  pdfPages: "44–45",
  areaOfOperation: "Area of Operation V: Performance Maneuvers and Ground Reference Maneuvers",
  task: "Task B. Ground Reference Maneuvers",
  coverageLabel: "PA.V.B",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaVTaskBAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "V";
  task: "B";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_V_TASK_B_SOURCE;
}

const currentAreaVTaskBEntries = [
  ["PA.V.B.K1", "Purpose of ground reference maneuvers."],
  ["PA.V.B.K2", "Effects of wind on ground track and relation to a ground reference."],
  ["PA.V.B.K3", "Effects of bank angle and groundspeed on rate and radius of turn."],
  ["PA.V.B.K4", "Relationship of rectangular course to airport traffic pattern."],
  ["PA.V.B.R1", "Division of attention between aircraft control and orientation."],
  ["PA.V.B.R2", "Collision hazards."],
  ["PA.V.B.R3", "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT)."],
  ["PA.V.B.R4", "Distractions, task prioritization, loss of situational awareness, or disorientation."],
  ["PA.V.B.R5", "Uncoordinated flight."],
  ["PA.V.B.S1", "Clear the area."],
  ["PA.V.B.S2", "Select a suitable ground reference area, line, or point as appropriate."],
  ["PA.V.B.S3", "Plan the maneuver:"],
  [
    "PA.V.B.S3a",
    "Rectangular course: enter a left or right pattern, 600 to 1,000 feet above ground level (AGL) at an appropriate distance from the selected reference area, 45° to the downwind leg",
  ],
  [
    "PA.V.B.S3b",
    "S-turns: enter perpendicular to the selected reference line, 600 to 1,000 feet AGL at an appropriate distance from the selected reference area",
  ],
  [
    "PA.V.B.S3c",
    "Turns around a point: enter at an appropriate distance from the reference point, 600 to 1,000 feet AGL at an appropriate distance from the selected reference area",
  ],
  [
    "PA.V.B.S4",
    "Apply adequate wind-drift correction during straight and turning flight to maintain a constant ground track around a rectangular reference area, or to maintain a constant radius turn on each side of a selected reference line or point.",
  ],
  [
    "PA.V.B.S5",
    "If performing S-Turns, reverse the turn directly over the selected reference line; if performing turns around a point, complete turns in either direction, as specified by the evaluator.",
  ],
  [
    "PA.V.B.S6",
    "Divide attention between airplane control, traffic avoidance and the ground track while maintaining coordinated flight.",
  ],
  ["PA.V.B.S7", "Maintain altitude ±100 feet; maintain airspeed ±10 knots."],
] as const;

/** All 19 current PA.V.B codes from FAA-S-ACS-6C pages 36–37. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_B_CODES: readonly CurrentAreaVTaskBAktrCode[] =
  currentAreaVTaskBEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "V",
    task: "B",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_V_TASK_B_SOURCE,
  }));

export type CurrentAreaVTaskBCodeResolution =
  | { status: "current"; entry: CurrentAreaVTaskBAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.V.B slice.
 * Anything outside these 19 current entries remains unresolved.
 */
export function resolveCurrentAreaVTaskBAktrCode(
  code: string,
): CurrentAreaVTaskBCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_V_TASK_B_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
