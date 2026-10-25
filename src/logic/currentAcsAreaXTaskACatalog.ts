/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation X (Multiengine Operations), Task A (Maneuvering with One Engine Inoperative (AMEL, AMES)).
 *
 * Source: FAA-S-ACS-6C, printed pages 58–59 / PDF pages 65–66.
 *
 * This is an explicit partial slice limited to PA.X.A, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_A_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "58–59",
  pdfPages: "65–66",
  areaOfOperation: "Area of Operation X: Multiengine Operations",
  task: "Task A. Maneuvering with One Engine Inoperative (AMEL, AMES)",
  coverageLabel: "PA.X.A",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaXTaskAAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "X";
  task: "A";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_A_SOURCE;
}

const currentAreaXTaskAEntries = [
  ["PA.X.A.K1", "Factors affecting minimum controllable speed (VMC)."],
  [
    "PA.X.A.K2",
    "VMC (red line) and best single-engine rate of climb airspeed (VYSE) (blue line).",
  ],
  [
    "PA.X.A.K3",
    "How to identify, verify, feather, and secure an inoperative engine.",
  ],
  [
    "PA.X.A.K4",
    "Importance of drag reduction, including propeller feathering, gear and flap retraction, the manufacturer’s recommended control input and its relation to zero sideslip.",
  ],
  ["PA.X.A.K5", "Feathering, securing, unfeathering, and restarting."],
  ["PA.X.A.R1", "Potential engine failure during flight."],
  ["PA.X.A.R2", "Collision hazards."],
  ["PA.X.A.R3", "Configuring the airplane."],
  [
    "PA.X.A.R4",
    "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
  ],
  [
    "PA.X.A.R5",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  [
    "PA.X.A.S1",
    "Recognize an engine failure, maintain control, use manufacturer’s memory item procedures, and use appropriate emergency procedures.",
  ],
  [
    "PA.X.A.S2",
    "Set the engine controls, identify and verify the inoperative engine, and feather the appropriate propeller.",
  ],
  [
    "PA.X.A.S3",
    "Use flight controls in the proper combination as recommended by the manufacturer, or as required to maintain best performance, and trim as required.",
  ],
  [
    "PA.X.A.S4",
    "Attempt to determine and resolve the reason for the engine failure.",
  ],
  [
    "PA.X.A.S5",
    "Secure the inoperative engine and monitor the operating engine and make necessary adjustments.",
  ],
  [
    "PA.X.A.S6",
    "Restart the inoperative engine using manufacturer’s restart procedures.",
  ],
  [
    "PA.X.A.S7",
    "Maintain altitude ±100 feet or minimum sink rate if applicable, airspeed ±10 knots, and selected headings ±10°.",
  ],
  ["PA.X.A.S8", "Complete the appropriate checklist(s)."],
] as const;

/** All 18 current PA.X.A codes from FAA-S-ACS-6C pages 58–59. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_A_CODES: readonly CurrentAreaXTaskAAktrCode[] =
  currentAreaXTaskAEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "X",
    task: "A",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_A_SOURCE,
  }));

export type CurrentAreaXTaskACodeResolution =
  | { status: "current"; entry: CurrentAreaXTaskAAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.X.A slice.
 * Anything outside these 18 current entries remains unresolved.
 */
export function resolveCurrentAreaXTaskAAktrCode(
  code: string,
): CurrentAreaXTaskACodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_A_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
