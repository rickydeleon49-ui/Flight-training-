/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation X (Multiengine Operations), Task D (Instrument Approach and Landing with an Inoperative Engine (Simulated) (AMEL, AMES)).
 *
 * Source: FAA-S-ACS-6C, printed pages 62–63 / PDF pages 69–70.
 *
 * This is an explicit partial slice limited to PA.X.D, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_D_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "62–63",
  pdfPages: "69–70",
  areaOfOperation: "Area of Operation X: Multiengine Operations",
  task: "Task D. Instrument Approach and Landing with an Inoperative Engine (Simulated) (AMEL, AMES)",
  coverageLabel: "PA.X.D",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaXTaskDAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "X";
  task: "D";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_D_SOURCE;
}

const currentAreaXTaskDEntries = [
  [
    "PA.X.D.K1",
    "Instrument approach procedures with one engine inoperative.",
  ],
  [
    "PA.X.D.R1",
    "Potential engine failure during approach and landing.",
  ],
  ["PA.X.D.R2", "Collision hazards."],
  ["PA.X.D.R3", "Configuring the airplane."],
  [
    "PA.X.D.R4",
    "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
  ],
  [
    "PA.X.D.R5",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  [
    "PA.X.D.R6",
    "Performing a go-around/rejected landing with an engine failure.",
  ],
  [
    "PA.X.D.S1",
    "Promptly recognize an engine failure and maintain positive aircraft control.",
  ],
  [
    "PA.X.D.S2",
    "Set the engine controls, reduce drag, identify and verify the inoperative engine, and simulate feathering of the propeller on the inoperative engine (evaluator should then establish zero thrust on the inoperative engine).",
  ],
  [
    "PA.X.D.S3",
    "Use flight controls in the proper combination as recommended by the manufacturer, or as required to maintain best performance, and trim as required.",
  ],
  [
    "PA.X.D.S4",
    "Follow the manufacturer’s recommended emergency procedures and complete the appropriate checklist.",
  ],
  [
    "PA.X.D.S5",
    "Monitor the operating engine and aircraft systems and make adjustments as necessary.",
  ],
  [
    "PA.X.D.S6",
    "Request and follow an actual or a simulated air traffic control (ATC) clearance for an instrument approach.",
  ],
  [
    "PA.X.D.S7",
    "Maintain altitude ±100 feet or minimum sink rate if applicable, airspeed ±10 knots, and selected heading ±10°.",
  ],
  [
    "PA.X.D.S8",
    "Establish a rate of descent that ensures arrival at the minimum descent altitude (MDA) or decision altitude (DA)/decision height (DH) with the airplane in a position from which a descent to a landing on the intended runway or landing path can be made, either straight in or circling as appropriate.",
  ],
  [
    "PA.X.D.S9",
    "On final approach segment, maintain vertical (as applicable) and lateral guidance within ¾-scale deflection.",
  ],
  [
    "PA.X.D.S10",
    "Avoid loss of airplane control or attempted flight contrary to the operating limitations of the airplane.",
  ],
  [
    "PA.X.D.S11",
    "Comply with the published criteria for the aircraft approach category if circling.",
  ],
  ["PA.X.D.S12", "Execute a landing."],
  ["PA.X.D.S13", "Complete the appropriate checklist(s)."],
] as const;

/** All 20 current PA.X.D codes from FAA-S-ACS-6C pages 62–63. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_D_CODES: readonly CurrentAreaXTaskDAktrCode[] =
  currentAreaXTaskDEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "X",
    task: "D",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_X_TASK_D_SOURCE,
  }));

export type CurrentAreaXTaskDCodeResolution =
  | { status: "current"; entry: CurrentAreaXTaskDAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.X.D slice.
 * Anything outside these 20 current entries remains unresolved.
 */
export function resolveCurrentAreaXTaskDAktrCode(
  code: string,
): CurrentAreaXTaskDCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_X_TASK_D_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
