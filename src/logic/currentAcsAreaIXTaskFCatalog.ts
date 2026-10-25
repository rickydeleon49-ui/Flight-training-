/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IX (Emergency Operations), Task F (Engine Failure After Liftoff (Simulated) (AMEL, AMES)).
 *
 * Source: FAA-S-ACS-6C, printed pages 56–57 / PDF pages 63–64.
 *
 * This is an explicit partial slice limited to PA.IX.F, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_F_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "56–57",
  pdfPages: "63–64",
  areaOfOperation: "Area of Operation IX: Emergency Operations",
  task: "Task F. Engine Failure After Liftoff (Simulated) (AMEL, AMES)",
  coverageLabel: "PA.IX.F",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIXTaskFAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IX";
  task: "F";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_F_SOURCE;
}

const currentAreaIXTaskFEntries = [
  ["PA.IX.F.K1", "Factors affecting minimum controllable speed (VMC)."],
  [
    "PA.IX.F.K2",
    "VMC (red line), VYSE (blue line), and safe single-engine speed (VSSE).",
  ],
  ["PA.IX.F.K3", "Accelerate/stop and accelerate/go distances."],
  [
    "PA.IX.F.K4",
    "How to identify, verify, feather, and secure an inoperative engine.",
  ],
  [
    "PA.IX.F.K5",
    "Importance of drag reduction, including propeller feathering, gear and flap retraction, the manufacturer’s recommended control input and its relation to zero sideslip.",
  ],
  [
    "PA.IX.F.K6",
    "Simulated propeller feathering and the evaluator’s zero-thrust procedures and responsibilities.",
  ],
  ["PA.IX.F.R1", "Potential engine failure after lift-off."],
  ["PA.IX.F.R2", "Collision hazards."],
  ["PA.IX.F.R3", "Configuring the airplane."],
  [
    "PA.IX.F.R4",
    "Low altitude maneuvering, including stall, spin, or controlled flight into terrain (CFIT).",
  ],
  [
    "PA.IX.F.R5",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  [
    "PA.IX.F.S1",
    "Promptly recognize an engine failure, maintain control, and use appropriate emergency procedures.",
  ],
  [
    "PA.IX.F.S2",
    "Establish VYSE; if obstructions are present, establish best single-engine angle of climb speed (VXSE) or VMC +5 knots, whichever is greater, until obstructions are cleared. Then transition to VYSE.",
  ],
  [
    "PA.IX.F.S3",
    "Reduce drag by retracting landing gear and flaps in accordance with the manufacturer’s guidance.",
  ],
  [
    "PA.IX.F.S4",
    "Simulate feathering the propeller on the inoperative engine (evaluator should then establish zero thrust on the inoperative engine).",
  ],
  [
    "PA.IX.F.S5",
    "Use flight controls in the proper combination as recommended by the manufacturer, or as required to maintain best performance, and trim as required.",
  ],
  [
    "PA.IX.F.S6",
    "Monitor the operating engine and aircraft systems and make adjustments as necessary.",
  ],
  [
    "PA.IX.F.S7",
    "Recognize the airplane’s performance capabilities. If a climb is not possible at VYSE, maintain VYSE and return to the departure airport for landing, or initiate an approach to the most suitable landing area available.",
  ],
  ["PA.IX.F.S8", "Simulate securing the inoperative engine."],
  ["PA.IX.F.S9", "Maintain heading ±10° and airspeed ±5 knots."],
  ["PA.IX.F.S10", "Complete the appropriate checklist(s)."],
] as const;

/** All 21 current PA.IX.F codes from FAA-S-ACS-6C pages 56–57. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_F_CODES: readonly CurrentAreaIXTaskFAktrCode[] =
  currentAreaIXTaskFEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IX",
    task: "F",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_F_SOURCE,
  }));

export type CurrentAreaIXTaskFCodeResolution =
  | { status: "current"; entry: CurrentAreaIXTaskFAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IX.F slice.
 * Anything outside these 21 current entries remains unresolved.
 */
export function resolveCurrentAreaIXTaskFAktrCode(
  code: string,
): CurrentAreaIXTaskFCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_F_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
