/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation X (Multiengine Operations), Task C (One Engine Inoperative (Simulated) During Straight-and-Level Flight and Turns (AMEL, AMES)).
 *
 * Source: FAA-S-ACS-6C, printed pages 61–62 / PDF pages 68–69.
 *
 * This is an explicit partial slice limited to PA.X.C, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_C_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "61–62",
  pdfPages: "68–69",
  areaOfOperation: "Area of Operation X: Multiengine Operations",
  task: "Task C. One Engine Inoperative (Simulated) During Straight-and-Level Flight and Turns (AMEL, AMES)",
  coverageLabel: "PA.X.C",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaXTaskCAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "X";
  task: "C";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_C_SOURCE;
}

const currentAreaXTaskCEntries = [
  [
    "PA.X.C.K1",
    "Procedures used if engine failure occurs during straight-and-level flight and turns while on instruments.",
  ],
  ["PA.X.C.R1", "Identification of the inoperative engine."],
  [
    "PA.X.C.R2",
    "Inability to climb or maintain altitude with an inoperative engine.",
  ],
  [
    "PA.X.C.R3",
    "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
  ],
  [
    "PA.X.C.R4",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  ["PA.X.C.R5", "Fuel management during single-engine operation."],
  [
    "PA.X.C.S1",
    "Promptly recognize an engine failure and maintain positive aircraft control.",
  ],
  [
    "PA.X.C.S2",
    "Set the engine controls, reduce drag, identify and verify the inoperative engine, and simulate feathering of the propeller on the inoperative engine (evaluator should then establish zero thrust on the inoperative engine).",
  ],
  [
    "PA.X.C.S3",
    "Establish the best engine-inoperative airspeed and trim the airplane.",
  ],
  [
    "PA.X.C.S4",
    "Use flight controls in the proper combination as recommended by the manufacturer, or as required to maintain best performance, and trim as required.",
  ],
  [
    "PA.X.C.S5",
    "Verify the prescribed checklist procedures used for securing the inoperative engine.",
  ],
  [
    "PA.X.C.S6",
    "Attempt to determine and resolve the reason for the engine failure.",
  ],
  ["PA.X.C.S7", "Monitor engine functions and make necessary adjustments."],
  [
    "PA.X.C.S8",
    "Maintain the specified altitude ±100 feet or minimum sink rate if applicable, airspeed ±10 knots, and the specified heading ±10°.",
  ],
  [
    "PA.X.C.S9",
    "Assess the aircraft’s performance capability and decide an appropriate action to ensure a safe landing.",
  ],
  [
    "PA.X.C.S10",
    "Avoid loss of airplane control or attempted flight contrary to the engine-inoperative operating limitations of the airplane.",
  ],
  [
    "PA.X.C.S11",
    "Use single-pilot resource management (SRM) or crew resource management (CRM), as appropriate.",
  ],
] as const;

/** All 17 current PA.X.C codes from FAA-S-ACS-6C pages 61–62. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_C_CODES: readonly CurrentAreaXTaskCAktrCode[] =
  currentAreaXTaskCEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "X",
    task: "C",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_C_SOURCE,
  }));

export type CurrentAreaXTaskCCodeResolution =
  | { status: "current"; entry: CurrentAreaXTaskCAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.X.C slice.
 * Anything outside these 17 current entries remains unresolved.
 */
export function resolveCurrentAreaXTaskCAktrCode(
  code: string,
): CurrentAreaXTaskCCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_C_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
