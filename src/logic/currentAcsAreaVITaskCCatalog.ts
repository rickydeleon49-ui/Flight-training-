/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation VI (Navigation), Task C (Diversion).
 *
 * Source: FAA-S-ACS-6C, printed pages 40–41 / PDF pages 48–49.
 *
 * This is an explicit partial slice limited to PA.VI.C, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_C_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "40–41",
  pdfPages: "48–49",
  areaOfOperation: "Area of Operation VI: Navigation",
  task: "Task C. Diversion",
  coverageLabel: "PA.VI.C",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaVITaskCAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "VI";
  task: "C";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_C_SOURCE;
}

const currentAreaVITaskCEntries = [
  ["PA.VI.C.K1", "Selecting an alternate destination."],
  [
    "PA.VI.C.K2",
    "Situations that require deviations from flight plan or air traffic control (ATC) instructions.",
  ],
  ["PA.VI.C.R1", "Collision hazards."],
  [
    "PA.VI.C.R2",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  ["PA.VI.C.R3", "Circumstances that would make diversion prudent."],
  ["PA.VI.C.R4", "Selecting an appropriate airport or seaplane base."],
  [
    "PA.VI.C.R5",
    "Using available resources (e.g., automation, ATC, and flight deck planning aids).",
  ],
  ["PA.VI.C.S1", "Select a suitable destination and route for diversion."],
  [
    "PA.VI.C.S2",
    "Make a reasonable estimate of heading, groundspeed, arrival time, and fuel required to the “divert to” destination.",
  ],
  ["PA.VI.C.S3", "Maintain the selected altitude, ±200 feet and heading, ±15°."],
  ["PA.VI.C.S4", "Update/interpret weather in flight."],
  [
    "PA.VI.C.S5",
    "Use displays of digital weather and aeronautical information, as applicable to maintain situational awareness.",
  ],
  ["PA.VI.C.S6", "Promptly divert toward the destination."],
] as const;

/** All 13 current PA.VI.C codes from FAA-S-ACS-6C pages 40–41. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_C_CODES: readonly CurrentAreaVITaskCAktrCode[] =
  currentAreaVITaskCEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "VI",
    task: "C",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_C_SOURCE,
  }));

export type CurrentAreaVITaskCCodeResolution =
  | { status: "current"; entry: CurrentAreaVITaskCAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.VI.C slice.
 * Anything outside these 13 current entries remains unresolved.
 */
export function resolveCurrentAreaVITaskCAktrCode(
  code: string,
): CurrentAreaVITaskCCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_C_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
