/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IX (Emergency Operations), Task G (Approach and Landing with an Inoperative Engine (Simulated) (AMEL, AMES)).
 *
 * Source: FAA-S-ACS-6C, printed pages 57–58 / PDF pages 64–65.
 *
 * This is an explicit partial slice limited to PA.IX.G, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_G_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "57–58",
  pdfPages: "64–65",
  areaOfOperation: "Area of Operation IX: Emergency Operations",
  task: "Task G. Approach and Landing with an Inoperative Engine (Simulated) (AMEL, AMES)",
  coverageLabel: "PA.IX.G",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIXTaskGAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IX";
  task: "G";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_G_SOURCE;
}

const currentAreaIXTaskGEntries = [
  ["PA.IX.G.K1", "Factors affecting minimum controllable speed (VMC)."],
  [
    "PA.IX.G.K2",
    "VMC (red line) and best single-engine rate of climb airspeed (VYSE) (blue line).",
  ],
  [
    "PA.IX.G.K3",
    "How to identify, verify, feather, and secure an inoperative engine.",
  ],
  [
    "PA.IX.G.K4",
    "Importance of drag reduction, including propeller feathering, gear and flap retraction, the manufacturer’s recommended control input and its relation to zero sideslip.",
  ],
  ["PA.IX.G.K5", "Applicant responsibilities during simulated feathering."],
  [
    "PA.IX.G.R1",
    "Potential engine failure inflight or during an approach.",
  ],
  ["PA.IX.G.R2", "Collision hazards."],
  ["PA.IX.G.R3", "Configuring the airplane."],
  [
    "PA.IX.G.R4",
    "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
  ],
  [
    "PA.IX.G.R5",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  ["PA.IX.G.R6", "Possible single-engine go-around."],
  [
    "PA.IX.G.S1",
    "Promptly recognize an engine failure and maintain positive aircraft control.",
  ],
  [
    "PA.IX.G.S2",
    "Set the engine controls, reduce drag, identify and verify the inoperative engine, and simulate feathering of the propeller on the inoperative engine (evaluator should then establish zero thrust on the inoperative engine).",
  ],
  [
    "PA.IX.G.S3",
    "Use flight controls in the proper combination as recommended by the manufacturer, or as required to maintain best performance, and trim as required.",
  ],
  [
    "PA.IX.G.S4",
    "Follow the manufacturer’s recommended emergency procedures and complete the appropriate checklist.",
  ],
  [
    "PA.IX.G.S5",
    "Monitor the operating engine and aircraft systems and make adjustments as necessary.",
  ],
  [
    "PA.IX.G.S6",
    "Maintain the manufacturer’s recommended approach airspeed +10/-5 knots, in the landing configuration with a stabilized approach, until landing is assured.",
  ],
  [
    "PA.IX.G.S7",
    "Make smooth, timely, and correct control application before, during, and after touchdown.",
  ],
  [
    "PA.IX.G.S8",
    "Touch down on the first one-third of available runway/landing surface, with no drift, and the airplane’s longitudinal axis aligned with and over the runway center or landing path.",
  ],
  [
    "PA.IX.G.S9",
    "Maintain directional control and appropriate crosswind correction throughout the approach and landing.",
  ],
  ["PA.IX.G.S10", "Complete the appropriate checklist(s)."],
] as const;

/** All 21 current PA.IX.G codes from FAA-S-ACS-6C pages 57–58. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_G_CODES: readonly CurrentAreaIXTaskGAktrCode[] =
  currentAreaIXTaskGEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IX",
    task: "G",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_G_SOURCE,
  }));

export type CurrentAreaIXTaskGCodeResolution =
  | { status: "current"; entry: CurrentAreaIXTaskGAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IX.G slice.
 * Anything outside these 21 current entries remains unresolved.
 */
export function resolveCurrentAreaIXTaskGAktrCode(
  code: string,
): CurrentAreaIXTaskGCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_G_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
