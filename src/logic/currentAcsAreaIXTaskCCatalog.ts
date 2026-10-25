/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IX (Emergency Operations), Task C (Systems and Equipment Malfunctions).
 *
 * Source: FAA-S-ACS-6C, printed pages 53–54 / PDF pages 60–61.
 *
 * This is an explicit partial slice limited to PA.IX.C, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_C_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "53–54",
  pdfPages: "60–61",
  areaOfOperation: "Area of Operation IX: Emergency Operations",
  task: "Task C. Systems and Equipment Malfunctions",
  coverageLabel: "PA.IX.C",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIXTaskCAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IX";
  task: "C";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_C_SOURCE;
}

const currentAreaIXTaskCEntries = [
  [
    "PA.IX.C.K1",
    "Causes of partial or complete power loss related to the specific type of powerplant(s).",
  ],
  ["PA.IX.C.K2", "System and equipment malfunctions specific to the aircraft, including:"],
  ["PA.IX.C.K2a", "Electrical malfunction"],
  ["PA.IX.C.K2b", "Vacuum/pressure and associated flight instrument malfunctions"],
  ["PA.IX.C.K2c", "Pitot-static system malfunction"],
  ["PA.IX.C.K2d", "Electronic flight deck display malfunction"],
  ["PA.IX.C.K2e", "Landing gear or flap malfunction"],
  ["PA.IX.C.K2f", "Inoperative trim"],
  ["PA.IX.C.K3", "Causes and remedies for smoke or fire onboard the aircraft."],
  ["PA.IX.C.K4", "Any other system specific to the aircraft (e.g., supplemental oxygen, deicing)."],
  ["PA.IX.C.K5", "Inadvertent door or window opening."],
  ["PA.IX.C.R1", "Checklist usage for a system or equipment malfunction."],
  [
    "PA.IX.C.R2",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  ["PA.IX.C.R3", "Undesired aircraft state."],
  ["PA.IX.C.R4", "Startle response."],
  [
    "PA.IX.C.S1",
    "Determine appropriate action for simulated emergencies specified by the evaluator, from at least three of the elements or sub-elements listed in K1 through K5.",
  ],
  ["PA.IX.C.S2", "Complete the appropriate checklist(s)."],
] as const;

/** All 17 current PA.IX.C codes from FAA-S-ACS-6C pages 53–54. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_C_CODES: readonly CurrentAreaIXTaskCAktrCode[] =
  currentAreaIXTaskCEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IX",
    task: "C",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_C_SOURCE,
  }));

export type CurrentAreaIXTaskCCodeResolution =
  | { status: "current"; entry: CurrentAreaIXTaskCAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IX.C slice.
 * Anything outside these 17 current entries remains unresolved.
 */
export function resolveCurrentAreaIXTaskCAktrCode(
  code: string,
): CurrentAreaIXTaskCCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_C_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
