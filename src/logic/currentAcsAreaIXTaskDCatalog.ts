/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation IX (Emergency Operations), Task D (Emergency Equipment and Survival Gear).
 *
 * Source: FAA-S-ACS-6C, printed pages 54–55 / PDF pages 61–62.
 *
 * This is an explicit partial slice limited to PA.IX.D, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_D_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "54–55",
  pdfPages: "61–62",
  areaOfOperation: "Area of Operation IX: Emergency Operations",
  task: "Task D. Emergency Equipment and Survival Gear",
  coverageLabel: "PA.IX.D",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaIXTaskDAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "IX";
  task: "D";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_D_SOURCE;
}

const currentAreaIXTaskDEntries = [
  [
    "PA.IX.D.K1",
    "Emergency Locator Transmitter (ELT) operations, limitations, and testing requirements.",
  ],
  ["PA.IX.D.K2", "Fire extinguisher operations and limitations."],
  ["PA.IX.D.K3", "Emergency equipment and survival gear needed for:"],
  ["PA.IX.D.K3a", "Climate extremes (hot/cold)"],
  ["PA.IX.D.K3b", "Mountainous terrain"],
  ["PA.IX.D.K3c", "Overwater operations"],
  [
    "PA.IX.D.K4",
    "When to deploy a ballistic parachute and associated passenger briefings, if equipped.",
  ],
  [
    "PA.IX.D.K5",
    "When to activate an emergency auto-land system and brief passengers, if equipped.",
  ],
  ["PA.IX.D.R1", "Survival gear (water, clothing, shelter) for 48 to 72 hours."],
  ["PA.IX.D.R2", "Use of a ballistic parachute system."],
  ["PA.IX.D.R3", "Use of an emergency auto-land system, if installed."],
  ["PA.IX.D.S1", "Identify appropriate equipment and personal gear."],
  [
    "PA.IX.D.S2",
    "Brief passengers on proper use of on-board emergency equipment and survival gear.",
  ],
  ["PA.IX.D.S3", "Simulate ballistic parachute deployment procedures, if equipped."],
] as const;

/** All 14 current PA.IX.D codes from FAA-S-ACS-6C pages 54–55. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_D_CODES: readonly CurrentAreaIXTaskDAktrCode[] =
  currentAreaIXTaskDEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "IX",
    task: "D",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_IX_TASK_D_SOURCE,
  }));

export type CurrentAreaIXTaskDCodeResolution =
  | { status: "current"; entry: CurrentAreaIXTaskDAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.IX.D slice.
 * Anything outside these 14 current entries remains unresolved.
 */
export function resolveCurrentAreaIXTaskDAktrCode(
  code: string,
): CurrentAreaIXTaskDCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_IX_TASK_D_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry ? { status: "current", entry } : { status: "unresolved", code: normalized };
}
