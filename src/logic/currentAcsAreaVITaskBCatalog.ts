/**
 * Small offline slice of current Private Pilot Airplane ACS codes:
 * Area of Operation VI (Navigation), Task B (Navigation Systems and Radar Services).
 *
 * Source: FAA-S-ACS-6C, printed pages 39–40 / PDF pages 47–48.
 *
 * This is an explicit partial slice limited to PA.VI.B, not a complete ACS catalog.
 */

export const PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_B_SOURCE = {
  document: "FAA-S-ACS-6C",
  title: "Private Pilot for Airplane Category Airman Certification Standards",
  effectiveFrom: "2024-05-31",
  printedPages: "39–40",
  pdfPages: "47–48",
  areaOfOperation: "Area of Operation VI: Navigation",
  task: "Task B. Navigation Systems and Radar Services",
  coverageLabel: "PA.VI.B",
  documentUrl: "https://www.faa.gov/training_testing/testing/acs/private_airplane_acs_6.pdf",
} as const;

export interface CurrentAreaVITaskBAktrCode {
  code: string;
  description: string;
  status: "current";
  certificate: "Private Pilot";
  category: "Airplane";
  areaOfOperation: "VI";
  task: "B";
  source: typeof PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_B_SOURCE;
}

const currentAreaVITaskBEntries = [
  [
    "PA.VI.B.K1",
    "Ground-based navigation (identification, orientation, course determination, equipment, tests, regulations, interference, appropriate use of navigation data, and signal integrity).",
  ],
  [
    "PA.VI.B.K2",
    "Satellite-based navigation (e.g., equipment, regulations, authorized use of databases, and Receiver Autonomous Integrity Monitoring (RAIM)).",
  ],
  [
    "PA.VI.B.K3",
    "Radar assistance to visual flight rules (VFR) aircraft (e.g., operations, equipment, available services, traffic advisories).",
  ],
  [
    "PA.VI.B.K4",
    "Transponder (Mode(s) A, C, and S) and Automatic Dependent Surveillance-Broadcast (ADS-B).",
  ],
  ["PA.VI.B.R1", "Management of automated navigation and autoflight systems."],
  [
    "PA.VI.B.R2",
    "Distractions, task prioritization, loss of situational awareness, or disorientation.",
  ],
  ["PA.VI.B.R3", "Limitations of the navigation system in use."],
  ["PA.VI.B.R4", "Loss of a navigation signal."],
  ["PA.VI.B.R5", "Use of an electronic flight bag (EFB), if used."],
  ["PA.VI.B.S1", "Use an airborne electronic navigation system."],
  ["PA.VI.B.S2", "Determine the airplane’s position using the navigation system."],
  ["PA.VI.B.S3", "Intercept and track a given course, radial, or bearing."],
  ["PA.VI.B.S4", "Recognize and describe the indication of station or waypoint passage."],
  [
    "PA.VI.B.S5",
    "Recognize signal loss or interference and take appropriate action, if applicable.",
  ],
  ["PA.VI.B.S6", "Use proper communication procedures when utilizing radar services."],
  ["PA.VI.B.S7", "Maintain the selected altitude, ±200 feet and heading, ±15°."],
] as const;

/** All 16 current PA.VI.B codes from FAA-S-ACS-6C pages 39–40. */
export const CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_B_CODES: readonly CurrentAreaVITaskBAktrCode[] =
  currentAreaVITaskBEntries.map(([code, description]) => ({
    code,
    description,
    status: "current",
    certificate: "Private Pilot",
    category: "Airplane",
    areaOfOperation: "VI",
    task: "B",
    source: PRIVATE_AIRPLANE_ACS_6C_AREA_VI_TASK_B_SOURCE,
  }));

export type CurrentAreaVITaskBCodeResolution =
  | { status: "current"; entry: CurrentAreaVITaskBAktrCode }
  | { status: "unresolved"; code: string };

/**
 * Exact code resolution with ASCII case-insensitive matching for the PA.VI.B slice.
 * Anything outside these 16 current entries remains unresolved.
 */
export function resolveCurrentAreaVITaskBAktrCode(
  code: string,
): CurrentAreaVITaskBCodeResolution {
  const normalized = code.replace(/[a-z]/g, (letter) => letter.toUpperCase());
  const entry = CURRENT_PRIVATE_AIRPLANE_AREA_VI_TASK_B_CODES.find(
    (candidate) => candidate.code.toUpperCase() === normalized,
  );
  return entry
    ? { status: "current", entry }
    : { status: "unresolved", code: normalized };
}
